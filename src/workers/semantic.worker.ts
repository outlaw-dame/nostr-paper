import { createStore, getMany, setMany } from 'idb-keyval'
import { env, pipeline } from '@huggingface/transformers'
import { withRetry } from '@/lib/retry'
import type {
  SemanticDocument,
  SemanticMatch,
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

let extractorPromise: Promise<TextEmbeddingExtractor> | null = null

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

  return matches
    .filter(match => Number.isFinite(match.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
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
        await getExtractor()
        respond({ model: MODEL_ID })
        break
      }

      case 'rank': {
        const { query, documents, limit } = event.data.payload
        const matches = await rankDocuments(query, documents, limit)
        respond({ matches, model: MODEL_ID })
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
