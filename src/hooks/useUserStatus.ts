import { useEffect, useReducer, useRef } from 'react'
import { getLatestUserStatus, fetchFreshUserStatus, USER_STATUS_UPDATED_EVENT, type ParsedUserStatusEvent } from '@/lib/nostr/status'
import { isValidHex32 } from '@/lib/security/sanitize'

interface UseUserStatusOptions {
  identifier?: string
  background?: boolean
}

interface UserStatusState {
  status: ParsedUserStatusEvent | null
  loading: boolean
  error: string | null
}

type UserStatusAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_DONE'; payload: ParsedUserStatusEvent | null }
  | { type: 'ERROR'; payload: string }

const inflightStatusFetches = new Map<string, Promise<void>>()

function reducer(state: UserStatusState, action: UserStatusAction): UserStatusState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null }
    case 'LOAD_DONE':
      return { status: action.payload, loading: false, error: null }
    case 'ERROR':
      return { ...state, loading: false, error: action.payload }
    default:
      return state
  }
}

export function useUserStatus(
  pubkey: string | null | undefined,
  options: UseUserStatusOptions = {},
) {
  const identifier = options.identifier ?? 'music'
  const background = options.background ?? true
  const [state, dispatch] = useReducer(reducer, {
    status: null,
    loading: false,
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!pubkey || !isValidHex32(pubkey)) {
      dispatch({ type: 'LOAD_DONE', payload: null })
      return
    }

    const resolvedPubkey = pubkey
    const resolvedIdentifier = identifier
    const key = `${resolvedPubkey}:${resolvedIdentifier}`
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    const loadLocal = async () => {
      const status = await getLatestUserStatus(resolvedPubkey, resolvedIdentifier)
      if (signal.aborted) return
      dispatch({ type: 'LOAD_DONE', payload: status })
    }

    dispatch({ type: 'LOAD_START' })

    loadLocal()
      .then(async () => {
        if (!background || signal.aborted) return

        const existing = inflightStatusFetches.get(key)
        if (existing) {
          await existing.catch(() => {})
        } else {
          const promise = fetchFreshUserStatus(resolvedPubkey, resolvedIdentifier, signal)
            .catch(() => {})
            .finally(() => {
              inflightStatusFetches.delete(key)
            })
          inflightStatusFetches.set(key, promise)
          await promise
        }

        if (signal.aborted) return
        await loadLocal()
      })
      .catch((error: unknown) => {
        if (signal.aborted) return
        dispatch({
          type: 'ERROR',
          payload: error instanceof Error ? error.message : 'Failed to load user status.',
        })
      })

    return () => controller.abort()
  }, [background, identifier, pubkey])

  useEffect(() => {
    if (!pubkey || typeof window === 'undefined') return

    const resolvedPubkey = pubkey
    const resolvedIdentifier = identifier

    const handleStatusUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ pubkey?: string; identifier?: string }>).detail
      if (detail?.pubkey !== resolvedPubkey || detail?.identifier !== resolvedIdentifier) return

      getLatestUserStatus(resolvedPubkey, resolvedIdentifier)
        .then((status) => {
          dispatch({ type: 'LOAD_DONE', payload: status })
        })
        .catch(() => {})
    }

    window.addEventListener(USER_STATUS_UPDATED_EVENT, handleStatusUpdated as EventListener)
    return () => {
      window.removeEventListener(USER_STATUS_UPDATED_EVENT, handleStatusUpdated as EventListener)
    }
  }, [identifier, pubkey])

  return state
}
