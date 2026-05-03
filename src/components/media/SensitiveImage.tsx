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

import { PanoramaImage } from './PanoramaImage'
import { MediaRevealGate, getMediaRevealReason, type MediaRevealReason } from './MediaRevealGate'
import { openImageLightbox } from '@/lib/ui/imageLightbox'

interface SensitiveImageProps {
  src:           string
  className?:    string
  alt?:          string
  disableTilt?:  boolean
  isSensitive:   boolean    // NIP-36 content-warning present
  reason?:       string | null | undefined
  isUnfollowed:  boolean    // Author not in follow list
  moderationState?: 'pending' | 'blocked' | null
}

export function SensitiveImage({
  src,
  className = '',
  alt = '',
  disableTilt = false,
  isSensitive,
  reason,
  isUnfollowed,
  moderationState = null,
}: SensitiveImageProps) {
  const revealReason: MediaRevealReason | null = getMediaRevealReason({
    blocked: moderationState === 'blocked',
    loading: moderationState === 'pending',
    isSensitive,
    isUnfollowed,
  })

  return (
    <MediaRevealGate
      reason={revealReason}
      resetKey={`${src}:${revealReason ?? 'none'}:${reason ?? ''}`}
      details={reason}
      className={`relative ${className}`}
    >
      <button
        type="button"
        className="block h-full w-full cursor-zoom-in p-0 text-left"
        onClick={(event) => {
          event.stopPropagation()
          if (revealReason === null) openImageLightbox(src, alt)
        }}
        aria-label={alt ? `Open image: ${alt}` : 'Open image'}
      >
        <PanoramaImage
          src={src}
          className="w-full h-full"
          alt={alt}
          disableTilt={disableTilt || revealReason !== null}
        />
      </button>
    </MediaRevealGate>
  )
}
