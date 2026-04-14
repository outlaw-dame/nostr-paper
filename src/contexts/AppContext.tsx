/**
 * App Context
 *
 * Global application state: auth, bootstrap status, errors.
 * Keeps initialization logic out of component tree.
 */

import React, {
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { bootstrap } from '@/lib/bootstrap'
import { AppContext, type AppAction, type AppState } from '@/contexts/app-context'
import { syncCurrentUserContactList } from '@/lib/nostr/contacts'
import { refreshNip05Verifications } from '@/lib/nostr/nip05'
import { publishCurrentUserRelayList, syncCurrentUserRelayList } from '@/lib/nostr/relayList'
import { getCurrentUser, performLogout, STORAGE_KEY_PUBKEY } from '@/lib/nostr/ndk'
import { RELAY_SETTINGS_UPDATED_EVENT } from '@/lib/relay/relaySettings'
import { markBootStage, recordBootFailure, recordBootSuccess } from '@/lib/runtime/startupDiagnostics'

const shouldRunDevNip05Sweep = import.meta.env.VITE_ENABLE_DEV_NIP05_SWEEP === 'true'

const initialState: AppState = {
  status:      'idle',
  bootstrap:   null,
  currentUser: null,
  errors:      [],
  isOnline:    typeof navigator !== 'undefined' ? navigator.onLine : true,
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'BOOT_START':
      return { ...state, status: 'booting' }

    case 'BOOT_SUCCESS':
      return { ...state, status: 'ready', bootstrap: action.payload }

    case 'BOOT_PARTIAL':
      return { ...state, status: 'offline', bootstrap: action.payload }

    case 'BOOT_ERROR':
      return { ...state, status: 'error', errors: [...state.errors, action.payload] }

    case 'SET_USER':
      return { ...state, currentUser: action.payload }

    case 'ADD_ERROR':
      return {
        ...state,
        errors: [
          ...state.errors.slice(-9), // Keep last 10 errors
          action.payload,
        ],
      }

    case 'CLEAR_ERRORS':
      return { ...state, errors: [] }

    case 'SET_ONLINE':
      return { ...state, isOnline: action.payload }

    default:
      return state
  }
}

// ── Provider ─────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const abortRef = useRef<AbortController | null>(null)

  function logout() {
    performLogout()
    dispatch({ type: 'SET_USER', payload: null })
  }

  // Online/offline tracking
  useEffect(() => {
    const handleOnline  = () => dispatch({ type: 'SET_ONLINE', payload: true })
    const handleOffline = () => dispatch({ type: 'SET_ONLINE', payload: false })
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // App bootstrap
  useEffect(() => {
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    markBootStage('bootstrap:start')
    dispatch({ type: 'BOOT_START' })

    bootstrap(signal).then(async (result) => {
      if (signal.aborted) return

      if (!result.ok) {
        recordBootFailure('bootstrap:error', result.error.message)
        dispatch({ type: 'BOOT_ERROR', payload: result.error })
        return
      }

      const bootResult = result.value

      if (bootResult.ndkReady) {
        recordBootSuccess('bootstrap:ready')
        dispatch({ type: 'BOOT_SUCCESS', payload: bootResult })
      } else {
        recordBootSuccess('bootstrap:offline')
        dispatch({ type: 'BOOT_PARTIAL', payload: bootResult })
      }

      if (bootResult.dbReady && (!import.meta.env.DEV || shouldRunDevNip05Sweep)) {
        void refreshNip05Verifications(signal).catch((error: unknown) => {
          if (signal.aborted) return
          console.warn('[App] NIP-05 background verification degraded:', error)
        })
      }

      // Attempt to get current user after NDK is up
      if (bootResult.ndkReady) {
        try {
          const user = await getCurrentUser()
          if (user && !signal.aborted) {
            dispatch({
              type:    'SET_USER',
              payload: { pubkey: user.pubkey },
            })

            void syncCurrentUserContactList(signal).catch((error: unknown) => {
              if (signal.aborted) return
              console.warn('[App] Kind-3 contact list sync degraded:', error)
            })

            void syncCurrentUserRelayList(signal).catch((error: unknown) => {
              if (signal.aborted) return
              console.warn('[App] Kind-10002 relay list sync degraded:', error)
            })
          } else if (!signal.aborted) {
            // No signer — check for read-only pubkey saved from OnboardPage
            const savedPubkey = localStorage.getItem(STORAGE_KEY_PUBKEY)
            if (savedPubkey) {
              dispatch({ type: 'SET_USER', payload: { pubkey: savedPubkey } })
            }
          }
        } catch {
          // No signer available — check read-only pubkey fallback
          const savedPubkey = localStorage.getItem(STORAGE_KEY_PUBKEY)
          if (savedPubkey && !signal.aborted) {
            dispatch({ type: 'SET_USER', payload: { pubkey: savedPubkey } })
          }
        }
      }
    }).catch((error: unknown) => {
      if (signal.aborted) return
      if (error instanceof DOMException && error.name === 'AbortError') return
      recordBootFailure(
        'bootstrap:error',
        error instanceof Error ? error.message : 'Boot failed',
      )
      dispatch({
        type:    'BOOT_ERROR',
        payload: {
          code:        'DB_INIT_FAILED',
          message:     error instanceof Error ? error.message : 'Boot failed',
          timestamp:   Date.now(),
          recoverable: false,
        },
      })
    })

    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!state.currentUser?.pubkey) return

    const controller = new AbortController()

    const publishRelayList = () => {
      void publishCurrentUserRelayList({ signal: controller.signal }).catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.warn('[App] Kind-10002 relay list publish degraded:', error)
      })
    }

    window.addEventListener(RELAY_SETTINGS_UPDATED_EVENT, publishRelayList)

    return () => {
      controller.abort()
      window.removeEventListener(RELAY_SETTINGS_UPDATED_EVENT, publishRelayList)
    }
  }, [state.currentUser?.pubkey])

  return (
    <AppContext.Provider value={{ ...state, dispatch, logout }}>
      {children}
    </AppContext.Provider>
  )
}
