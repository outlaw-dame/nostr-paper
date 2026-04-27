import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Link } from 'react-router-dom'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { ConversationSection } from '@/components/nostr/ConversationSection'
import { EventActionBar } from '@/components/nostr/EventActionBar'
import { QuotePreviewList } from '@/components/nostr/QuotePreviewList'
import { NoteContent } from '@/components/cards/NoteContent'
import { SyndicationExportBar } from '@/components/syndication/SyndicationExportBar'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { useFollowStatus } from '@/hooks/useFollowStatus'
import { useMediaModerationDocument } from '@/hooks/useMediaModeration'
import { recordMediaUrlFailure, recordMediaUrlSuccess, shouldAttemptMediaUrl } from '@/lib/media/failureBackoff'
import { getMediaPlaybackProfileLabel, rankVideoPlaybackCandidates } from '@/lib/media/playback'
import { buildMediaModerationDocument } from '@/lib/moderation/mediaContent'
import { parseContentWarning } from '@/lib/nostr/contentWarning'
import {
  getVideoPreviewImage,
  getVideoVariantLabel,
  parseVideoEvent,
} from '@/lib/nostr/video'
import { isSafeURL } from '@/lib/security/sanitize'
import { generateVideoSyndicationDocuments } from '@/lib/syndication/export'
import type { NostrEvent, Profile } from '@/types'

interface VideoBodyProps {
  event: NostrEvent
  profile: Profile | null
  className?: string
}

function formatDate(timestamp: number): string {
  try {
    return new Date(timestamp * 1000).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return ''
  }
}

