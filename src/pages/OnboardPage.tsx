/**
 * OnboardPage
 *
 * Identity sign-in screen. Three paths:
 *  1. Continue as saved user (nsec or npub stored from prior session)
 *  2. Enter a private key (nsec) — full signing capability
 *  3. Enter a public key (npub/hex) — read-only profile access
 */

import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '@/hooks/useProfile'
import { decodeProfileReference } from '@/lib/nostr/nip21'
import {
  loginWithNsec,
  loginWithPubkey,
  performLogout,
  getNDK,
  STORAGE_KEY_NSEC,
  STORAGE_KEY_PUBKEY,
} from '@/lib/nostr/ndk'
import { useApp } from '@/contexts/app-context'
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'

// ── Saved-session card ────────────────────────────────────────

function SavedUserCard({
  pubkey,
  method,
  onSelect,
}: {
  pubkey: string
  method: 'nsec' | 'npub'
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
  mode: 'nsec' | 'npub'
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
      setError(mode === 'nsec' ? 'Enter your private key.' : 'Enter your public key.')
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
        setError('Invalid private key — make sure it starts with nsec1…')
      } finally {
        setLoading(false)
      }
    } else {
      let pubkey: string | null = null
      if (trimmed.startsWith('npub1')) {
        pubkey = decodeProfileReference(trimmed)?.pubkey ?? null
      } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
        pubkey = trimmed.toLowerCase()
      }
      if (!pubkey) {
        setError('Invalid public key — use npub1… or 64-character hex.')
        return
      }
      loginWithPubkey(pubkey)
      dispatch({ type: 'SET_USER', payload: { pubkey } })
      onSuccess(pubkey)
    }
  }, [value, mode, dispatch, onSuccess])

  const isNsec = mode === 'nsec'

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
        Back
      </button>

      <h2 className="text-[26px] font-bold tracking-tight text-[rgb(var(--color-label))] mb-1">
        {isNsec ? 'Enter private key' : 'Enter public key'}
      </h2>
      <p className="text-[15px] text-[rgb(var(--color-label-secondary))] mb-8 leading-relaxed">
        {isNsec
          ? 'Your key is stored only in this browser and never sent anywhere.'
          : 'Read-only access — view your profile without signing events.'}
      </p>

      {/* Input */}
      <div className="relative mb-2">
        <input
          type={isNsec ? 'password' : 'text'}
          placeholder={isNsec ? 'nsec1…' : 'npub1… or hex pubkey'}
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
        {loading ? 'Signing in…' : isNsec ? 'Sign In' : 'Browse Read-Only'}
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function OnboardPage() {
  const navigate = useNavigate()
  const { dispatch } = useApp()

  const [inputMode, setInputMode] = useState<'nsec' | 'npub' | null>(null)
  const [extError, setExtError] = useState<string | null>(null)
  const [extLoading, setExtLoading] = useState(false)

  // Detect any saved credentials to show "continue as" card
  const [savedPubkey, setSavedPubkey] = useState<string | null>(null)
  const [savedMethod, setSavedMethod] = useState<'nsec' | 'npub' | null>(null)

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
    }
  }, [])

  const hasExtension = typeof window !== 'undefined' && 'nostr' in window

  const handleContinueSaved = useCallback(async () => {
    if (!savedPubkey) return
    const nsec = localStorage.getItem(STORAGE_KEY_NSEC)
    if (nsec) {
      try {
        const pubkey = await loginWithNsec(nsec)
        dispatch({ type: 'SET_USER', payload: { pubkey } })
      } catch {
        localStorage.removeItem(STORAGE_KEY_NSEC)
      }
    } else {
      dispatch({ type: 'SET_USER', payload: { pubkey: savedPubkey } })
    }
    navigate('/', { replace: true })
  }, [savedPubkey, dispatch, navigate])

  const handleExtension = useCallback(async () => {
    setExtLoading(true)
    setExtError(null)
    try {
      const ndk = getNDK()
      if (!ndk.signer) {
        setExtError('Extension found but could not connect. Try refreshing.')
        return
      }
      const user = await ndk.signer.user()
      dispatch({ type: 'SET_USER', payload: { pubkey: user.pubkey } })
      navigate('/', { replace: true })
    } catch (err) {
      setExtError(err instanceof Error ? err.message : 'Extension login failed.')
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
            Paper
          </h1>
          <p className="mt-1 text-[16px] text-[rgb(var(--color-label-secondary))]">
            Your Nostr reader
          </p>
        </div>

        {/* Saved session */}
        {savedPubkey && savedMethod && (
          <div className="mb-6">
            <p className="mb-2 text-[13px] font-medium text-[rgb(var(--color-label-secondary))] uppercase tracking-wide px-1">
              Continue as
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
            <span className="text-[13px] text-[rgb(var(--color-label-tertiary))]">or</span>
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
          Enter your Nostr key to sign in
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
            {extLoading ? 'Connecting…' : 'Use Browser Extension'}
          </button>
        )}

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
          Browse read-only with a public key
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
          Browse without an account
        </button>

        {/* Manage saved logins */}
        {savedPubkey && (
          <div className="mt-auto pt-8 text-center">
            <button
              type="button"
              onClick={handleForgetSaved}
              className="text-[14px] text-[rgb(var(--color-label-quaternary))] underline-offset-2 hover:underline"
            >
              Forget saved login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
