import { useEffect } from 'react'

interface ImageLightboxProps {
  open: boolean
  imageUrl?: string | null
  alt?: string
  title?: string
  onClose: () => void
}

export function ImageLightbox({
  open,
  imageUrl,
  alt = '',
  title,
  onClose,
}: ImageLightboxProps) {
  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (!open || !imageUrl) return null

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/88 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Expanded image'}
      onClick={onClose}
    >
      <div className="flex h-full w-full flex-col">
        <div className="flex items-center justify-between px-4 pb-3 pt-safe">
          <div className="min-w-0 pr-3">
            {title && (
              <p className="truncate text-[15px] font-medium text-white/90">
                {title}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="
              shrink-0 rounded-full border border-white/14 bg-white/10
              px-3 py-2 text-[13px] font-medium text-white
            "
            aria-label="Close image viewer"
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-safe">
          <div
            className="flex max-h-full max-w-full items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={imageUrl}
              alt={alt}
              loading="eager"
              decoding="async"
              referrerPolicy="no-referrer"
              className="max-h-[calc(100dvh-6rem)] max-w-full rounded-[22px] object-contain shadow-[0_30px_120px_rgba(0,0,0,0.45)]"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
