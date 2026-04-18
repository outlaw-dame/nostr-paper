import { createStore, get, getMany, set, setMany } from 'idb-keyval'
import { env, pipeline } from '@huggingface/transformers'
import { withRetry } from '@/lib/retry'
import type {
  SemanticDocument,
  SemanticMatch,
  TopicAssignment,
  SemanticWorkerRequest,
  SemanticWorkerResponse,
} from '@/types'

const MODEL_ID = import.meta.env.VITE_SEMANTIC_MODEL_ID ?? 'Xenova/all-MiniLM-L6-v2'
const MODEL_DTYPE = import.meta.env.VITE_SEMANTIC_MODEL_DTYPE ?? 'q8'
const ALLOW_REMOTE_MODELS = import.meta.env.VITE_SEMANTIC_ALLOW_REMOTE_MODELS !== 'false'
const LOCAL_MODEL_PATH = typeof import.meta.env.VITE_SEMANTIC_LOCAL_MODEL_PATH === 'string'
  ? import.meta.env.VITE_SEMANTIC_LOCAL_MODEL_PATH.trim()
  : ''
const MAX_BATCH_SIZE = 16

// ─── Cross-encoder config ────────────────────────────────────────────────────
// Reranks the top-K bi-encoder candidates with a higher-quality cross-encoder.
// Model must have an ONNX export compatible with @huggingface/transformers.
const CROSS_ENCODER_MODEL_ID: string =
  (import.meta.env.VITE_CROSS_ENCODER_MODEL_ID as string | undefined)
  ?? 'Xenova/ms-marco-MiniLM-L-6-v2'
const CROSS_ENCODER_ENABLED: boolean =
  import.meta.env.VITE_CROSS_ENCODER_ENABLED !== 'false'
// Number of bi-encoder candidates passed to the cross-encoder for reranking.
const CROSS_ENCODER_TOP_K = 30

type ClassificationLabel = { label: string; score: number }
// The text-classification pipeline called with top_k:null returns one array
// per input when given a batch; cast to this shape internally.
type TextClassifier = (
  inputs: Array<{ text: string; text_pair: string }>,
  options: { top_k: null },
) => Promise<ClassificationLabel[][]>

let crossEncoderValue: TextClassifier | null = null

type TextEmbeddingExtractor = (
  texts: string | string[],
  options?: {
    pooling?: 'mean'
    normalize?: boolean
  },
) => Promise<{
  data: Float32Array | Int8Array | Uint8Array
  dims: number[]
}>

type CachedEmbedding = {
  fingerprint: string
  vector: number[]
}

const embeddingStore = createStore('nostr-paper-semantic', 'embeddings')
const clusterStore = createStore('nostr-paper-clusters', 'data')

// ─── Clustering constants ────────────────────────────────────────────────────
// Minimum cosine similarity to assign a document to an existing centroid.
const CLUSTER_THRESHOLD = 0.72
// Maximum number of live centroids (prevents unbounded IDB growth).
const MAX_CENTROIDS = 50
// Centroids below this size are pruned when capacity is reached.
const MIN_CLUSTER_SIZE = 3
// Minimum cluster size before c-TF-IDF keyword extraction runs.
const KEYWORD_THRESHOLD = 2
// IDB key under which the centroid array is persisted.
const CENTROIDS_STORE_KEY = '__centroids__'

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','can',
  'this','that','these','those','it','its','of','in','on','at','to','for',
  'by','or','and','not','with','from','about','as','but','if','so','up',
  'out','all','no','he','she','they','we','you','i','me','my','your','his',
  'her','our','their','just','more','also','than','when','what','which',
  'who','how','get','got','new','one','two','like','use','used','via','per',
  're','nostr','http','https','www',
])

interface ClusterCentroid {
  id: string
  centroid: number[]
  size: number
  termFreqs: Record<string, number>
  keywords: string[]
  updatedAt: number
}

let extractorPromise: Promise<TextEmbeddingExtractor> | null = null

