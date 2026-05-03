import { useMemo, useState } from 'react'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { MediaRevealGate, getMediaRevealReason } from '@/components/media/MediaRevealGate'
import { useFollowStatus } from '@/hooks/useFollowStatus'
import { useMediaModerationDocument } from '@/hooks/useMediaModeration'
import { recordMediaUrlFailure, recordMediaUrlSuccess, shouldAttemptMediaUrl } from '@/lib/media/failureBackoff'
import { buildAttachmentPlaybackPlan } from '@/lib/media/playback'
import { buildMediaModerationDocument } from '@/lib/moderation/mediaContent'
import { parseContentWarning } from '@/lib/nostr/contentWarning'
import type { Nip94FileMetadata, NostrEvent, Profile } from '@/types'

interface FileMetadataViewProps {
  event: NostrEvent
  metadata: Nip94FileMetadata
  profile: Profile | null
}

function formatByteSize(bytes?: number): string | null {
  if (bytes === undefined || !Number.isFinite(bytes)) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function previewKind(mimeType: string): 'image' | 'video' | 'audio' | 'other' {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'other'
}

export function FileMetadataView({ event, metadata, profile }: FileMetadataViewProps) {
  const followStatus = useFollowStatus(event.pubkey)
  const contentWarning = parseContentWarning(event)
  const kind = previewKind(metadata.metadata.mimeType)
  const previewUrlCandidate = metadata.metadata.image ?? metadata.metadata.thumb ?? metadata.metadata.url
  const previewUrl = previewUrlCandidate && shouldAttemptMediaUrl(previewUrlCandidate)
    ? previewUrlCandidate
    : null
  const moderationDocument = buildMediaModerationDocument({
    id: `${event.id}:file`,
    kind: kind === 'video' ? 'video_preview' : 'image',
    url: kind === 'video'
      ? (metadata.metadata.image ?? metadata.metadata.thumb ?? null)
      : (kind === 'image' ? previewUrl : null),
    updatedAt: event.created_at,
  })
  const { blocked: mediaBlocked, loading: mediaModerationLoading } = useMediaModerationDocument(moderationDocument)
  const revealReason = getMediaRevealReason({
    blocked: moderationDocument !== null && mediaBlocked,
    loading: moderationDocument !== null && mediaModerationLoading,
    isSensitive: contentWarning !== null,
    isUnfollowed: followStatus === false,
  })
  const playbackPlan = kind === 'video' || kind === 'audio'
    ? buildAttachmentPlaybackPlan(
        {
          url: metadata.metadata.url,
          mimeType: metadata.metadata.mimeType,
          ...(metadata.metadata.fallbacks ? { fallbacks: metadata.metadata.fallbacks } : {}),
        },
        kind,
      )
    : null
  const playbackSources = useMemo(
    () => (playbackPlan?.sources ?? []).filter((source) => shouldAttemptMediaUrl(source.url)),
    [playbackPlan],
  )
  const canRenderInlinePlayback = playbackPlan?.playability !== 'unsupported' && playbackSources.length > 0
  const sizeLabel = formatByteSize(metadata.metadata.size)
  const [previewFailed, setPreviewFailed] = useState(false)

  return (
    <article className="space-y-5">
      <AuthorRow
        pubkey={event.pubkey}
        profile={profile}
        timestamp={event.created_at}
        large
      />

      <div className="overflow-hidden rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] card-elevated">
        {kind === 'image' && previewUrl && !previewFailed ? (
          <MediaRevealGate
            reason={revealReason}
            resetKey={`${event.id}:${previewUrl}:${revealReason ?? 'none'}:${contentWarning?.reason ?? ''}`}
            details={contentWarning?.reason}
            className="min-h-[12rem] w-full"
          >
            <img
              src={previewUrl}
              alt={metadata.metadata.alt ?? ''}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => {
                recordMediaUrlSuccess(previewUrl)
              }}
              onError={() => {
                recordMediaUrlFailure(previewUrl)
                setPreviewFailed(true)
              }}
              className="h-full w-full object-cover"
            />
          </MediaRevealGate>
        ) : kind === 'image' ? (
          <div className="p-6">
            <p className="text-[16px] font-medium text-[rgb(var(--color-label))]">
              Image unavailable
            </p>
          </div>
        ) : kind === 'video' ? (
          canRenderInlinePlayback ? (
            <MediaRevealGate
              reason={revealReason}
              resetKey={`${event.id}:${metadata.metadata.url}:${revealReason ?? 'none'}:${contentWarning?.reason ?? ''}`}
              details={contentWarning?.reason}
              className="aspect-video w-full"
            >
              <video
                controls
                preload="metadata"
                poster={previewUrl ?? undefined}
                onLoadedData={() => {
                  playbackSources.forEach((source) => recordMediaUrlSuccess(source.url))
                }}
                onError={() => {
                  playbackSources.forEach((source) => recordMediaUrlFailure(source.url))
                }}
                className="h-full w-full"
              >
                {playbackSources.map((source) => (
                  <source key={source.url} src={source.url} {...(source.type ? { type: source.type } : {})} />
                ))}
              </video>
            </MediaRevealGate>
          ) : (
            <div className="p-6">
              <p className="text-[16px] font-medium text-[rgb(var(--color-label))]">
                This browser cannot play this video inline.
              </p>
            </div>
          )
        ) : kind === 'audio' ? (
          <div className="p-5">
            {canRenderInlinePlayback ? (
              <audio
                controls
                preload="metadata"
                onLoadedData={() => {
                  playbackSources.forEach((source) => recordMediaUrlSuccess(source.url))
                }}
                onError={() => {
                  playbackSources.forEach((source) => recordMediaUrlFailure(source.url))
                }}
                className="w-full"
              >
                {playbackSources.map((source) => (
                  <source key={source.url} src={source.url} {...(source.type ? { type: source.type } : {})} />
                ))}
              </audio>
            ) : (
              <p className="text-[16px] font-medium text-[rgb(var(--color-label))]">
                This browser cannot play this audio inline.
              </p>
            )}
          </div>
        ) : (
          <div className="p-6">
            <p className="text-[16px] font-medium text-[rgb(var(--color-label))]">
              {metadata.metadata.mimeType}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {metadata.description && (
          <p className="text-[17px] leading-8 text-[rgb(var(--color-label))]">
            {metadata.description}
          </p>
        )}

        {metadata.metadata.summary && (
          <p className="text-[15px] leading-7 text-[rgb(var(--color-label-secondary))]">
            {metadata.metadata.summary}
          </p>
        )}

        <div className="flex flex-wrap gap-2 text-[12px] text-[rgb(var(--color-label-secondary))]">
          <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
            {metadata.metadata.mimeType}
          </span>
          {sizeLabel && (
            <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
              {sizeLabel}
            </span>
          )}
          {metadata.metadata.dim && (
            <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
              {metadata.metadata.dim}
            </span>
          )}
          <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 font-mono">
            {metadata.metadata.fileHash.slice(0, 12)}…
          </span>
          {metadata.metadata.fallbacks && metadata.metadata.fallbacks.length > 0 && (
            <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
              {metadata.metadata.fallbacks.length} fallback{metadata.metadata.fallbacks.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {metadata.metadata.alt && (
          <p className="text-[14px] leading-6 text-[rgb(var(--color-label-tertiary))]">
            Alt: {metadata.metadata.alt}
          </p>
        )}

        <a
          href={metadata.metadata.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-block text-[14px] text-[#007AFF]"
        >
          Open file
        </a>
      </div>
    </article>
  )
}
