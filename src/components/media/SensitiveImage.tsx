/**
 * SensitiveImage
 *
 * Wraps PanoramaImage with content-sensitivity controls:
 *
 *  - Images from users NOT in the current user's follow list are blurred
 *    by default (Damus-style "mark images from strangers as sensitive")
 *  - Events with a NIP-36 content-warning tag always show an overlay
 *    regardless of follow status
 *  - Tap/click the overlay to reveal
 *
 * Props:
 *   isSensitive     — from NIP-36 content-warning tag
 *   reason          — optional reason string from the content-warning tag
 *   isUnfollowed    — true when author is not in current user's follow list
 *   disableTilt     — passed through to PanoramaImage
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { PanoramaImage } from './PanoramaImage'

interface SensitiveImageProps {
  src:           string
  className?:    string
  alt?:          string
  disableTilt?:  boolean
  isSensitive:   boolean    // NIP-36 content-warning present
  reason?:       string | null | undefined
  isUnfollowed:  boolean    // Author not in follow list
}

export function SensitiveImage({
  src,
  className = '',
  alt = '',
  disableTilt = false,
  isSensitive,
  reason,
  isUnfollowed,
}: SensitiveImageProps) {
  const needsReveal = isSensitive || isUnfollowed
  const [revealed, setRevealed] = useState(false)

  const showOverlay = needsReveal && !revealed

  function toggleReveal(e: React.MouseEvent) {
    e.stopPropagation()
    setRevealed(prev => !prev)
  }

  return (
    <div className={`relative ${className}`}>
      {/* The actual image — blurred until revealed */}
      <div
        className="w-full h-full transition-[filter] duration-300"
        style={{ filter: showOverlay ? 'blur(24px) brightness(0.6)' : 'none' }}
      >
        <PanoramaImage
          src={src}
          className="w-full h-full"
          alt={alt}
          disableTilt={disableTilt || showOverlay}
        />
      </div>

      {/* Blur overlay — shown when content needs revealing */}
      <AnimatePresence>
        {showOverlay && (
          <motion.button
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="
              absolute inset-0 flex flex-col items-center justify-center
              gap-2 cursor-pointer select-none
            "
            onClick={toggleReveal}
            aria-label={isSensitive ? 'Sensitive content — tap to reveal' : "Image from someone you don't follow — tap to reveal"}
          >
            {/* Shield / eye-slash icon */}
            <div className="
              w-12 h-12 rounded-full
              bg-black/50 backdrop-blur-sm
              flex items-center justify-center
            ">
              {isSensitive ? (
                <svg
                  width="22" height="22" viewBox="0 0 24 24"
                  fill="none" stroke="white" strokeWidth="1.75"
                  strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              ) : (
                <svg
                  width="22" height="22" viewBox="0 0 24 24"
                  fill="none" stroke="white" strokeWidth="1.75"
                  strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              )}
            </div>

            {/* Label */}
            <div className="text-center px-4">
              <p className="
                text-white text-[13px] font-semibold
                [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]
              ">
                {isSensitive ? 'Sensitive Content' : 'Unknown Author'}
              </p>
              {isSensitive && reason && (
                <p className="
                  text-white/80 text-[11px] mt-0.5
                  [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]
                  line-clamp-2
                ">
                  {reason}
                </p>
              )}
              <p className="
                text-white/60 text-[11px] mt-1
                [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]
              ">
                Tap to reveal
              </p>
            </div>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Hide button — shown in corner when image is revealed */}
      <AnimatePresence>
        {needsReveal && revealed && (
          <motion.button
            key="hide"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.18 }}
            className="
              absolute top-2 right-2
              w-8 h-8 rounded-full
              bg-black/50 backdrop-blur-sm
              flex items-center justify-center
              cursor-pointer select-none
            "
            onClick={toggleReveal}
            aria-label="Hide image"
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="white" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
