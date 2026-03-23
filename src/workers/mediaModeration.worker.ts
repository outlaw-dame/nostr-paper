import { createStore, getMany, setMany } from 'idb-keyval'
import { env, pipeline } from '@huggingface/transformers'
import { withRetry } from '@/lib/retry'
import {
  DEFAULT_MEDIA_NSFW_MODEL_ID,
  DEFAULT_MEDIA_VIOLENCE_MODEL_ID,
  MEDIA_MODERATION_POLICY_VERSION,
  emptyMediaModerationScores,
  evaluateMediaModerationScores,
  mergeMediaModerationScores,
  normalizeNsfwScores,
  normalizeViolenceScores,
} from '@/lib/moderation/mediaPolicy'
import type {
  MediaModerationDecision,
  MediaModerationDocument,
  MediaModerationWorkerRequest,
  MediaModerationWorkerResponse,
} from '@/types'

const NSFW_MODEL_ID = import.meta.env.VITE_MEDIA_MODERATION_NSFW_MODEL_ID ?? DEFAULT_MEDIA_NSFW_MODEL_ID
const VIOLENCE_MODEL_ID = import.meta.env.VITE_MEDIA_MODERATION_VIOLENCE_MODEL_ID ?? DEFAULT_MEDIA_VIOLENCE_MODEL_ID
type SupportedModelDtype = 'auto' | 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'bnb4' | 'q4f16'
const DEV_MEDIA_PROXY_PATH = '/__dev/media-fetch'

function normalizeModelDtype(value: unknown): SupportedModelDtype {
  switch (value) {
    case 'auto':
    case 'fp32':
    case 'fp16':
    case 'q8':
    case 'int8':
    case 'uint8':
    case 'q4':
    case 'bnb4':
    case 'q4f16':
      return value
    default:
      return 'q4'
  }
}

const MODEL_DTYPE = normalizeModelDtype(import.meta.env.VITE_MEDIA_MODERATION_MODEL_DTYPE)
const ALLOW_REMOTE_MODELS = import.meta.env.VITE_MEDIA_MODERATION_ALLOW_REMOTE_MODELS !== 'false'
const LOCAL_MODEL_PATH = typeof import.meta.env.VITE_MEDIA_MODERATION_LOCAL_MODEL_PATH === 'string'
  ? import.meta.env.VITE_MEDIA_MODERATION_LOCAL_MODEL_PATH.trim()
  : ''
const MEDIA_PROXY_BASE = typeof import.meta.env.VITE_MEDIA_MODERATION_PROXY_URL === 'string'
  ? import.meta.env.VITE_MEDIA_MODERATION_PROXY_URL.trim()
  : ''

type ImageClassificationOutput = {
  label: string
  score: number
}

type ImageClassifier = (
  image: string,
  options?: { top_k?: number },
) => Promise<ImageClassificationOutput[]>

type CachedMediaModerationDecision = {
  fingerprint: string
  decision: Omit<MediaModerationDecision, 'id'>
}

const moderationStore = createStore('nostr-paper-media-moderation', 'decisions')

let nsfwClassifierPromise: Promise<ImageClassifier | null> | null = null
let violenceClassifierPromise: Promise<ImageClassifier | null> | null = null

