import type React from 'react'
import { createContext, useContext } from 'react'
import type { BootstrapResult } from '@/lib/bootstrap'
import type { AppError } from '@/types'

export type AppStatus =
  | 'idle'
  | 'booting'
  | 'ready'
  | 'offline'
  | 'error'

export interface AppState {
  status: AppStatus
  bootstrap: BootstrapResult | null
  currentUser: { pubkey: string; name?: string } | null
  errors: AppError[]
  isOnline: boolean
}

export type AppAction =
  | { type: 'BOOT_START' }
  | { type: 'BOOT_SUCCESS'; payload: BootstrapResult }
  | { type: 'BOOT_PARTIAL'; payload: BootstrapResult }
  | { type: 'BOOT_ERROR'; payload: AppError }
  | { type: 'SET_USER'; payload: { pubkey: string; name?: string } | null }
  | { type: 'ADD_ERROR'; payload: AppError }
  | { type: 'CLEAR_ERRORS' }
  | { type: 'SET_ONLINE'; payload: boolean }

export interface AppContextValue extends AppState {
  dispatch: React.Dispatch<AppAction>
  logout: () => void
}

const APP_CONTEXT_SYMBOL = Symbol.for('nostr-paper.AppContext')

type AppContextGlobal = typeof globalThis & {
  [APP_CONTEXT_SYMBOL]?: React.Context<AppContextValue | null>
}

function getStableAppContext(): React.Context<AppContextValue | null> {
  const contextGlobal = globalThis as AppContextGlobal
  if (!contextGlobal[APP_CONTEXT_SYMBOL]) {
    contextGlobal[APP_CONTEXT_SYMBOL] = createContext<AppContextValue | null>(null)
  }
  return contextGlobal[APP_CONTEXT_SYMBOL]
}

export const AppContext = getStableAppContext()
AppContext.displayName = 'AppContext'

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
