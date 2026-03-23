import { createStore, getMany, setMany } from 'idb-keyval'
import { env, pipeline } from '@huggingface/transformers'
import { withRetry } from '@/lib/retry'
import {
  DEFAULT_MODERATION_MODEL_ID,
  MODERATION_POLICY_VERSION,
  evaluateModerationScores,
  normalizeModerationScores,
} from '@/lib/moderation/policy'
import type {
  ModerationDecision,
  ModerationDocument,
  ModerationWorkerRequest,
  ModerationWorkerResponse,
} from '@/types'

const MODEL_ID = import.meta.env.VITE_MODERATION_MODEL_ID ?? DEFAULT_MODERATION_MODEL_ID
const ALLOW_REMOTE_MODELS = import.meta.env.VITE_MODERATION_ALLOW_REMOTE_MODELS !== 'false'
const LOCAL_MODEL_PATH = typeof import.meta.env.VITE_MODERATION_LOCAL_MODEL_PATH === 'string'
  ? import.meta.env.VITE_MODERATION_LOCAL_MODEL_PATH.trim()
  : ''
const MAX_BATCH_SIZE = 24

type SupportedModelDtype = 'auto' | 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'bnb4' | 'q4f16'

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
      return 'q8'
  }
}

const MODEL_DTYPE = normalizeModelDtype(import.meta.env.VITE_MODERATION_MODEL_DTYPE)

type TextClassificationOutput = {
  label: string
  score: number
}

type TextClassifier = (
  texts: string | string[],
  options?: {
    top_k?: number | null
  },
) => Promise<TextClassificationOutput[] | TextClassificationOutput[][]>

type CachedModerationDecision = {
  fingerprint: string
  decision: Omit<ModerationDecision, 'id'>
}

const moderationStore = createStore('nostr-paper-moderation', 'decisions')

let classifierPromise: Promise<TextClassifier> | null = null

function hashModerationText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function cacheKey(document: ModerationDocument): string {
  return `${MODEL_ID}:${MODERATION_POLICY_VERSION}:${document.kind}:${hashModerationText(document.text)}`
}

function fingerprint(document: ModerationDocument): string {
  return `${document.updatedAt}:${hashModerationText(document.text)}`
}

function normalizeClassifierOutput(
  output: TextClassificationOutput[] | TextClassificationOutput[][],
  count: number,
): TextClassificationOutput[][] {
  if (count <= 0) return []
  if (!Array.isArray(output)) return []

  if (output.length === 0) {
    return new Array<TextClassificationOutput[]>(count).fill([])
  }

  if (Array.isArray(output[0])) {
    return output as TextClassificationOutput[][]
  }

  return [output as TextClassificationOutput[]]
}

async function getClassifier(): Promise<TextClassifier> {
  if (!classifierPromise) {
    if (!LOCAL_MODEL_PATH && !ALLOW_REMOTE_MODELS) {
      throw new Error('Content moderation model loading is disabled by configuration.')
    }

    env.allowLocalModels = LOCAL_MODEL_PATH.length > 0
    env.allowRemoteModels = ALLOW_REMOTE_MODELS
    if (LOCAL_MODEL_PATH) {
      env.localModelPath = LOCAL_MODEL_PATH
    }

    classifierPromise = withRetry(
      async () => (
        await pipeline('text-classification', MODEL_ID, { dtype: MODEL_DTYPE })
      ) as unknown as TextClassifier,
      {
        maxAttempts: 3,
        baseDelayMs: 1_000,
      },
    )
  }

  return classifierPromise
}

async function moderateDocuments(documents: ModerationDocument[]): Promise<ModerationDecision[]> {
  if (documents.length === 0) return []

  const keys = documents.map(cacheKey)
  const cached = await getMany<CachedModerationDecision>(keys, moderationStore).catch(
    () => new Array<CachedModerationDecision | undefined>(keys.length).fill(undefined),
  )

  const decisions = new Map<string, ModerationDecision>()
  const missing: ModerationDocument[] = []

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

  if (missing.length > 0) {
    const classifier = await getClassifier()

    for (let start = 0; start < missing.length; start += MAX_BATCH_SIZE) {
      const batch = missing.slice(start, start + MAX_BATCH_SIZE)
      const output = await classifier(batch.map((document) => document.text), { top_k: null })
      const normalizedOutput = normalizeClassifierOutput(output, batch.length)
      const writes: Array<[string, CachedModerationDecision]> = []

      for (let index = 0; index < batch.length; index += 1) {
        const document = batch[index]
        if (!document) continue

        const scores = normalizeModerationScores(normalizedOutput[index] ?? [])
        const decision = evaluateModerationScores(document.id, scores, MODEL_ID)
        decisions.set(document.id, decision)
        writes.push([
          cacheKey(document),
          {
            fingerprint: fingerprint(document),
            decision: {
              action: decision.action,
              reason: decision.reason,
              scores: decision.scores,
              model: decision.model,
              policyVersion: decision.policyVersion,
            },
          },
        ])
      }

      if (writes.length > 0) {
        await setMany(writes, moderationStore).catch(() => {})
      }
    }
  }

  return documents
    .map((document) => decisions.get(document.id))
    .filter((decision): decision is ModerationDecision => decision !== undefined)
}

self.addEventListener('message', async (event: MessageEvent<ModerationWorkerRequest>) => {
  const respond = (result: { decisions?: ModerationDecision[]; model?: string }) => {
    self.postMessage({ id: event.data.id, result } satisfies ModerationWorkerResponse)
  }
  const respondError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ id: event.data.id, error: message } satisfies ModerationWorkerResponse)
  }

  try {
    switch (event.data.type) {
      case 'init': {
        await getClassifier()
        respond({ model: MODEL_ID })
        break
      }

      case 'moderate': {
        const decisions = await moderateDocuments(event.data.payload.documents)
        respond({ decisions, model: MODEL_ID })
        break
      }

      case 'close': {
        classifierPromise = null
        respond({ model: MODEL_ID })
        break
      }

      default: {
        respondError(`Unknown moderation worker request: ${(event.data as { type: string }).type}`)
      }
    }
  } catch (error) {
    respondError(error)
  }
})
