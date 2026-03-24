/**
 * useMuteList
 *
 * Loads the current user's mute list (kind 10000).
 * Returns a function to check if a pubkey is muted.
 */

import { useCallback, useEffect, useState } from 'react'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { useApp } from '@/contexts/app-context'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import { isValidHex32 } from '@/lib/security/sanitize'

const MUTE_LIST_KIND = 10000

export interface UseMuteListResult {
  mutedPubkeys: Set<string>
  isMuted: (pubkey: string) => boolean
  mute: (pubkey: string) => Promise<void>
  unmute: (pubkey: string) => Promise<void>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useMuteList(): UseMuteListResult {
  const { currentUser } = useApp()
  const [mutedPubkeys, setMutedPubkeys] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMuteList = useCallback(async () => {
    if (!currentUser?.pubkey) {
      setMutedPubkeys(new Set())
      setLoading(false)
      return
    }

    try {
      const ndk = getNDK()
      
      await withRetry(async () => {
        const event = await ndk.fetchEvent({
          kinds: [MUTE_LIST_KIND],
          authors: [currentUser.pubkey],
        })

        if (event) {
          const pTags = event.tags
            .filter((t) => t[0] === 'p' && t[1])
            .map((t) => t[1] as string)
            .filter((pubkey) => isValidHex32(pubkey))
          setMutedPubkeys(new Set(pTags))
        } else {
          setMutedPubkeys(new Set())
        }
      }, {
        maxAttempts: 3,
        baseDelayMs: 1000,
        shouldRetry: (err) => !(err instanceof DOMException && err.name === 'AbortError')
      })
      
      setError(null)
    } catch (err) {
      console.warn('Failed to fetch mute list', err)
      setError(err instanceof Error ? err.message : 'Failed to load mute list')
    } finally {
      setLoading(false)
    }
  }, [currentUser?.pubkey])

  useEffect(() => {
    void fetchMuteList()
  }, [fetchMuteList])

  const isMuted = useCallback(
    (pubkey: string) => {
      return mutedPubkeys.has(pubkey)
    },
    [mutedPubkeys],
  )

  const updateMuteList = useCallback(
    async (newSet: Set<string>) => {
      if (!currentUser?.pubkey) throw new Error('Not signed in')

      const ndk = getNDK()
      const event = new NDKEvent(ndk)
      event.kind = MUTE_LIST_KIND
      event.author = new NDKUser({ pubkey: currentUser.pubkey })
      event.tags = Array.from(newSet).map((p) => ['p', p])

      await withRetry(() => event.publish(), {
        maxAttempts: 3,
        baseDelayMs: 1000
      })
      
      setMutedPubkeys(newSet)
    },
    [currentUser?.pubkey],
  )

  const mute = useCallback(
    async (pubkey: string) => {
      if (!isValidHex32(pubkey)) throw new Error('Invalid pubkey')
      if (!currentUser?.pubkey) throw new Error('Not signed in')
      
      // Fetch latest to avoid overwriting updates from other sessions
      let currentSet = new Set(mutedPubkeys)
      try {
        const ndk = getNDK()
        const event = await ndk.fetchEvent({
          kinds: [MUTE_LIST_KIND],
          authors: [currentUser.pubkey],
        })
        if (event) {
          const pTags = event.tags
            .filter((t) => t[0] === 'p' && t[1])
            .map((t) => t[1] as string)
            .filter((p) => isValidHex32(p))
          currentSet = new Set(pTags)
        }
      } catch (err) {
        console.warn('Failed to fetch fresh mute list before update, using cached state', err)
      }
      
      currentSet.add(pubkey)
      await updateMuteList(currentSet)
    },
    [mutedPubkeys, currentUser?.pubkey, updateMuteList],
  )

  const unmute = useCallback(
    async (pubkey: string) => {
      if (!currentUser?.pubkey) throw new Error('Not signed in')

      // Fetch latest to avoid overwriting updates from other sessions
      let currentSet = new Set(mutedPubkeys)
      try {
        const ndk = getNDK()
        const event = await ndk.fetchEvent({
          kinds: [MUTE_LIST_KIND],
          authors: [currentUser.pubkey],
        })
        if (event) {
          const pTags = event.tags
            .filter((t) => t[0] === 'p' && t[1])
            .map((t) => t[1] as string)
            .filter((p) => isValidHex32(p))
          currentSet = new Set(pTags)
        }
      } catch (err) {
        console.warn('Failed to fetch fresh mute list before update, using cached state', err)
      }

      currentSet.delete(pubkey)
      await updateMuteList(currentSet)
    },
    [mutedPubkeys, currentUser?.pubkey, updateMuteList],
  )

  return {
    mutedPubkeys,
    loading,
    error,
    isMuted,
    mute,
    unmute,
    refresh: fetchMuteList,
  }
}
