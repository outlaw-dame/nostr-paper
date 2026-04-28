/**
 * OnboardPage
 *
 * Identity sign-in screen. Three paths:
 *  1. Continue as saved user (nsec or npub stored from prior session)
 *  2. Enter a private key (nsec) — full signing capability
 *  3. Enter a public identity (npub/hex/NIP-05) — read-only profile access
 */

import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '@/hooks/useProfile'
import { decodeProfileReference } from '@/lib/nostr/nip21'
import { parseNip05Identifier, resolveNip05Identifier } from '@/lib/nostr/nip05'
import {
  loginWithNsec,
  loginWithNip46Bunker,
  loginWithPubkey,
  isValidNip46BunkerToken,
  performLogout,
  getNDK,
  STORAGE_KEY_NSEC,
  STORAGE_KEY_NIP46_BUNKER,
  STORAGE_KEY_PUBKEY,
} from '@/lib/nostr/ndk'
import { useApp } from '@/contexts/app-context'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import { tApp } from '@/lib/i18n/app'

// ── Saved-session card ────────────────────────────────────────

function SavedUserCard({
  pubkey,
  method,
  onSelect,
}: {
  pubkey: string
  method: 'nsec' | 'npub' | 'nip46'
  onSelect: () => void
}) {
  const { profile } = useProfile(pubkey)
  const displayName = profile?.display_name?.trim() || profile?.name?.trim() || `${pubkey.slice(0, 8)}…`

  return (
    <button
      type="button"
      onClick={onSelect}
      className="
        w-full flex items-center gap-3 px-4 py-3
        rounded-[18px] bg-[rgb(var(--color-surface-elevated))]
        border border-[rgb(var(--color-fill)/0.12)]
        text-left transition-all active:scale-[0.98] active:opacity-80
      "
    >
      {/* Avatar */}
      <div className="relative h-11 w-11 shrink-0 rounded-full overflow-hidden bg-[rgb(var(--color-fill)/0.15)]">
        {profile?.picture ? (
          <img
            src={profile.picture}
            alt={displayName}
            className="h-full w-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-full w-full p-2.5 text-[rgb(var(--color-label-tertiary))]"
          >
            <circle cx="12" cy="8" r="4" />
            <path d="M20 21a8 8 0 1 0-16 0" />
          </svg>
        )}
      </div>

      {/* Name */}
      <span className="flex-1 text-[16px] font-semibold text-[rgb(var(--color-label))] truncate">
        {displayName}
      </span>

      {/* Method badge */}
      <span className="
        shrink-0 px-2.5 py-1 rounded-full
        text-[11px] font-semibold tracking-wide uppercase
        bg-[rgb(var(--color-fill)/0.12)] text-[rgb(var(--color-label-secondary))]
      ">
        {method}
      </span>

      {/* Chevron */}
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor"
        className="h-4 w-4 shrink-0 text-[rgb(var(--color-label-quaternary))]">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}

// ── Key input screen ──────────────────────────────────────────

function KeyInputScreen({
  mode,
  onBack,
  onSuccess,
}: {
  mode: 'nsec' | 'npub' | 'nip46'
  onBack: () => void
  onSuccess: (pubkey: string) => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { dispatch } = useApp()

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError(mode === 'nsec' ? tApp('onboardEnterPrivateError') : tApp('onboardEnterPublicError'))
      return
    }
    setError(null)

    if (mode === 'nsec') {
      setLoading(true)
      try {
        const pubkey = await loginWithNsec(trimmed)
        dispatch({ type: 'SET_USER', payload: { pubkey } })
        onSuccess(pubkey)
      } catch {
        setError(tApp('onboardInvalidPrivateError'))
      } finally {
        setLoading(false)
      }
    } else if (mode === 'npub') {
      setLoading(true)
      try {
        let pubkey: string | null = null

        if (trimmed.startsWith('npub1') || trimmed.startsWith('nprofile1')) {
          pubkey = decodeProfileReference(trimmed)?.pubkey ?? null
        } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
          pubkey = trimmed.toLowerCase()
        } else if (parseNip05Identifier(trimmed)) {
          pubkey = (await resolveNip05Identifier(trimmed))?.pubkey ?? null
        }

        if (!pubkey) {
          setError(tApp('onboardInvalidPublicError'))
          return
        }

        loginWithPubkey(pubkey)
        dispatch({ type: 'SET_USER', payload: { pubkey } })
        onSuccess(pubkey)
      } catch {
        setError(tApp('onboardResolvePublicError'))
      } finally {
        setLoading(false)
      }
    } else {
      setLoading(true)
      try {
        if (!isValidNip46BunkerToken(trimmed)) {
          setError(tApp('onboardInvalidNip46Error'))
          return
        }

        const pubkey = await loginWithNip46Bunker(trimmed)
        dispatch({ type: 'SET_USER', payload: { pubkey } })
        onSuccess(pubkey)
      } catch {
        setError(tApp('onboardResolveNip46Error'))
      } finally {
        setLoading(false)
      }
    }
  }, [value, mode, dispatch, onSuccess])

  const isNsec = mode === 'nsec'
  const isNpub = mode === 'npub'

  return (
    <div className="flex flex-col h-full">
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        className="mb-8 flex items-center gap-1.5 text-[rgb(var(--color-accent))] text-[15px]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
          className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        {tApp('onboardBack')}
      </button>

      <h2 className="text-[26px] font-bold tracking-tight text-[rgb(var(--color-label))] mb-1">
        {isNsec
          ? tApp('onboardEnterPrivateTitle')
          : (isNpub ? tApp('onboardEnterPublicTitle') : tApp('onboardEnterNip46Title'))}
      </h2>
      <p className="text-[15px] text-[rgb(var(--color-label-secondary))] mb-8 leading-relaxed">
        {isNsec
          ? tApp('onboardPrivateHint')
          : (isNpub ? tApp('onboardPublicHint') : tApp('onboardNip46Hint'))}
      </p>

      {/* Input */}
      <div className="relative mb-2">
        <input
          type={isNsec ? 'password' : 'text'}
          placeholder={isNsec
            ? tApp('onboardPrivatePlaceholder')
            : (isNpub ? tApp('onboardPublicPlaceholder') : tApp('onboardNip46Placeholder'))}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit() }}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          className="
            w-full rounded-[16px] px-4 py-4
            bg-[rgb(var(--color-surface-elevated))]
            border border-[rgb(var(--color-fill)/0.16)]
            text-[15px] text-[rgb(var(--color-label))]
            placeholder:text-[rgb(var(--color-label-quaternary))]
            outline-none focus:border-[rgb(var(--color-accent)/0.5)]
            transition-colors font-mono
          "
        />
      </div>

      {error && (
        <p className="mb-4 text-[13px] text-[rgb(var(--color-system-red))]">{error}</p>
      )}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={loading || !value.trim()}
        className="
          mt-auto w-full rounded-full py-4
          bg-[rgb(var(--color-label))] text-[rgb(var(--color-bg))]
          text-[17px] font-semibold
          disabled:opacity-40
          transition-all active:scale-[0.98]
        "
      >
        {loading
          ? tApp('onboardConnecting')
          : (isNsec ? tApp('onboardSignIn') : (isNpub ? tApp('onboardBrowseReadOnly') : tApp('onboardConnectNip46')))}
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function OnboardPage() {
  const navigate = useNavigate()
  const { dispatch } = useApp()

  const [inputMode, setInputMode] = useState<'nsec' | 'npub' | 'nip46' | null>(null)
  const [extError, setExtError] = useState<string | null>(null)
  const [extLoading, setExtLoading] = useState(false)

  // Detect any saved credentials to show "continue as" card
  const [savedPubkey, setSavedPubkey] = useState<string | null>(null)
  const [savedMethod, setSavedMethod] = useState<'nsec' | 'npub' | 'nip46' | null>(null)

  useEffect(() => {
    const nsec = localStorage.getItem(STORAGE_KEY_NSEC)
    if (nsec) {
      try {
        const signer = new NDKPrivateKeySigner(nsec)
        signer.user().then(u => {
          setSavedPubkey(u.pubkey)
          setSavedMethod('nsec')
        }).catch(() => {
          localStorage.removeItem(STORAGE_KEY_NSEC)
        })
      } catch {
        localStorage.removeItem(STORAGE_KEY_NSEC)
      }
      return
    }
    const npub = localStorage.getItem(STORAGE_KEY_PUBKEY)
    if (npub) {
      setSavedPubkey(npub)
      setSavedMethod('npub')
      return
    }

    const bunker = localStorage.getItem(STORAGE_KEY_NIP46_BUNKER)
    if (bunker && isValidNip46BunkerToken(bunker)) {
      try {
        const parsed = new URL(bunker)
        const userPubkey = parsed.searchParams.get('pubkey')
        if (userPubkey && /^[0-9a-f]{64}$/i.test(userPubkey)) {
          setSavedPubkey(userPubkey.toLowerCase())
          setSavedMethod('nip46')
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY_NIP46_BUNKER)
      }
    }
  }, [])

  const hasExtension = typeof window !== 'undefined' && 'nostr' in window

  const handleContinueSaved = useCallback(async () => {
    if (!savedPubkey) return
    let restored = false
    const nsec = localStorage.getItem(STORAGE_KEY_NSEC)
    if (nsec) {
      try {
        const pubkey = await loginWithNsec(nsec)
        dispatch({ type: 'SET_USER', payload: { pubkey } })
        restored = true
      } catch {
        localStorage.removeItem(STORAGE_KEY_NSEC)
      }
    } else if (savedMethod === 'nip46') {
      const bunker = localStorage.getItem(STORAGE_KEY_NIP46_BUNKER)
      if (!bunker) return
      try {
        const pubkey = await loginWithNip46Bunker(bunker)
        dispatch({ type: 'SET_USER', payload: { pubkey } })
        restored = true
      } catch {
        localStorage.removeItem(STORAGE_KEY_NIP46_BUNKER)
        setSavedPubkey(null)
        setSavedMethod(null)
      }
    } else {
      dispatch({ type: 'SET_USER', payload: { pubkey: savedPubkey } })
      restored = true
    }
    if (restored) {
      navigate('/', { replace: true })
    }
  }, [savedPubkey, savedMethod, dispatch, navigate])

  const handleExtension = useCallback(async () => {
    setExtLoading(true)
    setExtError(null)
    try {
      const ndk = getNDK()
      if (!ndk.signer) {
        setExtError(tApp('onboardExtensionConnectError'))
        return
      }
      const user = await ndk.signer.user()
      dispatch({ type: 'SET_USER', payload: { pubkey: user.pubkey } })
      navigate('/', { replace: true })
    } catch (err) {
      setExtError(err instanceof Error ? err.message : tApp('onboardExtensionLoginFailed'))
    } finally {
      setExtLoading(false)
    }
  }, [dispatch, navigate])

  const handleForgetSaved = useCallback(() => {
    performLogout()
    setSavedPubkey(null)
    setSavedMethod(null)
  }, [])

  const handleSuccess = useCallback(() => {
    navigate('/', { replace: true })
  }, [navigate])

  // ── Key input sub-screen ──────────────────────────────────

  if (inputMode) {
    return (
      <div className="min-h-dvh bg-[rgb(var(--color-bg))] flex flex-col px-6 pt-safe-top pb-safe-bottom">
        <div className="flex-1 flex flex-col pt-12 pb-8 max-w-sm mx-auto w-full">
          <KeyInputScreen
            mode={inputMode}
            onBack={() => setInputMode(null)}
            onSuccess={handleSuccess}
          />
        </div>
      </div>
    )
  }

  // ── Main menu ─────────────────────────────────────────────

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] flex flex-col px-6 pt-safe-top pb-safe-bottom">
      <div className="flex-1 flex flex-col pt-16 pb-8 max-w-sm mx-auto w-full">

        {/* Wordmark / branding */}
        <div className="mb-10">
          <h1 className="text-[34px] font-bold tracking-[-0.03em] text-[rgb(var(--color-label))]">
            {tApp('onboardBrandTitle')}
          </h1>
          <p className="mt-1 text-[16px] text-[rgb(var(--color-label-secondary))]">
            {tApp('onboardBrandSubtitle')}
          </p>
        </div>

        {/* Saved session */}
        {savedPubkey && savedMethod && (
          <div className="mb-6">
            <p className="mb-2 text-[13px] font-medium text-[rgb(var(--color-label-secondary))] uppercase tracking-wide px-1">
              {tApp('onboardContinueAs')}
            </p>
            <SavedUserCard
              pubkey={savedPubkey}
              method={savedMethod}
              onSelect={() => void handleContinueSaved()}
            />
          </div>
        )}

        {/* Divider */}
        {savedPubkey && (
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-[rgb(var(--color-fill)/0.16)]" />
            <span className="text-[13px] text-[rgb(var(--color-label-tertiary))]">{tApp('onboardDividerOr')}</span>
            <div className="flex-1 h-px bg-[rgb(var(--color-fill)/0.16)]" />
          </div>
        )}

        {/* Primary CTA */}
        <button
          type="button"
          onClick={() => setInputMode('nsec')}
          className="
            w-full rounded-full py-[15px]
            bg-[rgb(var(--color-label))] text-[rgb(var(--color-bg))]
            text-[17px] font-semibold
            transition-all active:scale-[0.98] active:opacity-90
            mb-3
          "
        >
          {tApp('onboardSignInCta')}
        </button>

        {/* Extension (if available) */}
        {hasExtension && (
          <button
            type="button"
            onClick={() => void handleExtension()}
            disabled={extLoading}
            className="
              w-full rounded-full py-[15px]
              bg-[rgb(var(--color-surface-elevated))]
              border border-[rgb(var(--color-fill)/0.16)]
              text-[17px] font-semibold text-[rgb(var(--color-label))]
              disabled:opacity-50
              transition-all active:scale-[0.98]
              mb-3
            "
          >
            {extLoading ? tApp('onboardConnecting') : tApp('onboardUseExtension')}
          </button>
        )}

        <button
          type="button"
          onClick={() => setInputMode('nip46')}
          className="
            w-full rounded-full py-[15px]
            bg-[rgb(var(--color-surface-elevated))]
            border border-[rgb(var(--color-fill)/0.16)]
            text-[17px] font-semibold text-[rgb(var(--color-label))]
            transition-all active:scale-[0.98]
            mb-3
          "
        >
          {tApp('onboardUseNip46')}
        </button>

        {extError && (
          <p className="mb-3 text-[13px] text-[rgb(var(--color-system-red))] text-center">{extError}</p>
        )}

        {/* Read-only / browse */}
        <button
          type="button"
          onClick={() => setInputMode('npub')}
          className="
            w-full py-3 text-[15px] font-medium
            text-[rgb(var(--color-accent))]
            transition-opacity active:opacity-60
          "
        >
          {tApp('onboardBrowsePublic')}
        </button>

        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="
            w-full py-3 text-[15px]
            text-[rgb(var(--color-label-tertiary))]
            transition-opacity active:opacity-60
          "
        >
          {tApp('onboardBrowseAnonymous')}
        </button>

        {/* Manage saved logins */}
        {savedPubkey && (
          <div className="mt-auto pt-8 text-center">
            <button
              type="button"
              onClick={handleForgetSaved}
              className="text-[14px] text-[rgb(var(--color-label-quaternary))] underline-offset-2 hover:underline"
            >
              {tApp('onboardForgetSaved')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
