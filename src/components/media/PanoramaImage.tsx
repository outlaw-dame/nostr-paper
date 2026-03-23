/**
 * PanoramaImage
 *
 * Paper's signature tilt-to-pan gesture for wide images.
 *
 * On mobile: DeviceOrientationEvent (gamma = left/right tilt)
 * On desktop: Mouse parallax on mousemove
 *
 * Falls back gracefully if DeviceOrientation is unavailable.
 * Respects prefers-reduced-motion.
 */

import { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import { isSafeMediaURL } from '@/lib/security/sanitize'

interface PanoramaImageProps {
  src:          string
  className?:   string
  alt?:         string
  disableTilt?: boolean  // Force static (e.g. already in full-screen expanded view)
}

// Spring config — slightly laggy for a "heavy" feel like Paper
const SPRING_CONFIG = { stiffness: 55, damping: 18, mass: 1.2 }

// Image is rendered at 156% width — 28% overflow each side for parallax travel
const OVERFLOW_PERCENT = 28

export function PanoramaImage({
  src,
  className = '',
  alt = '',
  disableTilt = false,
}: PanoramaImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [isWide, setIsWide] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // -1 to +1 normalized tilt value
  const tiltRaw    = useMotionValue(0)
  // Smoothed with spring physics for the "heavy paper" feel
  const tiltSmooth = useSpring(tiltRaw, SPRING_CONFIG)
  // Map tilt to x offset: left-tilt → image shifts right (revealing right edge)
  const imageX = useTransform(
    tiltSmooth,
    [-1, 1],
    [`${OVERFLOW_PERCENT}%`, `-${OVERFLOW_PERCENT}%`],
  )

  // Validate URL before rendering
  const safeSrc = isSafeMediaURL(src) ? src : null

  const handleLoad = () => {
    setLoaded(true)
    const img = imgRef.current
    if (img) {
      const aspectRatio = img.naturalWidth / img.naturalHeight
      setIsWide(aspectRatio > 1.5)
    }
  }

  useEffect(() => {
    if (disableTilt || !isWide) return

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    let hasOrientation = false

    const orientationHandler = (e: DeviceOrientationEvent) => {
      if (e.gamma === null) return
      hasOrientation = true
      // gamma: -90 to +90 degrees. Clamp to ±45° then normalize to -1…+1
      const normalized = Math.max(-45, Math.min(45, e.gamma)) / 45
      tiltRaw.set(normalized)
    }

    const mouseHandler = (e: MouseEvent) => {
      if (hasOrientation) return
      const normalized = (e.clientX / window.innerWidth - 0.5) * 2
      tiltRaw.set(normalized)
    }

    window.addEventListener('deviceorientation', orientationHandler, { passive: true })
    window.addEventListener('mousemove', mouseHandler, { passive: true })

    return () => {
      window.removeEventListener('deviceorientation', orientationHandler)
      window.removeEventListener('mousemove', mouseHandler)
    }
  }, [disableTilt, isWide, tiltRaw])

  if (!safeSrc) {
    return (
      <div
        className={`${className} bg-[rgb(var(--color-bg-secondary))]`}
        role="img"
        aria-label="Image unavailable"
      />
    )
  }

  const canPan = isWide && !disableTilt

  return (
    <div className={`${className} overflow-hidden relative`}>
      {!loaded && (
        <div className="absolute inset-0 skeleton" aria-hidden="true" />
      )}

      {canPan ? (
        <motion.img
          ref={imgRef}
          src={safeSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
          draggable={false}
          className={`
            h-full object-cover select-none
            transition-opacity duration-300
            ${loaded ? 'opacity-100' : 'opacity-0'}
          `}
          style={{
            width:      `${100 + OVERFLOW_PERCENT * 2}%`,
            marginLeft: `-${OVERFLOW_PERCENT}%`,
            x:          imageX,
          }}
        />
      ) : (
        <img
          ref={imgRef}
          src={safeSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
          draggable={false}
          className={`
            w-full h-full object-cover select-none
            transition-opacity duration-300
            ${loaded ? 'opacity-100' : 'opacity-0'}
          `}
        />
      )}
    </div>
  )
}
