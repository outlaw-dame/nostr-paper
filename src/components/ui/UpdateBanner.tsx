/**
 * Utility UI Components
 *
 * - ErrorScreen:    Unrecoverable error with reload option
 * - UpdateBanner:   PWA update available prompt
 * - OfflineBanner:  Network offline indicator
 */

import { motion, AnimatePresence } from 'motion/react'
import { useState } from 'react'
import type { ErrorCodeValue } from '@/types'
import { ActionButton } from './ActionButton'

// ── ErrorScreen ──────────────────────────────────────────────

interface ErrorScreenProps {
  code?:    ErrorCodeValue | string
  message:  string
}

export function ErrorScreen({ code, message }: ErrorScreenProps) {
  const handleReload = () => window.location.reload()

  return (
    <div
      className="
        fixed inset-0 flex flex-col items-center justify-center
        bg-[rgb(var(--color-bg))] px-6 text-center
      "
      role="alert"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="max-w-sm w-full"
      >
        {/* Error icon */}
        <div className="
          w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20
          flex items-center justify-center mx-auto mb-6
        ">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <path d="M14 8v7M14 18.5v1" stroke="#FF3B30"
                  strokeWidth="2" strokeLinecap="round" />
            <circle cx="14" cy="14" r="12" stroke="#FF3B30" strokeWidth="1.5" />
          </svg>
        </div>

        <h1 className="
          text-[rgb(var(--color-label))] text-[22px] font-bold
          tracking-tight mb-2
        ">
          Something went wrong
        </h1>

        <p className="
          text-[rgb(var(--color-label-secondary))] text-[15px]
          leading-relaxed mb-8
        ">
          {message}
        </p>

        {code && (
          <p className="
            text-[rgb(var(--color-label-tertiary))] text-[11px]
            font-mono mb-6 opacity-60
          ">
            {code}
          </p>
        )}

        <ActionButton
          onClick={handleReload}
          className="
            w-full py-3 rounded-[14px] bg-[#007AFF] text-white
            text-[17px] font-semibold
            active:scale-[0.97] transition-transform
            tap-none
          "
        >
          Try Again
        </ActionButton>
      </motion.div>
    </div>
  )
}

// ── UpdateBanner ─────────────────────────────────────────────

interface UpdateBannerProps {
  onUpdate?: () => Promise<void>
  onDismiss?: () => void
}

export function UpdateBanner({ onUpdate, onDismiss }: UpdateBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  const [updating, setUpdating] = useState(false)

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  const handleUpdate = async () => {
    if (updating) return
    setUpdating(true)

    try {
      if (onUpdate) {
        await onUpdate()
        return
      }

      navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' })
      window.location.reload()
    } finally {
      setUpdating(false)
    }
  }

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="
            fixed top-safe left-4 right-4 z-50
            glass-liquid rounded-ios-lg px-4 py-3
            flex items-center gap-3
          "
          role="status"
        >
          <div className="flex-1">
            <p className="
              text-[rgb(var(--color-label))] text-[14px] font-semibold
            ">
              Update available
            </p>
            <p className="
              text-[rgb(var(--color-label-secondary))] text-[12px]
            ">
              A new version of Paper is ready
            </p>
          </div>

          <ActionButton
            onClick={handleDismiss}
            className="
              text-[rgb(var(--color-label-tertiary))] text-[13px]
              px-2 py-1 tap-none
            "
            aria-label="Dismiss update banner"
          >
            Later
          </ActionButton>

          <ActionButton
            onClick={handleUpdate}
            className="
              bg-[#007AFF] text-white text-[13px] font-semibold
              px-3 py-1.5 rounded-[8px]
              active:opacity-80 transition-opacity
              tap-none
            "
          >
            {updating ? 'Updating…' : 'Update'}
          </ActionButton>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── OfflineBanner ────────────────────────────────────────────

export function OfflineBanner() {
  return (
    <AnimatePresence>
      <motion.div
        key="offline-banner"
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0,   opacity: 1 }}
        exit={{   y: -40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="
          fixed top-safe left-0 right-0 z-40
          bg-[rgb(var(--color-bg-secondary))]
          border-b border-[rgb(var(--color-fill)/0.15)]
          px-4 py-2 flex items-center justify-center gap-2
        "
        role="status"
        aria-live="polite"
      >
        <div className="w-2 h-2 rounded-full bg-[rgb(var(--color-label-secondary))]" />
        <p className="text-[rgb(var(--color-label-secondary))] text-[13px]">
          Offline — showing cached content
        </p>
      </motion.div>
    </AnimatePresence>
  )
}
