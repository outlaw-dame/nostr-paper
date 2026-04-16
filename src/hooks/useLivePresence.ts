import { useEffect, useReducer } from 'react'
import { isValidHex32 } from '@/lib/security/sanitize'
import {
  fetchFreshLivePresence,
  getLatestLivePresence,
  type ParsedLivePresenceEvent,
} from '@/lib/nostr/livePresence'

interface UseLivePresenceOptions {
  background?: boolean
}

interface LivePresenceState {
  presence: ParsedLivePresenceEvent | null
  loading: boolean
  error: string | null
}

type LivePresenceAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_DONE'; payload: ParsedLivePresenceEvent | null }
  | { type: 'ERROR'; payload: string }

function reducer(state: LivePresenceState, action: LivePresenceAction): LivePresenceState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null }
    case 'LOAD_DONE':
      return { presence: action.payload, loading: false, error: null }
    case 'ERROR':
      return { ...state, loading: false, error: action.payload }
    default:
      return state
  }
}

export function useLivePresence(
  pubkey: string | null | undefined,
  options: UseLivePresenceOptions = {},
) {
  const [state, dispatch] = useReducer(reducer, {
    presence: null,
    loading: false,
    error: null,
  })
  const background = options.background ?? true

  useEffect(() => {
    if (!pubkey || !isValidHex32(pubkey)) {
      dispatch({ type: 'LOAD_DONE', payload: null })
      return
    }

    const controller = new AbortController()

    const loadLocal = async () => {
      const presence = await getLatestLivePresence(pubkey)
      if (controller.signal.aborted) return
      dispatch({ type: 'LOAD_DONE', payload: presence })
    }

    dispatch({ type: 'LOAD_START' })

    loadLocal()
      .then(async () => {
        if (controller.signal.aborted || !background) return
        await fetchFreshLivePresence(pubkey, controller.signal).catch(() => {})
        if (controller.signal.aborted) return
        await loadLocal()
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        dispatch({
          type: 'ERROR',
          payload: error instanceof Error ? error.message : 'Failed to load live presence.',
        })
      })

    return () => controller.abort()
  }, [background, pubkey])

  return state
}