// Loads the cross-encoder. Failures are non-fatal — bi-encoder takes over.
async function loadCrossEncoder(): Promise<void> {
  if (!CROSS_ENCODER_ENABLED) return
  if (!LOCAL_MODEL_PATH && !ALLOW_REMOTE_MODELS) return
  try {
    const classifier = await pipeline('text-classification', CROSS_ENCODER_MODEL_ID, {
      dtype: MODEL_DTYPE,
    })
    crossEncoderValue = classifier as unknown as TextClassifier
  } catch (err) {
    console.warn('[semantic] Cross-encoder load failed, using bi-encoder only:', err)
  }
}

function hashText(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function cacheKey(document: SemanticDocument): string {
  return `${MODEL_ID}:${document.kind}:${document.id}`
}

function fingerprint(document: SemanticDocument): string {
  return `${document.updatedAt}:${hashText(document.text)}`
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < length; i++) {
    dot += a[i]! * b[i]!
  }
  return dot
}

function tensorToVectors(
  data: Float32Array | Int8Array | Uint8Array,
  count: number,
  dims: number[],
): number[][] {
  const width = dims[dims.length - 1] ?? 0
  if (width <= 0) return []

  const rows = dims.length > 1 ? count : 1
  const vectors: number[][] = []
  for (let row = 0; row < rows; row++) {
    const start = row * width
    const end = start + width
    vectors.push(Array.from(data.slice(start, end)))
  }
  return vectors
}

async function getExtractor(): Promise<TextEmbeddingExtractor> {
  if (!extractorPromise) {
    if (!LOCAL_MODEL_PATH && !ALLOW_REMOTE_MODELS) {
      throw new Error('Semantic model loading is disabled by configuration.')
    }

    env.allowLocalModels = LOCAL_MODEL_PATH.length > 0
    env.allowRemoteModels = ALLOW_REMOTE_MODELS
    if (LOCAL_MODEL_PATH) {
      env.localModelPath = LOCAL_MODEL_PATH
    }

    extractorPromise = withRetry(
      async () => (
        await pipeline('feature-extraction', MODEL_ID, { dtype: MODEL_DTYPE })
      ) as unknown as TextEmbeddingExtractor,
      {
        maxAttempts: 3,
        baseDelayMs: 1_000,
      },
    )
  }

  return extractorPromise
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor()
  const output = await extractor(texts, {
    pooling: 'mean',
    normalize: true,
  })

  return tensorToVectors(output.data, texts.length, output.dims)
}

function normalizeVector(v: number[]): number[] {
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm)
  if (norm < 1e-9) return v
  return v.map(x => x / norm)
}

function addWeightedVectors(a: number[], wa: number, b: number[], wb: number): number[] {
  const len = Math.min(a.length, b.length)
  const result = new Array<number>(len)
  for (let i = 0; i < len; i++) result[i] = (a[i] ?? 0) * wa + (b[i] ?? 0) * wb
  return result
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t))
}

async function loadCentroids(): Promise<ClusterCentroid[]> {
  const stored = await get<ClusterCentroid[]>(CENTROIDS_STORE_KEY, clusterStore).catch(() => undefined)
  return stored ?? []
}

async function saveCentroids(centroids: ClusterCentroid[]): Promise<void> {
  await set(CENTROIDS_STORE_KEY, centroids, clusterStore).catch(() => {})
}

function computeCtfIdf(centroids: ClusterCentroid[]): void {
  // Build document frequency: number of centroids containing each term.
  const df = new Map<string, number>()
  for (const c of centroids) {
    for (const term of Object.keys(c.termFreqs)) {
      df.set(term, (df.get(term) ?? 0) + 1)
    }
  }
  const numCentroids = Math.max(centroids.length, 1)

  for (const c of centroids) {
    if (c.size < KEYWORD_THRESHOLD) continue
    const totalTerms = Object.values(c.termFreqs).reduce((s, n) => s + n, 0)
    if (totalTerms === 0) continue

    const scores: Array<[string, number]> = []
    for (const [term, freq] of Object.entries(c.termFreqs)) {
      const tf = freq / totalTerms
      const idf = Math.log(1 + numCentroids / (1 + (df.get(term) ?? 0)))
      scores.push([term, tf * idf])
    }
    scores.sort((a, b) => b[1] - a[1])
    c.keywords = scores.slice(0, 5).map(([t]) => t)
  }
}

