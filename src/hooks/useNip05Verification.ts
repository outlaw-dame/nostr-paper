import { useCallback, useEffect, useRef, useState } from 'react'
import { verifyProfileNip05 } from '@/lib/nostr/nip05'
import { isValidHex32 } from '@/lib/security/sanitize'
import type { Profile } from '@/types'

const NIP05_SUCCESS_TTL_SECONDS = 12 * 60 * 60
const NIP05_STALE_BUFFER_SECONDS = 60 * 60

export type Nip05UiState =
  | 'idle'
  | 'verifying'
  | 'verified'
  | 'stale'
  | 'invalid'
  | 'lookup_error'

export function deriveNip05UiState(profile: Profile | null | undefined): Nip05UiState {
  if (!profile?.nip05) return 'idle'
  if (!profile.nip05LastCheckedAt) return 'idle'

  const ageSeconds = Math.floor(Date.now() / 1000) - profile.nip05LastCheckedAt

  if (!profile.nip05Verified) return 'invalid'

  if (ageSeconds > NIP05_SUCCESS_TTL_SECONDS - NIP05_STALE_BUFFER_SECONDS) return 'stale'

  return 'verified'
}

export interface UseNip05VerificationResult {
  state: Nip05UiState
  verify: () => void
}

export function useNip05Verification(
  pubkey: string | null | undefined,
  profile: Profile | null | undefined,
): UseNip05VerificationResult {
  const [state, setState] = useState<Nip05UiState>(() => deriveNip05UiState(profile))
  const inflightRef = useRef<AbortController | null>(null)

  // Sync state when profile data changes (e.g. after relay fetch or DB update).
  useEffect(() => {
    if (state !== 'verifying') {
      setState(deriveNip05UiState(profile))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile?.nip05,
    profile?.nip05Verified,
    profile?.nip05LastCheckedAt,
  ])

  // Abort any in-flight verification on unmount.
  useEffect(() => {
    return () => {
      inflightRef.current?.abort()
    }
  }, [])

  const verify = useCallback(() => {
    if (!pubkey || !isValidHex32(pubkey)) return
    if (!profile?.nip05) return
    if (state === 'verifying') return

    inflightRef.current?.abort()
    const controller = new AbortController()
    inflightRef.current = controller

    setState('verifying')

    verifyProfileNip05(pubkey, controller.signal)
      .then((status) => {
        if (controller.signal.aborted) return
        switch (status) {
          case 'verified':
            setState('verified')
            break
          case 'invalid':
            setState('invalid')
            break
          case 'unavailable':
            setState('lookup_error')
            break
          case 'skipped':
            setState(deriveNip05UiState(profile))
            break
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setState('lookup_error')
      })
  }, [pubkey, profile, state])

  return { state, verify }
}
