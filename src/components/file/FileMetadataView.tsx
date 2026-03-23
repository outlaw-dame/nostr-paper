import { AuthorRow } from '@/components/profile/AuthorRow'
import { useMediaModerationDocument } from '@/hooks/useMediaModeration'
import { buildAttachmentPlaybackPlan } from '@/lib/media/playback'
import { buildMediaModerationDocument } from '@/lib/moderation/mediaContent'
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
  const kind = previewKind(metadata.metadata.mimeType)
  const previewUrl = metadata.metadata.image ?? metadata.metadata.thumb ?? metadata.metadata.url
  const moderationDocument = buildMediaModerationDocument({
    id: `${event.id}:file`,
    kind: kind === 'video' ? 'video_preview' : 'image',
    url: kind === 'video'
      ? (metadata.metadata.image ?? metadata.metadata.thumb ?? null)
      : (kind === 'image' ? previewUrl : null),
    updatedAt: event.created_at,
  })
  const { blocked: mediaBlocked, loading: mediaModerationLoading } = useMediaModerationDocument(moderationDocument)
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
  const playbackSources = playbackPlan?.sources ?? []
  const canRenderInlinePlayback = playbackPlan?.playability !== 'unsupported' && playbackSources.length > 0
  const sizeLabel = formatByteSize(metadata.metadata.size)

  return (
    <article className="space-y-5">
      <AuthorRow
        pubkey={event.pubkey}
        profile={profile}
        timestamp={event.created_at}
        large
      />

      <div className="overflow-hidden rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] card-elevated">
        {moderationDocument && (mediaModerationLoading || mediaBlocked) ? (
          <div className="p-6">
            <p className="text-[16px] font-medium text-[rgb(var(--color-label))]">
              {mediaModerationLoading ? 'Loading media…' : 'Media unavailable'}
            </p>
          </div>
        ) : kind === 'image' ? (
          <img
            src={previewUrl}
            alt={metadata.metadata.alt ?? ''}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="w-full h-auto object-cover"
          />
        ) : kind === 'video' ? (
          canRenderInlinePlayback ? (
            <video
              controls
              preload="metadata"
              poster={previewUrl}
              className="w-full h-auto"
            >
              {playbackSources.map((source) => (
                <source key={source.url} src={source.url} {...(source.type ? { type: source.type } : {})} />
              ))}
            </video>
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
