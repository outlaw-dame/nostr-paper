/**
 * useFollowStatus
 *
 * Returns whether the current authenticated user follows a given pubkey.
 * Optimised for the feed scroll path: when a current user is bound on the
 * follow-set singleton (see `lib/db/followSet.ts`), the answer is read
 * synchronously from an in-memory Set, so a feed of N cards does NOT issue
 * N database round-trips. Falls back to a one-shot SQLite query only when
 * the singleton hasn't loaded yet.
 *
 * Used for blurring images from unfollowed users.
 */

import { useEffect, useState } from 'react'
import { getCurrentUser } from '@/lib/nostr/ndk'
import { isFollowing } from '@/lib/db/nostr'
import { useCurrentUserFollowSet } from '@/lib/db/followSet'
import { isValidHex32 } from '@/lib/security/sanitize'

/**
 * Returns:
 *   - `null`  — still loading (or no current user)
 *   - `true`  — current user follows this pubkey
 *   - `false` — current user does not follow this pubkey
 */
export function useFollowStatus(pubkey: string | null | undefined): boolean | null {
  const followSet = useCurrentUserFollowSet()
  const [fallback, setFallback] = useState<boolean | null>(null)

  // Whether the synchronous answer from the in-memory follow set is usable
  // for this render. Computed first so the effect below can skip the DB
  // query whenever the singleton already has the answer.
  const haveSyncAnswer = Boolean(
    pubkey && isValidHex32(pubkey) && followSet.loaded && followSet.pubkey,
  )

  useEffect(() => {
    if (!pubkey || !isValidHex32(pubkey)) {
      setFallback(null)
      return
    }
    if (haveSyncAnswer) return

    let cancelled = false

    async function check() {
      const user = await getCurrentUser()
      if (cancelled || !user) return

      // A user always "follows" themselves — never blur own content.
      if (user.pubkey === pubkey) {
        setFallback(true)
        return
      }

      const following = await isFollowing(user.pubkey, pubkey!)
      if (!cancelled) setFallback(following)
    }

    check().catch(() => { if (!cancelled) setFallback(false) })

    return () => { cancelled = true }
  }, [pubkey, haveSyncAnswer])

  if (haveSyncAnswer && pubkey) {
    if (followSet.pubkey === pubkey) return true
    return followSet.hasPubkey(pubkey)
  }
  return fallback
}
