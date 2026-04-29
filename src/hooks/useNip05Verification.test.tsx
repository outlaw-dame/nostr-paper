// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deriveNip05UiState,
  useNip05Verification,
  type Nip05UiState,
} from './useNip05Verification'
import type { Profile } from '@/types'

const verifyProfileNip05Mock = vi.fn()

vi.mock('@/lib/nostr/nip05', () => ({
  verifyProfileNip05: (...args: unknown[]) => verifyProfileNip05Mock(...args),
}))

vi.mock('@/lib/security/sanitize', () => ({
  isValidHex32: (v: string) => /^[0-9a-f]{64}$/.test(v),
}))

const VALID_PUBKEY = 'a'.repeat(64)
const NOW_SECONDS = 1_700_000_000

type ProfileOverrides = { [K in keyof Profile]?: Profile[K] | undefined }

function makeProfile(overrides: ProfileOverrides = {}): Profile {
  const base: Profile = {
    pubkey: VALID_PUBKEY,
    updatedAt: NOW_SECONDS,
    nip05: 'alice@example.com',
    nip05Verified: true,
    nip05VerifiedAt: NOW_SECONDS - 100,
    nip05LastCheckedAt: NOW_SECONDS - 100,
  }
  for (const [key, value] of Object.entries(overrides) as [keyof Profile, unknown][]) {
    if (value === undefined) {
      delete (base as Partial<Profile>)[key]
    } else {
      ;(base as unknown as Record<string, unknown>)[key] = value
    }
  }
  return base
}

afterEach(() => {
  vi.restoreAllMocks()
  verifyProfileNip05Mock.mockReset()
})

// ── Pure state derivation (no React) ───────────────────────────

describe('deriveNip05UiState', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_SECONDS * 1000)
  })

  it('returns idle when profile has no nip05', () => {
    expect(deriveNip05UiState(makeProfile({ nip05: undefined }))).toBe('idle')
  })

  it('returns idle when nip05LastCheckedAt is absent', () => {
    expect(deriveNip05UiState(makeProfile({ nip05LastCheckedAt: undefined }))).toBe('idle')
  })

  it('returns verified for a recently checked, verified profile', () => {
    expect(deriveNip05UiState(makeProfile())).toBe('verified')
  })

  it('returns stale when success TTL is nearly elapsed', () => {
    const staleCheckedAt = NOW_SECONDS - (12 * 60 * 60 - 30 * 60)
    expect(
      deriveNip05UiState(makeProfile({ nip05LastCheckedAt: staleCheckedAt })),
    ).toBe('stale')
  })

  it('returns invalid for a profile that failed verification', () => {
    expect(
      deriveNip05UiState(makeProfile({ nip05Verified: false })),
    ).toBe('invalid')
  })

  it('returns idle for null profile', () => {
    expect(deriveNip05UiState(null)).toBe('idle')
  })
})

// ── Hook integration via React component wrapper ────────────────

interface HookResult {
  state: Nip05UiState
  verify: () => void
}

function HookWrapper({
  pubkey,
  profile,
  onResult,
}: {
  pubkey: string | null
  profile: Profile | null
  onResult: (r: HookResult) => void
}) {
  const result = useNip05Verification(pubkey, profile)
  onResult(result)
  return null
}

describe('useNip05Verification — verify() via component', () => {
  let container: HTMLDivElement
  let root: Root
  let capturedResult: HookResult

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_SECONDS * 1000)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    capturedResult = { state: 'idle', verify: () => {} }
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
  })

  async function render(pubkey: string | null, profile: Profile | null): Promise<void> {
    await act(async () => {
      root.render(
        <HookWrapper
          pubkey={pubkey}
          profile={profile}
          onResult={(r) => { capturedResult = r }}
        />,
      )
    })
  }

  it('starts idle when no nip05LastCheckedAt', async () => {
    await render(VALID_PUBKEY, makeProfile({ nip05LastCheckedAt: undefined }))
    expect(capturedResult.state).toBe('idle')
  })

  it('transitions idle → verifying → verified', async () => {
    // Use a deferred promise so we can observe the verifying intermediate state.
    let externalResolve!: (v: string) => void
    verifyProfileNip05Mock.mockReturnValue(
      new Promise<string>((r) => { externalResolve = r }),
    )
    await render(VALID_PUBKEY, makeProfile({ nip05LastCheckedAt: undefined }))

    expect(capturedResult.state).toBe('idle')

    await act(async () => { capturedResult.verify() })
    expect(capturedResult.state).toBe('verifying')

    await act(async () => {
      externalResolve('verified')
      await Promise.resolve()
    })
    expect(capturedResult.state).toBe('verified')
    expect(verifyProfileNip05Mock).toHaveBeenCalledTimes(1)
  })

  it('transitions to invalid when server returns invalid', async () => {
    verifyProfileNip05Mock.mockResolvedValue('invalid')
    await render(VALID_PUBKEY, makeProfile({ nip05LastCheckedAt: undefined }))
    await act(async () => { capturedResult.verify() })
    await act(async () => { await Promise.resolve() })
    expect(capturedResult.state).toBe('invalid')
  })

  it('transitions to lookup_error when server returns unavailable', async () => {
    verifyProfileNip05Mock.mockResolvedValue('unavailable')
    await render(VALID_PUBKEY, makeProfile({ nip05LastCheckedAt: undefined }))
    await act(async () => { capturedResult.verify() })
    await act(async () => { await Promise.resolve() })
    expect(capturedResult.state).toBe('lookup_error')
  })

  it('is a no-op when pubkey is null', async () => {
    await render(null, makeProfile())
    await act(async () => { capturedResult.verify() })
    expect(verifyProfileNip05Mock).not.toHaveBeenCalled()
  })

  it('is a no-op when profile has no nip05', async () => {
    await render(VALID_PUBKEY, makeProfile({ nip05: undefined }))
    await act(async () => { capturedResult.verify() })
    expect(verifyProfileNip05Mock).not.toHaveBeenCalled()
  })

  it('ignores a second verify() call while already verifying', async () => {
    let externalResolve!: (v: string) => void
    verifyProfileNip05Mock.mockReturnValue(
      new Promise<string>((r) => { externalResolve = r }),
    )
    await render(VALID_PUBKEY, makeProfile({ nip05LastCheckedAt: undefined }))

    await act(async () => { capturedResult.verify() })
    await act(async () => { capturedResult.verify() })

    expect(verifyProfileNip05Mock).toHaveBeenCalledTimes(1)

    await act(async () => {
      externalResolve('verified')
      await Promise.resolve()
    })
    expect(capturedResult.state).toBe('verified')
  })
})
