import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { VideoBody } from '@/components/video/VideoBody'
import { useFilterOverride } from '@/hooks/useFilterOverride'
import { mergeResults, useEventFilterCheck, useSemanticFiltering } from '@/hooks/useKeywordFilters'
import { useEventModeration, useModerationDocuments } from '@/hooks/useModeration'
import { useMuteList } from '@/hooks/useMuteList'
import { usePageHead } from '@/hooks/usePageHead'
import { useProfile } from '@/hooks/useProfile'
import { getEvent, getLatestAddressableEvent } from '@/lib/db/nostr'
import { buildVideoMetaTags, buildVideoTitle } from '@/lib/nostr/meta'
import { decodeEventReference } from '@/lib/nostr/nip21'
import { getEventMediaAttachments, getPeerTubeEmbedUrl, getVimeoVideoId, getYouTubeVideoId } from '@/lib/nostr/imeta'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import { isValidHex32 } from '@/lib/security/sanitize'
import { decodeVideoAddress, parseVideoEvent } from '@/lib/nostr/video'
import type { ModerationDocument, NostrEvent } from '@/types'
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
  const [override, setOverride] = useState(false)
  const { profile } = useProfile(event?.pubkey)
  const checkEvent = useEventFilterCheck()
  const semanticFilterResults = useSemanticFiltering(event ? [event] : [])
  const { overridden: filterOverride, setOverridden: setFilterOverride } = useFilterOverride(event?.id)
  const video = useMemo(() => (event ? parseVideoEvent(event) : null), [event])
  const {
    blocked: eventBlocked,
    loading: moderationLoading,
    decision: moderationDecision,
  } = useEventModeration(event)

  const videoMetaDocuments = useMemo(() => {
    if (!video) return []
    const text = [video.title, video.summary].filter(Boolean).join('\n\n')
    if (!text.trim()) return []
    return [{
      id: `video-meta:${video.id}`,
      kind: 'event',
      text,
      updatedAt: event?.created_at ?? Date.now(),
    }] satisfies ModerationDocument[]
  }, [video, event])
  const { allowedIds: allowedMetaIds, loading: metaModerationLoading } = useModerationDocuments(videoMetaDocuments)
  const metaBlocked = videoMetaDocuments.length > 0 && !allowedMetaIds.has(videoMetaDocuments[0]?.id ?? '')
  const keywordFilterResult = useMemo(
    () => event
      ? mergeResults(
          checkEvent(event, profile ?? undefined),
          semanticFilterResults.get(event.id) ?? { action: null, matches: [] },
        )
      : { action: null, matches: [] },
    [checkEvent, event, profile, semanticFilterResults],
  )

  const { isMuted, loading: muteListLoading } = useMuteList()
  const isMutedAuthor = event ? isMuted(event.pubkey) : false
  const isBlocked = eventBlocked || metaBlocked || isMutedAuthor
  const keywordGated = keywordFilterResult.action !== null && !filterOverride
  const keywordHidden = keywordFilterResult.action === 'hide'
  const blockedByTagr = eventBlocked && (moderationDecision?.reason?.startsWith('tagr:') ?? false)

  usePageHead(
    video && !moderationLoading && !metaModerationLoading && (!isBlocked || override) && !keywordGated
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

  const youTubeId = useMemo(() => {
    if (!event) return null
    // Check referenced source URLs first
    for (const reference of video?.references ?? []) {
      const id = getYouTubeVideoId(reference)
      if (id) return id
    }
    // Check all attachments
    const attachments = getEventMediaAttachments(event)
    return attachments.map(a => getYouTubeVideoId(a.url)).find(id => id !== null) ?? null
  }, [event, video])

  const vimeoId = useMemo(() => {
    if (!event) return null
    // Check referenced source URLs first
    for (const reference of video?.references ?? []) {
      const id = getVimeoVideoId(reference)
      if (id) return id
    }
    // Check all attachments
    const attachments = getEventMediaAttachments(event)
    return attachments.map(a => getVimeoVideoId(a.url)).find(id => id !== null) ?? null
  }, [event, video])

  const peertubeEmbed = useMemo(() => {
    if (!event) return null
    // Check referenced source URLs first
    for (const reference of video?.references ?? []) {
      const embed = getPeerTubeEmbedUrl(reference)
      if (embed) return embed
    }
    // Check all attachments
    const attachments = getEventMediaAttachments(event)
    for (const a of attachments) {
      const embed = getPeerTubeEmbedUrl(a.url)
      if (embed) return embed
    }
    return null
  }, [event, video])

  if (loading || (event !== null && (moderationLoading || metaModerationLoading)) || muteListLoading) {
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

  if (!event || !video || ((isBlocked && !override) || keywordGated)) {
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
            {isBlocked || keywordHidden ? 'Content hidden' : keywordGated ? 'Content warning' : 'Video unavailable'}
          </h1>
          {isBlocked || keywordGated ? (
            <>
              <p className="mt-3 text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
                {isBlocked
                  ? 'This video was hidden by your content filters or mute list.'
                  : 'This video matched your keyword filters.'}
              </p>
              {!isBlocked && keywordFilterResult.matches[0]?.term ? (
                <p className="mt-2 text-[14px] text-[rgb(var(--color-label-secondary))]">
                  Matched filter: &ldquo;{keywordFilterResult.matches[0].term}&rdquo;.
                </p>
              ) : null}
              {blockedByTagr ? (
                <p className="mt-2 text-[14px] font-medium text-[rgb(var(--color-system-red))]">
                  Blocked by Tagr.
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (isBlocked) setOverride(true)
                  if (keywordGated) setFilterOverride(true)
                }}
                className="mt-4 rounded-full bg-[rgb(var(--color-fill)/0.12)] px-4 py-2 text-[15px] font-medium text-[rgb(var(--color-label))]"
              >
                Show Anyway
              </button>
            </>
          ) : error ? (
            <p className="mt-3 text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
              {error}
            </p>
          ) : null}
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
        {youTubeId ? (
          <div className="overflow-hidden rounded-xl bg-black aspect-video">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${youTubeId}?modestbranding=1&playsinline=1&rel=0`}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title="YouTube video"
            />
          </div>
        ) : vimeoId ? (
          <div className="overflow-hidden rounded-xl bg-black aspect-video">
            <iframe
              src={`https://player.vimeo.com/video/${vimeoId}?title=0&byline=0&portrait=0`}
              className="h-full w-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              title="Vimeo video"
            />
          </div>
        ) : peertubeEmbed ? (
          <div className="overflow-hidden rounded-xl bg-black aspect-video">
            <iframe
              src={peertubeEmbed}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title="PeerTube video"
            />
          </div>
        ) : (
          <VideoBody event={event} profile={profile} />
        )}
      </div>
    </div>
  )
}
