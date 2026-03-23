/**
 * useFollowStatus
 *
 * Returns whether the current authenticated user follows a given pubkey.
 * Reads from the local SQLite follows table — no relay fetch.
 *
 * Used for blurring images from unfollowed users.
 */

import { useEffect, useState } from 'react'
import { getCurrentUser } from '@/lib/nostr/ndk'
import { isFollowing } from '@/lib/db/nostr'
import { isValidHex32 } from '@/lib/security/sanitize'

/**
 * Returns:
 *   - `null`  — still loading (or no current user)
 *   - `true`  — current user follows this pubkey
 *   - `false` — current user does not follow this pubkey
 */
export function useFollowStatus(pubkey: string | null | undefined): boolean | null {
  const [status, setStatus] = useState<boolean | null>(null)

  useEffect(() => {
    if (!pubkey || !isValidHex32(pubkey)) {
      setStatus(null)
      return
    }

    let cancelled = false

    async function check() {
      const user = await getCurrentUser()
      if (cancelled || !user) return

      // A user always "follows" themselves — never blur own content
      if (user.pubkey === pubkey) {
        setStatus(true)
        return
      }

      const following = await isFollowing(user.pubkey, pubkey!)
      if (!cancelled) setStatus(following)
    }

    check().catch(() => { if (!cancelled) setStatus(false) })

    return () => { cancelled = true }
  }, [pubkey])

  return status
}
