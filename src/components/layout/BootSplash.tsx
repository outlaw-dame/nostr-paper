/**
 * BootSplash
 *
 * Full-screen loading state shown during app initialization.
 * Animated with Framer Motion spring physics.
 * `minimal` prop shows a lighter version for Suspense fallbacks.
 */

import { motion } from 'motion/react'

interface BootSplashProps {
  minimal?: boolean
}

export function BootSplash({ minimal = false }: BootSplashProps) {
  if (minimal) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <SpinnerRing />
      </div>
    )
  }

  return (
    <div
      className="
        fixed inset-0 z-50 flex flex-col items-center justify-center
        bg-[rgb(var(--color-bg))]
      "
      role="status"
      aria-label="Loading Nostr Paper"
      style={{
        backgroundImage: 'radial-gradient(circle at top, rgb(var(--color-bg-secondary)) 0%, rgb(var(--color-bg)) 42%)',
      }}
    >
      {/* Logo mark */}
      <motion.div
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.1 }}
        className="mb-8"
      >
        <LogoMark />
      </motion.div>

      {/* App name */}
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.25 }}
        className="
          text-[rgb(var(--color-label))] font-system font-semibold tracking-tight
          text-[28px] leading-[34px] mb-2
        "
      >
        Paper
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.5 }}
        className="mb-12 text-[15px] text-[rgb(var(--color-label-secondary))]"
      >
        Stories from Nostr
      </motion.p>

      {/* Loading indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.6 }}
      >
        <SpinnerRing light />
      </motion.div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────

function LogoMark() {
  return (
    <div
      className="
        h-20 w-20 rounded-[24px]
        bg-[rgb(var(--color-surface-elevated)/0.86)]
        flex items-center justify-center
        border border-[rgb(var(--color-divider)/0.08)]
        shadow-[0_20px_48px_rgba(15,20,30,0.12),inset_0_1px_0_rgba(255,255,255,0.36)]
      "
    >
      {/* Paper stack icon — simple SVG */}
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
      >
        {/* Bottom sheet */}
        <rect x="6" y="14" width="28" height="20" rx="4"
              fill="rgb(var(--color-fill))" fillOpacity="0.16" />
        {/* Middle sheet */}
        <rect x="4" y="10" width="28" height="20" rx="4"
              fill="rgb(var(--color-fill))" fillOpacity="0.28" />
        {/* Top sheet */}
        <rect x="2" y="6" width="28" height="20" rx="4"
              fill="rgb(var(--color-surface-elevated))" />
        {/* Lines representing text */}
        <rect x="7"  y="12" width="16" height="2" rx="1" fill="rgb(var(--color-label))" fillOpacity="0.28" />
        <rect x="7"  y="17" width="12" height="2" rx="1" fill="rgb(var(--color-label))" fillOpacity="0.18" />
        <rect x="7"  y="22" width="14" height="2" rx="1" fill="rgb(var(--color-label))" fillOpacity="0.18" />
      </svg>
    </div>
  )
}

function SpinnerRing({ light = false }: { light?: boolean }) {
  return (
    <div
      className={`
        w-8 h-8 rounded-full border-2
        ${light
          ? 'border-[rgb(var(--color-fill)/0.18)] border-t-[rgb(var(--color-label)/0.82)]'
          : 'border-[rgb(var(--color-fill)/0.18)] border-t-[rgb(var(--color-label)/0.62)]'
        }
        animate-spin
      `}
      style={{ animationDuration: '0.8s', animationTimingFunction: 'linear' }}
    />
  )
}
