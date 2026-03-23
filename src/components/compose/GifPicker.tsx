/**
 * GifPicker
 *
 * Tenor-backed GIF search + trending grid for the compose sheet.
 *
 * - No query → shows Tenor "featured" (trending) GIFs
 * - Typing debounces 350 ms then fires a search
 * - Click a GIF → calls onSelect(gif) and the parent closes the picker
 * - "Powered by Tenor" attribution is required by Tenor's developer ToS
 */

import { useEffect, useRef, useState } from 'react'
import { fetchFeaturedGifs, searchGifs, type TenorGif } from '@/lib/tenor/client'

interface GifPickerProps {
  onSelect: (gif: TenorGif) => void
}

const DEBOUNCE_MS = 350

export function GifPicker({ onSelect }: GifPickerProps) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<TenorGif[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abort         = useRef<AbortController | null>(null)

  function load(q: string) {
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl

    setLoading(true)
    setError(null)

    const promise = q.trim().length > 0
      ? searchGifs(q.trim(), 24)
      : fetchFeaturedGifs(24)

    promise
      .then(({ results: gifs }) => {
        if (ctrl.signal.aborted) return
        setResults(gifs)
        setLoading(false)
      })
      .catch(() => {
        if (ctrl.signal.aborted) return
        setError('Could not load GIFs.')
        setLoading(false)
      })
  }

  // Load featured/trending on mount
  useEffect(() => {
    load('')
    return () => {
      abort.current?.abort()
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => load(value), DEBOUNCE_MS)
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Search input */}
      <input
        type="search"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Search GIFs…"
        autoFocus
        className="
          w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
          bg-[rgb(var(--color-bg-secondary))] px-3 py-2
          text-[14px] text-[rgb(var(--color-label))]
          outline-none transition-colors focus:border-[#007AFF]
          placeholder:text-[rgb(var(--color-label-tertiary))]
        "
      />

      {/* Result grid — fixed height so sheet doesn't jump */}
      <div className="h-52 overflow-y-auto overscroll-contain rounded-[14px]">
        {loading && results.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[rgb(var(--color-label-tertiary))]">
            Loading…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[rgb(var(--color-system-red))]">
            {error}
          </div>
        ) : results.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[rgb(var(--color-label-tertiary))]">
            {query.trim().length > 0 ? 'No GIFs found.' : 'No trending GIFs available.'}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {results.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => onSelect(gif)}
                className="
                  aspect-square overflow-hidden rounded-[10px]
                  bg-[rgb(var(--color-fill)/0.08)]
                  transition-opacity active:opacity-70
                "
                title={gif.title || undefined}
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.title}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Required Tenor attribution */}
      <p className="text-center text-[10px] text-[rgb(var(--color-label-tertiary))]">
        Powered by Tenor
      </p>
    </div>
  )
}
