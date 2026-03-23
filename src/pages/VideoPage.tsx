import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { VideoBody } from '@/components/video/VideoBody'
import { useEventModeration } from '@/hooks/useModeration'
import { usePageHead } from '@/hooks/usePageHead'
import { useProfile } from '@/hooks/useProfile'
import { getEvent, getLatestAddressableEvent } from '@/lib/db/nostr'
import { buildVideoMetaTags, buildVideoTitle } from '@/lib/nostr/meta'
import { decodeEventReference } from '@/lib/nostr/nip21'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import { isValidHex32 } from '@/lib/security/sanitize'
import { decodeVideoAddress, parseVideoEvent } from '@/lib/nostr/video'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

type VideoRouteAddress =
  | { mode: 'event'; eventId: string }
  | { mode: 'address'; pubkey: string; identifier: string; kind: number }

function resolveRouteAddress(
  params: {
    id?: string
    variant?: string
    pubkey?: string
    identifier?: string
    naddr?: string
  },
): VideoRouteAddress | null {
  if (params.naddr) {
    const decoded = decodeVideoAddress(params.naddr)
    if (!decoded) return null
    return {
      mode: 'address',
      pubkey: decoded.pubkey,
      identifier: decoded.identifier,
      kind: decoded.isShort ? Kind.AddressableShortVideo : Kind.AddressableVideo,
    }
  }

  if (params.id) {
    const decoded = decodeEventReference(params.id)
    if (!decoded) return null
    return {
      mode: 'event',
      eventId: decoded.eventId,
    }
  }

  if (!params.pubkey || !params.identifier || !isValidHex32(params.pubkey)) return null
  const isShort = params.variant === 'short'
  const isNormal = params.variant === 'normal'
  if (!isShort && !isNormal) return null

  return {
    mode: 'address',
    pubkey: params.pubkey,
    identifier: params.identifier,
    kind: isShort ? Kind.AddressableShortVideo : Kind.AddressableVideo,
  }
}

export default function VideoPage() {
  const navigate = useNavigate()
  const params = useParams<{
    id?: string
    variant?: string
    pubkey?: string
    identifier?: string
    naddr?: string
  }>()
  const address = useMemo(() => resolveRouteAddress(params), [params])

  const [event, setEvent] = useState<NostrEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { profile } = useProfile(event?.pubkey)
  const video = useMemo(() => (event ? parseVideoEvent(event) : null), [event])
  const { blocked: eventBlocked, loading: moderationLoading } = useEventModeration(event)

  usePageHead(
    video && !moderationLoading && !eventBlocked
      ? {
          title: buildVideoTitle(video),
          tags: buildVideoMetaTags({ video, profile }),
        }
      : {},
  )

  useEffect(() => {
    if (!address) {
      setEvent(null)
      setLoading(false)
      setError('Invalid video reference.')
      return
    }

    const resolvedAddress = address
    const controller = new AbortController()
    const { signal } = controller

    async function loadLocal(): Promise<NostrEvent | null> {
      if (resolvedAddress.mode === 'event') {
        return getEvent(resolvedAddress.eventId)
      }

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

          await (resolvedAddress.mode === 'event'
            ? ndk.fetchEvents({ ids: [resolvedAddress.eventId], limit: 1 })
            : await ndk.fetchEvents({
                authors: [resolvedAddress.pubkey],
                kinds: [resolvedAddress.kind],
                '#d': [resolvedAddress.identifier],
                limit: 10,
              }))
        },
        {
          maxAttempts: 2,
          baseDelayMs: 1_250,
          maxDelayMs: 4_000,
          signal,
        },
      )
    }

    setLoading(true)
    setError(null)
    setEvent(null)

    loadLocal()
      .then(async (cached) => {
        if (signal.aborted) return
        if (cached && parseVideoEvent(cached)) {
          setEvent(cached)
          setLoading(false)
        }

        await fetchFromRelays()
        if (signal.aborted) return

        const refreshed = await loadLocal()
        if (signal.aborted) return

        if (refreshed && parseVideoEvent(refreshed)) {
          setEvent(refreshed)
          setLoading(false)
          return
        }

        setEvent(null)
        setLoading(false)
        setError('Video not found.')
      })
      .catch((loadError: unknown) => {
        if (signal.aborted) return
        setLoading(false)
        setError(loadError instanceof Error ? loadError.message : 'Video load failed.')
      })

    return () => controller.abort()
  }, [address])

  if (loading || (event !== null && moderationLoading)) {
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
          Loading video…
        </div>
      </div>
    )
  }

  if (!event || !video || eventBlocked) {
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
            Video unavailable
          </h1>
          {error && !eventBlocked && (
            <p className="mt-3 text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
              {error}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-4 py-2 text-[15px] text-[rgb(var(--color-label))]"
        >
          Back
        </button>
      </div>

      <div className="pb-10 pt-4">
        <VideoBody event={event} profile={profile} />
      </div>
    </div>
  )
}