function hashMediaModerationUrl(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function cacheKey(document: MediaModerationDocument): string {
  return [
    NSFW_MODEL_ID,
    VIOLENCE_MODEL_ID,
    MEDIA_MODERATION_POLICY_VERSION,
    hashMediaModerationUrl(document.url),
  ].join(':')
}

function fingerprint(document: MediaModerationDocument): string {
  return `${document.updatedAt}:${hashMediaModerationUrl(document.url)}`
}

function getWorkerOrigin(): string | null {
  try {
    return self.location.origin
  } catch {
    return null
  }
}

function buildMediaProxyUrl(target: string): string | null {
  const workerOrigin = getWorkerOrigin()
  const proxyBase = import.meta.env.DEV ? DEV_MEDIA_PROXY_PATH : MEDIA_PROXY_BASE
  if (!proxyBase) return null

  try {
    const endpoint = proxyBase.startsWith('http://') || proxyBase.startsWith('https://')
      ? new URL(proxyBase)
      : new URL(proxyBase, workerOrigin ?? 'http://localhost')
    endpoint.searchParams.set('url', target)
    return endpoint.href
  } catch {
    return null
  }
}

function resolveClassifierInputUrl(url: string): string | null {
  const normalized = url.trim()
  if (!normalized) return null
  if (normalized.startsWith('data:') || normalized.startsWith('blob:')) return normalized

  let parsed: URL
  try {
    parsed = new URL(normalized, self.location.href)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }

  const workerOrigin = getWorkerOrigin()
  if (workerOrigin && parsed.origin === workerOrigin) {
    return parsed.href
  }

  return buildMediaProxyUrl(parsed.href)
}

async function loadImageClassifier(modelId: string): Promise<ImageClassifier | null> {
  const attemptedDtypes = new Set<SupportedModelDtype | undefined>([MODEL_DTYPE, 'q8', undefined])

  for (const dtype of attemptedDtypes) {
    try {
      return await withRetry(
        async () => (
          await pipeline(
            'image-classification',
            modelId,
            dtype ? { dtype } : {},
          )
        ) as unknown as ImageClassifier,
        {
          maxAttempts: 2,
          baseDelayMs: 1_000,
        },
      )
    } catch {
      continue
    }
  }

  return null
}

async function getNsfwClassifier(): Promise<ImageClassifier | null> {
  if (!nsfwClassifierPromise) {
    if (!LOCAL_MODEL_PATH && !ALLOW_REMOTE_MODELS) {
      nsfwClassifierPromise = Promise.resolve(null)
      return nsfwClassifierPromise
    }

    env.allowLocalModels = LOCAL_MODEL_PATH.length > 0
    env.allowRemoteModels = ALLOW_REMOTE_MODELS
    if (LOCAL_MODEL_PATH) {
      env.localModelPath = LOCAL_MODEL_PATH
    }

    nsfwClassifierPromise = loadImageClassifier(NSFW_MODEL_ID)
  }

  return nsfwClassifierPromise
}

async function getViolenceClassifier(): Promise<ImageClassifier | null> {
  if (!violenceClassifierPromise) {
    if (!LOCAL_MODEL_PATH && !ALLOW_REMOTE_MODELS) {
      violenceClassifierPromise = Promise.resolve(null)
      return violenceClassifierPromise
    }

    env.allowLocalModels = LOCAL_MODEL_PATH.length > 0
    env.allowRemoteModels = ALLOW_REMOTE_MODELS
    if (LOCAL_MODEL_PATH) {
      env.localModelPath = LOCAL_MODEL_PATH
    }

    violenceClassifierPromise = loadImageClassifier(VIOLENCE_MODEL_ID)
  }

  return violenceClassifierPromise
}

async function classifyDocument(
  document: MediaModerationDocument,
): Promise<MediaModerationDecision> {
  const classifierInputUrl = resolveClassifierInputUrl(document.url)
  if (!classifierInputUrl) {
    return evaluateMediaModerationScores(
      document.id,
      emptyMediaModerationScores(),
      {
        nsfwModel: null,
        violenceModel: null,
      },
    )
  }

  const [nsfwClassifier, violenceClassifier] = await Promise.all([
    getNsfwClassifier(),
    getViolenceClassifier(),
  ])

  let nsfwScores = emptyMediaModerationScores()
  let violenceScores = emptyMediaModerationScores()

  if (nsfwClassifier) {
    try {
      nsfwScores = normalizeNsfwScores(await nsfwClassifier(classifierInputUrl, { top_k: 0 }))
    } catch {
      nsfwScores = emptyMediaModerationScores()
    }
  }

  if (violenceClassifier) {
    try {
      violenceScores = normalizeViolenceScores(await violenceClassifier(classifierInputUrl, { top_k: 0 }))
    } catch {
      violenceScores = emptyMediaModerationScores()
    }
  }

  return evaluateMediaModerationScores(
    document.id,
    mergeMediaModerationScores(nsfwScores, violenceScores),
    {
      nsfwModel: nsfwClassifier ? NSFW_MODEL_ID : null,
      violenceModel: violenceClassifier ? VIOLENCE_MODEL_ID : null,
    },
  )
}

async function moderateDocuments(documents: MediaModerationDocument[]): Promise<MediaModerationDecision[]> {
  if (documents.length === 0) return []

  const keys = documents.map(cacheKey)
  const cached = await getMany<CachedMediaModerationDecision>(keys, moderationStore).catch(
    () => new Array<CachedMediaModerationDecision | undefined>(keys.length).fill(undefined),
  )

  const decisions = new Map<string, MediaModerationDecision>()
  const missing: MediaModerationDocument[] = []

  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index]
    if (!document) continue

    const entry = cached[index]
    if (entry && entry.fingerprint === fingerprint(document)) {
      decisions.set(document.id, {
        id: document.id,
        ...entry.decision,
      })
    } else {
      missing.push(document)
    }
  }

  for (const document of missing) {
    const decision = await classifyDocument(document)
    decisions.set(document.id, decision)

    await setMany([
      [
        cacheKey(document),
        {
          fingerprint: fingerprint(document),
          decision: {
            action: decision.action,
            reason: decision.reason,
            scores: decision.scores,
            nsfwModel: decision.nsfwModel,
            violenceModel: decision.violenceModel,
            policyVersion: decision.policyVersion,
          },
        } satisfies CachedMediaModerationDecision,
      ],
    ], moderationStore).catch(() => {})
  }

  return documents
    .map((document) => decisions.get(document.id))
    .filter((decision): decision is MediaModerationDecision => decision !== undefined)
}

self.addEventListener('message', async (event: MessageEvent<MediaModerationWorkerRequest>) => {
  const respond = (result: { decisions?: MediaModerationDecision[] }) => {
    self.postMessage({ id: event.data.id, result } satisfies MediaModerationWorkerResponse)
  }
  const respondError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ id: event.data.id, error: message } satisfies MediaModerationWorkerResponse)
  }

  try {
    switch (event.data.type) {
      case 'init': {
        await Promise.all([getNsfwClassifier(), getViolenceClassifier()])
        respond({})
        break
      }

      case 'moderate': {
        const decisions = await moderateDocuments(event.data.payload.documents)
        respond({ decisions })
        break
      }

      case 'close': {
        nsfwClassifierPromise = null
        violenceClassifierPromise = null
        respond({})
        break
      }

      default: {
        respondError(`Unknown media moderation worker request: ${(event.data as { type: string }).type}`)
      }
    }
  } catch (error) {
    respondError(error)
  }
})
