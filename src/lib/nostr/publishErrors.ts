export type PublishErrorKind =
  | 'aborted'
  | 'validation'
  | 'signer_unavailable'
  | 'signer_denied'
  | 'network'
  | 'relay'
  | 'timeout'
  | 'duplicate'
  | 'unknown'

export interface PublishErrorClassification {
  kind: PublishErrorKind
  message: string
  retryable: boolean
}

const DEFAULT_MESSAGE = 'Failed to publish. Please try again.'

type ErrorLikeRecord = Record<'message' | 'error' | 'reason', unknown>

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object') {
    const record = error as Partial<ErrorLikeRecord>
    const message = record.message ?? record.error ?? record.reason
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return DEFAULT_MESSAGE
}

function isAbortError(error: unknown, message: string): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || /\babort(?:ed)?\b|\bapp cancel(?:led|ed)?\b|\boperation cancel(?:led|ed)?\b|\brequest cancel(?:led|ed)?\b/i.test(message)
}

function isSignerUnavailable(message: string): boolean {
  return /no signer|signer unavailable|signer is unavailable|install .*extension|connect .*signer|not authenticated|not logged in/i.test(message)
}

function isSignerDenied(message: string): boolean {
  return /user (?:refused|rejected|declined|denied|cancel(?:led|ed))|cancel(?:led|ed) by user|declined by user|rejected by user|denied by user|reject(?:ing|ed)? signing|denied signing|signing (?:request )?(?:rejected|denied|declined)|signer (?:rejected|denied|declined)/i.test(message)
}

function isValidationFailure(message: string): boolean {
  return /invalid|required|must |empty|malformed|unsupported|refusing|too large|not allowed|unsafe|validation/i.test(message)
}

function isDuplicateSubmit(message: string): boolean {
  return /duplicate|already published|already exists|in-flight|in flight|no-op|no changes/i.test(message)
}

function isTimeout(message: string): boolean {
  return /timeout|timed out|deadline/i.test(message)
}

function isRelayFailure(message: string): boolean {
  return /relay|publish failed|no relay|outbox|nip-65|websocket|socket/i.test(message)
}

function isNetworkFailure(message: string): boolean {
  return /network|fetch|offline|failed to fetch|econn|connection|dns|temporar/i.test(message)
}

export function classifyPublishError(error: unknown): PublishErrorClassification {
  const rawMessage = normalizeErrorMessage(error)
  const message = rawMessage.replace(/\s+/g, ' ').trim()

  if (isSignerDenied(message)) {
    return {
      kind: 'signer_denied',
      message: 'Signing was denied. Your draft was kept so you can try again.',
      retryable: false,
    }
  }

  if (isSignerUnavailable(message)) {
    return {
      kind: 'signer_unavailable',
      message: 'Connect and unlock a Nostr signer before publishing.',
      retryable: false,
    }
  }

  if (isAbortError(error, message)) {
    return {
      kind: 'aborted',
      message: 'Publish cancelled.',
      retryable: false,
    }
  }

  if (isDuplicateSubmit(message)) {
    return {
      kind: 'duplicate',
      message: 'This publish action was already submitted. Wait for the current attempt to finish.',
      retryable: false,
    }
  }

  if (isValidationFailure(message)) {
    return {
      kind: 'validation',
      message,
      retryable: false,
    }
  }

  if (isTimeout(message)) {
    return {
      kind: 'timeout',
      message: 'Publishing timed out while contacting relays. Check your connection and try again.',
      retryable: true,
    }
  }

  if (isRelayFailure(message)) {
    return {
      kind: 'relay',
      message: 'Relays did not accept the event yet. Check relay connectivity and try again.',
      retryable: true,
    }
  }

  if (isNetworkFailure(message)) {
    return {
      kind: 'network',
      message: 'Network connectivity failed while publishing. Check your connection and try again.',
      retryable: true,
    }
  }

  return {
    kind: 'unknown',
    message: message || DEFAULT_MESSAGE,
    retryable: true,
  }
}

export function getPublishErrorMessage(error: unknown): string {
  return classifyPublishError(error).message
}
