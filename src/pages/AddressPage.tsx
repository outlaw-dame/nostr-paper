import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getLatestAddressableEvent } from '@/lib/db/nostr'
import { decodeAddressReference } from '@/lib/nostr/nip21'
import { parseLongFormEvent } from '@/lib/nostr/longForm'
import { getNDK } from '@/lib/nostr/ndk'
import { parseVideoEvent } from '@/lib/nostr/video'
import { withRetry } from '@/lib/retry'
import type { NostrEvent } from '@/types'

export default function AddressPage() {
  const navigate = useNavigate()
  const { naddr } = useParams<{ naddr?: string }>()
  const address = useMemo(() => decodeAddressReference(naddr), [naddr])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!address) {
      setLoading(false)
      setError('Invalid NIP-21 address.')
      return
    }

    const resolvedAddress = address

    const controller = new AbortController()
    const { signal } = controller

    async function loadLocal(): Promise<NostrEvent | null> {
      return getLatestAddressableEvent(
        resolvedAddress.pubkey,
        resolvedAddress.kind,
        resolvedAddress.identifier,
      )
    }

    async function fetchFromRelays(): Promise<void> {
      let ndk
      try {
        ndk = getNDK()
      } catch {
        return
      }

      await withRetry(
        async () => {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          await ndk.fetchEvents({
            authors: [resolvedAddress.pubkey],
            kinds: [resolvedAddress.kind],
            '#d': [resolvedAddress.identifier],
            limit: 10,
          })
        },
        {
          maxAttempts: 2,
          baseDelayMs: 1_000,
          maxDelayMs: 3_000,
          signal,
        },
      )
    }

    async function resolveNavigation(): Promise<void> {
      setLoading(true)
      setError(null)

      const cached = await loadLocal()
      if (!signal.aborted && cached) {
        const article = parseLongFormEvent(cached)
        const video = parseVideoEvent(cached)
        navigate(article ? article.route : video?.route ?? `/note/${cached.id}`, { replace: true })
        return
      }

      await fetchFromRelays()
      if (signal.aborted) return

      const refreshed = await loadLocal()
      if (signal.aborted) return

      if (!refreshed) {
        setLoading(false)
        setError('Addressable event not found.')
        return
      }

      const article = parseLongFormEvent(refreshed)
      const video = parseVideoEvent(refreshed)
      navigate(article ? article.route : video?.route ?? `/note/${refreshed.id}`, { replace: true })
    }

    resolveNavigation().catch((loadError: unknown) => {
      if (signal.aborted) return
      setLoading(false)
      setError(loadError instanceof Error ? loadError.message : 'Address resolution failed.')
    })

    return () => controller.abort()
  }, [address, navigate])

  if (loading) {
    return (
      <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pt-safe pb-safe">
        <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-4 py-2 text-[15px] text-[rgb(var(--color-label))]"
          >
            Back
          </button>
        </div>
        <div className="pt-6 text-[rgb(var(--color-label-secondary))]">
          Resolving NIP-21 address…
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pt-safe pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-4 py-2 text-[15px] text-[rgb(var(--color-label))]"
        >
          Back
        </button>
      </div>
      <div className="pt-6">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-[rgb(var(--color-label))]">
          Address unavailable
        </h1>
        {error && (
          <p className="mt-3 text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
