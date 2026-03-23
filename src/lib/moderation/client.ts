import type {
  ModerationDecision,
  ModerationDocument,
  ModerationWorkerRequest,
  ModerationWorkerResponse,
} from '@/types'

const INIT_TIMEOUT_MS = 120_000
const QUERY_TIMEOUT_MS = 90_000

let worker: Worker | null = null
let seq = 0
let fatalInitError: Error | null = null

const pending = new Map<number, {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function normalizeModerationError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (
    message.includes('not valid JSON') ||
    message.includes('<!doctype') ||
    message.includes('Unexpected token \'<\'')
  ) {
    return new Error('Moderation model assets are unavailable in this environment.')
  }

  return error instanceof Error ? error : new Error(message)
}

function isFatalModerationInitError(error: Error): boolean {
  return error.message === 'Moderation model assets are unavailable in this environment.'
}

function rejectPending(reason: unknown): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(reason)
    pending.delete(id)
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../../workers/moderation.worker.ts', import.meta.url),
      { type: 'module', name: 'nostr-paper-moderation' },
    )

    worker.onmessage = (event: MessageEvent<ModerationWorkerResponse>) => {
      const entry = pending.get(event.data.id)
      if (!entry) return

      clearTimeout(entry.timer)
      pending.delete(event.data.id)

      if ('error' in event.data) {
        entry.reject(new Error(event.data.error))
      } else {
        entry.resolve(event.data.result)
      }
    }

    worker.onerror = (event) => {
      const message = event.message || 'Moderation worker crashed'
      rejectPending(new Error(message))
      worker?.terminate()
      worker = null
    }

    worker.onmessageerror = () => {
      rejectPending(new Error('Moderation worker returned an unreadable message'))
      worker?.terminate()
      worker = null
    }
  }

  return worker
}

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

function send<T>(
  request: DistributiveOmit<ModerationWorkerRequest, 'id'>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const id = seq++
    const moderationWorker = getWorker()
    let settled = false

    const cleanup = () => {
      if (abortListener) signal?.removeEventListener('abort', abortListener)
      pending.delete(id)
    }

    const settleResolve = (value: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      resolve(value as T)
    }

    const settleReject = (reason: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      reject(reason)
    }

    const timer = setTimeout(() => {
      settleReject(new Error(`Moderation worker timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    const abortListener = signal
      ? () => settleReject(abortError())
      : null

    if (abortListener) signal?.addEventListener('abort', abortListener, { once: true })

    pending.set(id, {
      resolve: settleResolve,
      reject: settleReject,
      timer,
    })

    moderationWorker.postMessage({ id, ...request } satisfies ModerationWorkerRequest)
  })
}

export async function initContentModeration(signal?: AbortSignal): Promise<void> {
  if (fatalInitError) {
    throw fatalInitError
  }

  await send<{ model?: string }>({ type: 'init' }, INIT_TIMEOUT_MS, signal).catch((error) => {
    const normalized = normalizeModerationError(error)
    if (isFatalModerationInitError(normalized)) {
      fatalInitError = normalized
    }
    throw normalized
  })
}

export async function moderateContentDocuments(
  documents: ModerationDocument[],
  signal?: AbortSignal,
): Promise<ModerationDecision[]> {
  if (documents.length === 0) return []
  if (fatalInitError) {
    throw fatalInitError
  }

  const result = await send<{ decisions?: ModerationDecision[] }>(
    {
      type: 'moderate',
      payload: { documents },
    },
    QUERY_TIMEOUT_MS,
    signal,
  ).catch((error) => {
    const normalized = normalizeModerationError(error)
    if (isFatalModerationInitError(normalized)) {
      fatalInitError = normalized
    }
    throw normalized
  })

  return result.decisions ?? []
}

export async function closeContentModeration(): Promise<void> {
  if (!worker) return

  try {
    await send({ type: 'close' }, 5_000)
  } finally {
    rejectPending(new Error('Moderation worker closed'))
    worker.terminate()
    worker = null
    fatalInitError = null
  }
}
