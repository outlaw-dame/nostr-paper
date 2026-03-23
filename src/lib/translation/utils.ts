export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export function buildAbortController(
  timeoutMs: number,
  signal?: AbortSignal,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController()

  const abortFromUpstream = () => {
    if (controller.signal.aborted) return
    controller.abort(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
  }

  if (signal?.aborted) {
    abortFromUpstream()
  } else if (signal) {
    signal.addEventListener('abort', abortFromUpstream, { once: true })
  }

  const timeoutId = globalThis.setTimeout(() => {
    if (controller.signal.aborted) return
    controller.abort(new DOMException('Timed out', 'TimeoutError'))
  }, timeoutMs)

  const cleanup = () => {
    globalThis.clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abortFromUpstream)
  }

  return { controller, cleanup }
}