async function clusterDocuments(documents: SemanticDocument[]): Promise<TopicAssignment[]> {
  if (documents.length === 0) return []

  const documentVectors = await ensureDocumentEmbeddings(documents)
  const centroids = await loadCentroids()
  const assignments: TopicAssignment[] = []
  const touched = new Set<string>()

  for (const document of documents) {
    const vector = documentVectors.get(document.id)
    if (!vector) continue

    const tokens = tokenize(document.text)

    // Find nearest centroid.
    let bestCentroid: ClusterCentroid | null = null
    let bestSim = -Infinity
    for (const c of centroids) {
      const sim = cosineSimilarity(vector, c.centroid)
      if (sim > bestSim) {
        bestSim = sim
        bestCentroid = c
      }
    }

    let assigned: ClusterCentroid

    if (bestCentroid !== null && bestSim >= CLUSTER_THRESHOLD) {
      // Update existing centroid via online mean, then re-normalize.
      const n = bestCentroid.size + 1
      bestCentroid.centroid = normalizeVector(
        addWeightedVectors(bestCentroid.centroid, bestCentroid.size / n, vector, 1 / n),
      )
      bestCentroid.size = n
      bestCentroid.updatedAt = Date.now()
      for (const token of tokens) {
        bestCentroid.termFreqs[token] = (bestCentroid.termFreqs[token] ?? 0) + 1
      }
      touched.add(bestCentroid.id)
      assigned = bestCentroid
    } else if (centroids.length < MAX_CENTROIDS) {
      // Create a new centroid seeded with this document.
      const newCentroid: ClusterCentroid = {
        id: crypto.randomUUID(),
        centroid: [...vector],
        size: 1,
        termFreqs: {},
        keywords: [],
        updatedAt: Date.now(),
      }
      for (const token of tokens) {
        newCentroid.termFreqs[token] = (newCentroid.termFreqs[token] ?? 0) + 1
      }
      centroids.push(newCentroid)
      touched.add(newCentroid.id)
      assigned = newCentroid
    } else {
      // At capacity — force-assign to best match and update it.
      assigned = bestCentroid ?? centroids[0]!
      const n = assigned.size + 1
      assigned.centroid = normalizeVector(
        addWeightedVectors(assigned.centroid, assigned.size / n, vector, 1 / n),
      )
      assigned.size = n
      assigned.updatedAt = Date.now()
      for (const token of tokens) {
        assigned.termFreqs[token] = (assigned.termFreqs[token] ?? 0) + 1
      }
      touched.add(assigned.id)
    }

    assignments.push({ id: document.id, topicId: assigned.id, keywords: assigned.keywords })
  }

  // Prune noise centroids only when at capacity.
  const pruned = centroids.length >= MAX_CENTROIDS
    ? centroids.filter(c => c.size >= MIN_CLUSTER_SIZE)
    : centroids

  // Recompute c-TF-IDF keywords for touched centroids.
  computeCtfIdf(pruned)

  await saveCentroids(pruned)

  // Refresh keyword arrays on assignments after c-TF-IDF update.
  const centroidById = new Map(pruned.map(c => [c.id, c]))
  for (const assignment of assignments) {
    const c = centroidById.get(assignment.topicId)
    if (c) assignment.keywords = c.keywords
  }

  return assignments
}

async function ensureDocumentEmbeddings(documents: SemanticDocument[]): Promise<Map<string, number[]>> {
  if (documents.length === 0) return new Map()

  const keys = documents.map(cacheKey)
  const cached = await getMany<CachedEmbedding>(keys, embeddingStore).catch(
    () => new Array<CachedEmbedding | undefined>(keys.length).fill(undefined),
  )
  const vectors = new Map<string, number[]>()
  const missing: SemanticDocument[] = []

  for (let index = 0; index < documents.length; index++) {
    const document = documents[index]
    if (!document) continue

    const entry = cached[index]
    if (entry && entry.fingerprint === fingerprint(document)) {
      vectors.set(document.id, entry.vector)
    } else {
      missing.push(document)
    }
  }

  for (let start = 0; start < missing.length; start += MAX_BATCH_SIZE) {
    const batch = missing.slice(start, start + MAX_BATCH_SIZE)
    const embeddings = await embedTexts(batch.map(document => document.text))
    const writes: Array<[string, CachedEmbedding]> = []

    for (let index = 0; index < batch.length; index++) {
      const document = batch[index]
      const vector = embeddings[index]
      if (!document || !vector) continue
      vectors.set(document.id, vector)
      writes.push([
        cacheKey(document),
        {
          fingerprint: fingerprint(document),
          vector,
        },
      ])
    }

    if (writes.length > 0) {
      await setMany(writes, embeddingStore).catch(() => {})
    }
  }

  return vectors
}

