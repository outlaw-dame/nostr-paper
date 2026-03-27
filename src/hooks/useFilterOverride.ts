import { useCallback, useEffect, useState } from 'react'
import {
  clearFilterOverride,
  hasFilterOverride,
  setFilterOverride,
} from '@/lib/filters/overrides'
import { STORAGE_KEY_PUBKEY } from '@/lib/nostr/ndk'

function getScopeId(): string {
  if (typeof window === 'undefined') return 'anon'
  const pubkey = window.localStorage.getItem(STORAGE_KEY_PUBKEY)
  return pubkey && pubkey.trim().length > 0 ? pubkey.trim() : 'anon'
}

export function useFilterOverride(eventId: string | null | undefined): {
  overridden: boolean
  setOverridden: (next: boolean) => void
} {
  const scopeId = getScopeId()
  const [overridden, setOverriddenState] = useState(false)

  useEffect(() => {
    if (!eventId) {
      setOverriddenState(false)
      return
    }
    setOverriddenState(hasFilterOverride(eventId, scopeId))
  }, [eventId, scopeId])

  const setOverridden = useCallback((next: boolean) => {
    if (!eventId) return
    if (next) setFilterOverride(eventId, scopeId)
    else clearFilterOverride(eventId, scopeId)
    setOverriddenState(next)
  }, [eventId, scopeId])

  return { overridden, setOverridden }
}