function formatDuration(durationSeconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationSeconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function mapTrackKind(trackType: string | undefined): 'captions' | 'subtitles' | 'chapters' | 'metadata' | 'descriptions' {
  switch ((trackType ?? '').toLowerCase()) {
    case 'captions':
      return 'captions'
    case 'chapters':
      return 'chapters'
    case 'metadata':
      return 'metadata'
    case 'descriptions':
      return 'descriptions'
    default:
      return 'subtitles'
  }
}

function getCompactPlaybackLabel(profileLabel: string, playability: 'probably' | 'maybe' | 'unknown' | 'unsupported'): string {
  const compactProfile = profileLabel
    .replace(' Profile', '')
    .replace('Compatibility', 'Compat')

  if (playability === 'unsupported') return `${compactProfile} · Unsupported`
  if (playability === 'maybe') return `${compactProfile} · Maybe`
  return compactProfile
}

export function VideoBody({ event, profile, className = '' }: VideoBodyProps) {
  const video = useMemo(() => parseVideoEvent(event), [event])
  const variantPlans = useMemo(
    () => (video ? rankVideoPlaybackCandidates(video.variants) : []),
    [video],
  )
  const previewImage = useMemo(() => {
    const url = video ? getVideoPreviewImage(video) : undefined
    return url && shouldAttemptMediaUrl(url) ? url : undefined
  }, [video])
  const mediaModerationDocument = useMemo(
    () => buildMediaModerationDocument({
      id: `${event.id}:video`,
      kind: 'video_preview',
      url: previewImage ?? null,
      updatedAt: event.created_at,
    }),
    [event.created_at, event.id, previewImage],
  )
  const { blocked: mediaBlocked, loading: mediaModerationLoading } = useMediaModerationDocument(mediaModerationDocument)
  const preferredVariant = variantPlans[0]?.candidate ?? null
  const [selectedUrl, setSelectedUrl] = useState<string | null>(preferredVariant?.url ?? null)
  const [revealed, setRevealed] = useState(false)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const followStatus = useFollowStatus(event.pubkey)
  const contentWarning = parseContentWarning(event)

  useEffect(() => {
    setSelectedUrl(preferredVariant?.url ?? null)
  }, [preferredVariant?.url, event.id])

  useEffect(() => {
    setRevealed(contentWarning === null && followStatus !== false)
  }, [contentWarning, followStatus, event.id])

  if (!video) return null
  if (mediaModerationDocument && (mediaModerationLoading || mediaBlocked)) {
    return (
      <article className={`space-y-6 ${className}`}>
        <header className="space-y-4">
          <AuthorRow
            pubkey={event.pubkey}
            profile={profile}
            timestamp={event.created_at}
            large
          />
        </header>
        <section className="overflow-hidden rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] card-elevated p-6">
          <p className="text-[16px] font-medium text-[rgb(var(--color-label))]">
            {mediaModerationLoading ? 'Loading video…' : 'Video unavailable'}
          </p>
        </section>
      </article>
    )
  }

  const selectedPlan = variantPlans.find((plan) => plan.candidate.url === selectedUrl) ?? variantPlans[0] ?? null
  const selectedVariant = selectedPlan?.candidate ?? null
  const selectedSources = useMemo(
    () => (selectedPlan?.sources ?? []).filter((source) => shouldAttemptMediaUrl(source.url)),
    [selectedPlan],
  )
  const requiresReveal = contentWarning !== null || followStatus === false
  const isAudioVariant = (selectedVariant?.mimeType ?? '').startsWith('audio/')
  const trackSources = video.textTracks.filter(track => isSafeURL(track.reference))
  const playbackBadge = selectedPlan
    ? getCompactPlaybackLabel(getMediaPlaybackProfileLabel(selectedPlan.profile), selectedPlan.playability)
    : null

  const seekToSegment = (seconds: number) => {
    const media = mediaRef.current
    if (!(media instanceof HTMLMediaElement)) return
    media.currentTime = seconds
    void media.play().catch(() => {})
  }

  return (
    <article className={`space-y-6 ${className}`}>
      <header className="space-y-4">
        <AuthorRow
          pubkey={event.pubkey}
          profile={profile}
          timestamp={event.created_at}
          large
        />

        <div className="space-y-3">
          <div className="flex flex-wrap items-start gap-2">
            <h1 className="text-[34px] leading-[1.05] tracking-[-0.04em] font-semibold text-[rgb(var(--color-label))]">
              <TwemojiText text={video.title} />
            </h1>
            <span className="
              rounded-full bg-[rgb(var(--color-fill)/0.12)]
              px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide
              text-[rgb(var(--color-label-secondary))]
            ">
              {video.isShort ? 'Short Video' : 'Video'}
            </span>
            {video.isAddressable && (
              <span className="
                rounded-full bg-[rgb(var(--color-fill)/0.08)]
                px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide
                text-[rgb(var(--color-label-secondary))]
              ">
                Addressable
              </span>
            )}
          </div>

          {video.summary && (
            <NoteContent content={video.summary} className="text-[17px] leading-8" allowTranslation />
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[rgb(var(--color-label-secondary))]">
            <span>
              Published {formatDate(video.publishedAt ?? event.created_at)}
            </span>
            {video.durationSeconds !== undefined && (
              <span>Duration {formatDuration(video.durationSeconds)}</span>
            )}
            {playbackBadge && (
              <span>{playbackBadge}</span>
            )}
            {video.naddr && (
              <Link
                to={`/a/${video.naddr}`}
                className="font-mono text-[rgb(var(--color-label-tertiary))]"
              >
                nostr:{video.naddr.slice(0, 24)}…
              </Link>
            )}
          </div>
        </div>
      </header>

      <SyndicationExportBar onGenerate={() => generateVideoSyndicationDocuments(event, profile)} />

      <section className="overflow-hidden rounded-ios-2xl bg-black card-elevated">
        {!selectedVariant || selectedPlan?.playability === 'unsupported' || selectedSources.length === 0 ? (
          <div className="flex aspect-video items-center justify-center px-6 text-center text-[15px] text-white/70">
            No compatible video source is available for this browser.
          </div>
        ) : requiresReveal && !revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="relative block w-full overflow-hidden text-left"
          >
            {previewImage ? (
              <img
                src={previewImage}
                alt={video.alt ?? ''}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={() => {
                  recordMediaUrlSuccess(previewImage)
                }}
                onError={() => {
                  recordMediaUrlFailure(previewImage)
                }}
                className="aspect-video h-full w-full object-cover blur-2xl brightness-[0.55]"
              />
            ) : (
              <div className="aspect-video bg-[linear-gradient(145deg,#172033,#0b1017)]" />
            )}

            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
              <div className="rounded-full bg-black/45 px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.08em]">
                {contentWarning ? 'Sensitive Video' : 'Unknown Author'}
              </div>
              <p className="max-w-[34rem] text-[15px] leading-7 text-white/86">
                {contentWarning?.reason
                  ? `Content warning: ${contentWarning.reason}`
                  : followStatus === false
                    ? 'This video is from an account you do not follow.'
                    : 'Reveal video'}
              </p>
              <span className="rounded-full border border-white/22 bg-white/12 px-4 py-2 text-[14px] font-medium">
                Tap to reveal
              </span>
            </div>
          </button>
        ) : isAudioVariant ? (
          <div className="space-y-4 p-4">
            {previewImage && (
              <img
                src={previewImage}
                alt={video.alt ?? ''}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={() => {
                  recordMediaUrlSuccess(previewImage)
                }}
                onError={() => {
                  recordMediaUrlFailure(previewImage)
                }}
                className="aspect-video w-full rounded-[18px] object-cover"
              />
            )}
            <audio
              key={selectedVariant.url}
              ref={mediaRef as MutableRefObject<HTMLAudioElement | null>}
              controls
              preload="metadata"
              onLoadedData={() => {
                selectedSources.forEach((source) => recordMediaUrlSuccess(source.url))
              }}
              onError={() => {
                selectedSources.forEach((source) => recordMediaUrlFailure(source.url))
              }}
              className="w-full"
            >
              {selectedSources.map((source) => (
                <source key={source.url} src={source.url} {...(source.type ? { type: source.type } : {})} />
              ))}
            </audio>
          </div>
        ) : (
          <video
            key={selectedVariant.url}
            ref={mediaRef as MutableRefObject<HTMLVideoElement | null>}
            controls
            playsInline
            preload="metadata"
            poster={previewImage}
            onLoadedData={() => {
              selectedSources.forEach((source) => recordMediaUrlSuccess(source.url))
            }}
            onError={() => {
              selectedSources.forEach((source) => recordMediaUrlFailure(source.url))
            }}
            className="aspect-video w-full bg-black object-contain"
          >
            {selectedSources.map((source) => (
              <source key={source.url} src={source.url} {...(source.type ? { type: source.type } : {})} />
            ))}
            {trackSources.map((track) => (
              <track
                key={`${track.reference}-${track.trackType ?? ''}-${track.language ?? ''}`}
                src={track.reference}
                kind={mapTrackKind(track.trackType)}
                {...(track.language ? { srcLang: track.language } : {})}
                label={track.trackType ?? track.language ?? 'Track'}
              />
            ))}
          </video>
        )}
      </section>

      {video.variants.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[rgb(var(--color-label-tertiary))]">
            Variants
          </h2>
          <div className="flex flex-wrap gap-2">
            {variantPlans.map((plan) => {
              const variant = plan.candidate
              const active = variant.url === selectedVariant?.url
              return (
                <button
                  key={variant.url}
                  type="button"
                  onClick={() => setSelectedUrl(variant.url)}
                  className={[
                    'rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
                    active
                      ? 'bg-[rgb(var(--color-label))] text-[rgb(var(--color-bg))]'
                      : 'bg-[rgb(var(--color-fill)/0.08)] text-[rgb(var(--color-label-secondary))]',
                  ].join(' ')}
                >
                  {`${getVideoVariantLabel(variant)} · ${getCompactPlaybackLabel(getMediaPlaybackProfileLabel(plan.profile), plan.playability)}`}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {video.segments.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[rgb(var(--color-label-tertiary))]">
            Segments
          </h2>
          <div className="space-y-2">
            {video.segments.map((segment) => (
              <button
                key={`${segment.start}-${segment.end}-${segment.title ?? ''}`}
                type="button"
                onClick={() => seekToSegment(segment.startSeconds)}
                className="
                  flex w-full items-center gap-3 rounded-[18px]
                  border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))]
                  p-3 text-left transition-opacity active:opacity-80
                "
              >
                {segment.thumbnail ? (
                  shouldAttemptMediaUrl(segment.thumbnail) ? (
                    <img
                      src={segment.thumbnail}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onLoad={() => {
                        recordMediaUrlSuccess(segment.thumbnail)
                      }}
                      onError={() => {
                        recordMediaUrlFailure(segment.thumbnail)
                      }}
                      className="h-14 w-24 shrink-0 rounded-[12px] object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-[12px] bg-[rgb(var(--color-fill)/0.08)] text-[12px] text-[rgb(var(--color-label-tertiary))]">
                      {segment.start}
                    </div>
                  )
                ) : (
                  <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded-[12px] bg-[rgb(var(--color-fill)/0.08)] text-[12px] text-[rgb(var(--color-label-tertiary))]">
                    {segment.start}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-[rgb(var(--color-label))]">
                    <TwemojiText text={segment.title ?? `Segment ${segment.start}`} />
                  </p>
                  <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                    {segment.start} - {segment.end}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {video.hashtags.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[rgb(var(--color-label-tertiary))]">
            Tags
          </h2>
          <div className="flex flex-wrap gap-2">
            {video.hashtags.map((tag) => (
              <Link
                key={tag}
                to={`/t/${encodeURIComponent(tag)}`}
                className="
                  rounded-full bg-[rgb(var(--color-fill)/0.08)]
                  px-2.5 py-1 text-[12px] font-medium
                  text-[rgb(var(--color-label-secondary))]
                "
              >
                #{tag}
              </Link>
            ))}
          </div>
        </section>
      )}

      {(video.participants.length > 0 || video.references.length > 0 || video.textTracks.length > 0 || video.origin) && (
        <section className="grid gap-4 md:grid-cols-2">
          {video.participants.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[rgb(var(--color-label-tertiary))]">
                Participants
              </h2>
              <div className="flex flex-wrap gap-2">
                {video.participants.map((participant) => (
                  <Link
                    key={participant.pubkey}
                    to={`/profile/${participant.pubkey}`}
                    className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]"
                  >
                    {participant.pubkey.slice(0, 12)}…
                  </Link>
                ))}
              </div>
            </div>
          )}

          {video.references.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[rgb(var(--color-label-tertiary))]">
                References
              </h2>
              <ul className="space-y-1.5">
                {video.references.map((reference) => (
                  <li key={reference}>
                    <a
                      href={reference}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="break-all text-[14px] text-[#007AFF] underline decoration-[#007AFF]/30 underline-offset-2"
                    >
                      {reference}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {video.textTracks.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[rgb(var(--color-label-tertiary))]">
                Text Tracks
              </h2>
              <ul className="space-y-1.5">
                {video.textTracks.map((track) => (
                  <li key={`${track.reference}-${track.trackType ?? ''}-${track.language ?? ''}`} className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                    <span className="font-medium text-[rgb(var(--color-label))]">
                      {track.trackType ?? 'track'}
                    </span>
                    {track.language && <span> · {track.language}</span>}
                    <div className="mt-0.5 break-all text-[13px] text-[rgb(var(--color-label-tertiary))]">
                      {track.reference}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {video.origin && (
            <div className="space-y-2">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[rgb(var(--color-label-tertiary))]">
                Origin
              </h2>
              <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3 text-[14px] text-[rgb(var(--color-label-secondary))]">
                <p>
                  <span className="font-medium text-[rgb(var(--color-label))]">{video.origin.platform}</span>
                  {' · '}
                  {video.origin.externalId}
                </p>
                {video.origin.originalUrl && (
                  <a
                    href={video.origin.originalUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="mt-2 block break-all text-[#007AFF] underline decoration-[#007AFF]/30 underline-offset-2"
                  >
                    {video.origin.originalUrl}
                  </a>
                )}
                {video.origin.metadata && (
                  <p className="mt-2 leading-6">{video.origin.metadata}</p>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      <QuotePreviewList event={event} compact />
      <EventActionBar event={event} />
      <ConversationSection event={event} />
    </article>
  )
}