async function rankDocuments(
  query: string,
  documents: SemanticDocument[],
  limit: number,
): Promise<SemanticMatch[]> {
  const trimmed = query.trim()
  if (!trimmed || documents.length === 0) return []

  const [queryVector] = await embedTexts([trimmed])
  if (!queryVector) return []

  const documentVectors = await ensureDocumentEmbeddings(documents)
  const matches: SemanticMatch[] = []

  for (const document of documents) {
    const vector = documentVectors.get(document.id)
    if (!vector) continue

    matches.push({
      id: document.id,
      score: cosineSimilarity(queryVector, vector),
    })
  }

  const biEncoderResults = matches
    .filter(match => Number.isFinite(match.score))
    .sort((a, b) => b.score - a.score)

  // ── Cross-encoder rerank ────────────────────────────────────────────────
  // Take the top-K bi-encoder candidates and re-score them with the
  // cross-encoder (higher quality, joint query-document scoring).
  // Gracefully falls back to bi-encoder results if cross-encoder is absent.
  if (!crossEncoderValue) {
    return biEncoderResults.slice(0, Math.max(1, limit))
  }

  const topCandidates = biEncoderResults.slice(0, CROSS_ENCODER_TOP_K)
  const documentById = new Map(documents.map(d => [d.id, d]))

  try {
    const pairs = topCandidates
      .map(m => documentById.get(m.id))
      .filter((d): d is SemanticDocument => d !== undefined)
      .map(d => ({ text: trimmed, text_pair: d.text }))

    const batchResults = await crossEncoderValue(pairs, { top_k: null })

    const reranked: SemanticMatch[] = topCandidates
      .map((candidate, i) => {
        const labels = batchResults[i] ?? []
        // For num_labels=2 models (e.g. binary relevant/not-relevant),
        // LABEL_1 is the "relevant" class. For num_labels=1 models (single
        // logit cross-encoders), LABEL_0 score = relevance probability.
        const label1 = labels.find(l => l.label === 'LABEL_1')
        const score = label1 !== undefined
          ? label1.score
          : (labels[0]?.score ?? candidate.score)
        return { id: candidate.id, score }
      })
      .filter(m => Number.isFinite(m.score))
      .sort((a, b) => b.score - a.score)

    return reranked.slice(0, Math.max(1, limit))
  } catch (err) {
    console.warn('[semantic] Cross-encoder inference failed, falling back to bi-encoder:', err)
    return biEncoderResults.slice(0, Math.max(1, limit))
  }
}

self.addEventListener('message', async (event: MessageEvent<SemanticWorkerRequest>) => {
  const respond = (result: { matches?: SemanticMatch[]; model?: string }) => {
    self.postMessage({ id: event.data.id, result } satisfies SemanticWorkerResponse)
  }
  const respondError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ id: event.data.id, error: message } satisfies SemanticWorkerResponse)
  }

  try {
    switch (event.data.type) {
      case 'init': {
        // Load bi-encoder and cross-encoder in parallel. Cross-encoder failure
        // is non-fatal — searches degrade gracefully to bi-encoder only.
        await Promise.all([
          getExtractor(),
          loadCrossEncoder(),
        ])
        respond({ model: MODEL_ID })
        break
      }

      case 'rank': {
        const { query, documents, limit } = event.data.payload
        const matches = await rankDocuments(query, documents, limit)
        respond({ matches, model: MODEL_ID })
        break
      }

      case 'cluster': {
        const { documents } = event.data.payload
        const topics = await clusterDocuments(documents)
        respond({ topics, model: MODEL_ID })
        break
      }

      case 'close': {
        extractorPromise = null
        respond({ model: MODEL_ID })
        break
      }

      default: {
        respondError(`Unknown semantic worker request: ${(event.data as { type: string }).type}`)
      }
    }
  } catch (error) {
    respondError(error)
  }
})
