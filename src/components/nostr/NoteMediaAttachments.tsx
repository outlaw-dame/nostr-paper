import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import { useMediaModerationDocument } from '@/hooks/useMediaModeration'
import { recordMediaUrlFailure, recordMediaUrlSuccess, shouldAttemptMediaUrl } from '@/lib/media/failureBackoff'
import { buildAttachmentPlaybackPlan } from '@/lib/media/playback'
import { buildAttachmentMediaModerationDocument } from '@/lib/moderation/mediaContent'
import { canRenderMediaAttachmentInline, getMediaAttachmentKind, getMediaAttachmentPreviewUrl, getMediaAttachmentSourceUrl, getOrderedImageCandidates } from '@/lib/nostr/imeta'
import { MediaRevealGate, getMediaRevealReason, type MediaRevealReason } from '@/components/media/MediaRevealGate'
import { openImageLightbox } from '@/lib/ui/imageLightbox'
import type { Nip92MediaAttachment } from '@/types'

interface NoteMediaAttachmentsProps {
  attachments: Nip92MediaAttachment[]
  className?: string
  compact?: boolean
  interactive?: boolean
  isSensitive?: boolean
  sensitiveReason?: string | null
  isUnfollowed?: boolean
}

function formatByteSize(bytes?: number): string | null {
  if (bytes === undefined || !Number.isFinite(bytes)) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function stopPropagation(event: MouseEvent<HTMLElement>) {
  event.stopPropagation()
}

function buildPreviewCandidates(attachment: Nip92MediaAttachment): string[] {
  const kind = getMediaAttachmentKind(attachment)

  if (kind === 'image') {
    // Include all ranked image candidates (AVIF > WebP > PNG > JPEG > GIF) so the
    // error-retry loop walks from the best available format down to the baseline.
    const ranked = getOrderedImageCandidates(attachment).map((c) => c.url)
    const extras = [
      getMediaAttachmentPreviewUrl(attachment),
      getMediaAttachmentSourceUrl(attachment),
    ]
    const all = [...ranked, ...extras]
    return [...new Set(all.filter((v): v is string => typeof v === 'string' && v.length > 0))]
      .filter((candidate) => shouldAttemptMediaUrl(candidate))
  }

  const candidates = [
    getMediaAttachmentPreviewUrl(attachment),
    null,
  ]

  return [...new Set(candidates.filter((value): value is string => typeof value === 'string' && value.length > 0))]
    .filter((candidate) => shouldAttemptMediaUrl(candidate))
}

function buildSourceCandidates(attachment: Nip92MediaAttachment): string[] {
  const primary = getMediaAttachmentSourceUrl(attachment)
  if (!primary || !shouldAttemptMediaUrl(primary)) return []
  return [primary]
}

function getAttachmentAspectRatio(attachment: Nip92MediaAttachment, fallback: number): number {
  const match = attachment.dim?.match(/^(\d+)\s*x\s*(\d+)$/i)
  if (!match) return fallback

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return fallback
  }

  return width / height
}

function getAttachmentAspectStyle(attachment: Nip92MediaAttachment, kind: string): CSSProperties {
  const fallback = kind === 'video' ? 16 / 9 : 4 / 3
  const aspectRatio = getAttachmentAspectRatio(attachment, fallback)
  return { aspectRatio: String(aspectRatio) }
}

// ── ALT badge + overlay ───────────────────────────────────────

function AltBadge({
  alt,
  show,
  onToggle,
}: {
  alt: string
  show: boolean
  onToggle: (e: MouseEvent<HTMLElement>) => void
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? 'Hide alt text' : 'Show alt text'}
        className="
          absolute bottom-2 left-2 z-10
          rounded-[6px] bg-black/60 px-1.5 py-0.5
          text-[11px] font-bold uppercase tracking-wide text-white
          backdrop-blur-sm transition-opacity active:opacity-70
        "
      >
        ALT
      </button>
      {show && (
        <div
          className="absolute inset-0 flex items-end bg-black/75 p-3"
          onClick={onToggle}
        >
          <p className="text-[13px] leading-[1.45] text-white line-clamp-[10]">
            {alt}
          </p>
        </div>
      )}
    </>
  )
}

function AttachmentTile({
  attachment,
  compact = false,
  interactive = true,
  isSensitive = false,
  sensitiveReason,
  isUnfollowed = false,
}: {
  attachment: Nip92MediaAttachment
  compact?: boolean
  interactive?: boolean
  isSensitive?: boolean
  sensitiveReason?: string | null
  isUnfollowed?: boolean
}) {
  const kind = getMediaAttachmentKind(attachment)
  const previewCandidates = useMemo(() => buildPreviewCandidates(attachment), [attachment])
  const moderationDocument = useMemo(
    () => buildAttachmentMediaModerationDocument(attachment),
    [attachment],
  )
  const { blocked, loading } = useMediaModerationDocument(moderationDocument)
  const playbackPlan = useMemo(
    () => (kind === 'video' || kind === 'audio' ? buildAttachmentPlaybackPlan(attachment, kind) : null),
    [attachment, kind],
  )
  const playbackSources = useMemo(
    () => (playbackPlan?.sources ?? []).filter((source) => shouldAttemptMediaUrl(source.url)),
    [playbackPlan],
  )
  const canRenderInlinePlayback = playbackPlan?.playability !== 'unsupported' && playbackSources.length > 0
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewFailed, setPreviewFailed] = useState(previewCandidates.length === 0)
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const [showAlt, setShowAlt] = useState(false)

  const previewUrl = previewCandidates[previewIndex] ?? null
  const sourceUrl = playbackPlan?.sources[0]?.url ?? buildSourceCandidates(attachment)[0] ?? null
  const sizeLabel = formatByteSize(attachment.size)
  const summary = attachment.alt ?? attachment.summary ?? attachment.mimeType ?? 'Attached file'
  const revealReason: MediaRevealReason | null = getMediaRevealReason({
    blocked: moderationDocument !== null && blocked,
    loading: moderationDocument !== null && loading,
    isSensitive,
    isUnfollowed,
  })
  const revealResetKey = `${attachment.url}:${revealReason ?? 'none'}:${sensitiveReason ?? ''}`

  useEffect(() => {
    setPreviewIndex(0)
    setPreviewFailed(previewCandidates.length === 0)
  }, [attachment.url, previewCandidates.length])

  function handleAltToggle(e: MouseEvent<HTMLElement>) {
    e.stopPropagation()
    setShowAlt((v) => !v)
  }

  if (kind === 'image' && previewUrl && !previewFailed) {
    // Build the ranked source list for <picture> — sources before previewIndex
    // have already failed so we skip them.  The <img> fallback carries the
    // current previewUrl so the JS retry loop still works for CDN errors.
    const pictureSources = getOrderedImageCandidates(attachment).filter(
      (c) => previewCandidates.indexOf(c.url) >= previewIndex,
    )

    return (
      <div className="overflow-hidden rounded-[18px] bg-[rgb(var(--color-bg-secondary))]">
        <div className="relative overflow-hidden" style={getAttachmentAspectStyle(attachment, kind)}>
          <MediaRevealGate
            reason={revealReason}
            resetKey={revealResetKey}
            details={sensitiveReason}
            className="h-full w-full"
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                if (revealReason === null && previewUrl) {
                  openImageLightbox(previewUrl, attachment.alt ?? '')
                }
              }}
              className="block h-full w-full cursor-zoom-in p-0"
              aria-label={attachment.alt ? `Open image: ${attachment.alt}` : 'Open image'}
            >
            <picture>
              {pictureSources.map((source) =>
                source.type ? (
                  <source key={source.url} srcSet={source.url} type={source.type} />
                ) : null,
              )}
              <img
                src={previewUrl}
                alt={attachment.alt ?? ''}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={() => {
                  recordMediaUrlSuccess(previewUrl)
                }}
                onError={() => {
                  recordMediaUrlFailure(previewUrl)
                  if (previewIndex < previewCandidates.length - 1) {
                    setPreviewIndex(previewIndex + 1)
                  } else {
                    setPreviewFailed(true)
                  }
                }}
                className="h-full w-full object-cover"
              />
            </picture>
            </button>
            {attachment.alt && (
              <AltBadge alt={attachment.alt} show={showAlt} onToggle={handleAltToggle} />
            )}
          </MediaRevealGate>
        </div>

        {!compact && (
          <div className="space-y-2 px-3 py-3">
            <div className="flex flex-wrap gap-2 text-[12px] text-[rgb(var(--color-label-secondary))]">
              {attachment.mimeType && (
                <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
                  {attachment.mimeType}
                </span>
              )}
              {sizeLabel && (
                <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
                  {sizeLabel}
                </span>
              )}
              {attachment.dim && (
                <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
                  {attachment.dim}
                </span>
              )}
            </div>

            {(attachment.alt || attachment.summary) && (
              <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                {summary}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  if (kind === 'video') {
    if (compact) {
      if (previewUrl && !previewFailed) {
        return (
          <div className="overflow-hidden rounded-[18px] bg-[rgb(var(--color-bg-secondary))]">
            <div className="relative">
              <MediaRevealGate
                reason={revealReason}
                resetKey={revealResetKey}
                details={sensitiveReason}
                className="aspect-[4/3] h-full w-full"
              >
                <img
                  src={previewUrl}
                  alt={attachment.alt ?? 'Video attachment'}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onLoad={() => {
                    recordMediaUrlSuccess(previewUrl)
                  }}
                  onError={() => {
                    recordMediaUrlFailure(previewUrl)
                    if (previewIndex < previewCandidates.length - 1) {
                      setPreviewIndex(previewIndex + 1)
                    } else {
                      setPreviewFailed(true)
                    }
                  }}
                  className="h-full w-full object-cover"
                />
                {attachment.alt && (
                  <AltBadge alt={attachment.alt} show={showAlt} onToggle={handleAltToggle} />
                )}
              </MediaRevealGate>
            </div>
          </div>
        )
      }

      // Only render a raw video in compact mode when a moderation document
      // exists (meaning the preview was classified). Without a classifiable
      // preview thumbnail we cannot screen the video — show a file card instead.
      if (moderationDocument && sourceUrl && !playbackFailed && canRenderInlinePlayback) {
        return (
          <div className="overflow-hidden rounded-[18px] bg-[rgb(var(--color-bg-secondary))]">
            <MediaRevealGate
              reason={revealReason}
              resetKey={revealResetKey}
              details={sensitiveReason}
              className="aspect-[4/3] h-full w-full"
            >
              <video
                muted
                playsInline
                preload="metadata"
                onLoadedData={() => {
                  playbackSources.forEach((source) => recordMediaUrlSuccess(source.url))
                }}
                onError={() => {
                  playbackSources.forEach((source) => recordMediaUrlFailure(source.url))
                  setPlaybackFailed(true)
                }}
                className="h-full w-full object-cover"
              >
                {playbackSources.map((source) => (
                  <source key={source.url} src={source.url} {...(source.type ? { type: source.type } : {})} />
                ))}
              </video>
            </MediaRevealGate>
          </div>
        )
      }

      return <GenericFileCard attachment={attachment} compact interactive={interactive} />
    }

    if (sourceUrl && !playbackFailed && canRenderInlinePlayback) {
      // Require a moderationDocument (thumbnail scan) before rendering the video.
      // Without a classifiable thumbnail we cannot screen the content — show a file card instead.
      if (!moderationDocument) {
        return <GenericFileCard attachment={attachment} compact={false} interactive={interactive} />
      }

      return (
        <div className="overflow-hidden rounded-[18px] bg-[rgb(var(--color-bg-secondary))]">
          <MediaRevealGate
            reason={revealReason}
            resetKey={revealResetKey}
            details={sensitiveReason}
            className="relative aspect-video w-full"
          >
            <video
              poster={previewUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              onLoadedData={() => {
                playbackSources.forEach((source) => recordMediaUrlSuccess(source.url))
              }}
              onError={() => {
                playbackSources.forEach((source) => recordMediaUrlFailure(source.url))
                setPlaybackFailed(true)
              }}
              className="h-full max-h-[70vh] w-full bg-black object-contain"
            >
              {playbackSources.map((source) => (
                <source key={source.url} src={source.url} {...(source.type ? { type: source.type } : {})} />
              ))}
            </video>
            {attachment.alt && (
              <AltBadge alt={attachment.alt} show={showAlt} onToggle={handleAltToggle} />
            )}
          </MediaRevealGate>
          {(attachment.alt || attachment.summary || attachment.mimeType || sizeLabel) && (
            <div className="space-y-2 px-3 py-3">
              {(attachment.alt || attachment.summary) && (
                <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                  {summary}
                </p>
              )}
              <div className="flex flex-wrap gap-2 text-[12px] text-[rgb(var(--color-label-secondary))]">
                {attachment.mimeType && (
                  <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
                    {attachment.mimeType}
                  </span>
                )}
                {sizeLabel && (
                  <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
                    {sizeLabel}
                  </span>
                )}
                {attachment.dim && (
                  <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
                    {attachment.dim}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )
    }
  }

  if (
    kind === 'audio' &&
    !compact &&
    sourceUrl &&
    !playbackFailed &&
    canRenderInlinePlayback
  ) {
    return (
      <div className="rounded-[18px] bg-[rgb(var(--color-bg-secondary))] p-4">
        <audio
          controls
          preload="metadata"
          onLoadedData={() => {
            playbackSources.forEach((source) => recordMediaUrlSuccess(source.url))
          }}
          onError={() => {
            playbackSources.forEach((source) => recordMediaUrlFailure(source.url))
            setPlaybackFailed(true)
          }}
          className="w-full"
        >
          {playbackSources.map((source) => (
            <source key={source.url} src={source.url} {...(source.type ? { type: source.type } : {})} />
          ))}
        </audio>
        {(attachment.alt || attachment.summary || attachment.mimeType || sizeLabel) && (
          <div className="mt-3 space-y-2">
            {(attachment.alt || attachment.summary) && (
              <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                {summary}
              </p>
            )}
            <div className="flex flex-wrap gap-2 text-[12px] text-[rgb(var(--color-label-secondary))]">
              {attachment.mimeType && (
                <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
                  {attachment.mimeType}
                </span>
              )}
              {sizeLabel && (
                <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
                  {sizeLabel}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return <GenericFileCard attachment={attachment} compact={compact} interactive={interactive} />
}

function GenericFileCard({
  attachment,
  compact = false,
  interactive = true,
}: {
  attachment: Nip92MediaAttachment
  compact?: boolean
  interactive?: boolean
}) {
  const sizeLabel = formatByteSize(attachment.size)
  const sourceUrl = getMediaAttachmentSourceUrl(attachment)
  const previewUrlCandidate = getMediaAttachmentPreviewUrl(attachment)
  const previewUrl = previewUrlCandidate && shouldAttemptMediaUrl(previewUrlCandidate) ? previewUrlCandidate : null
  const kind = getMediaAttachmentKind(attachment)
  const openLabel = kind === 'image'
    ? 'Open image'
    : kind === 'video'
      ? 'Open video'
      : kind === 'audio'
        ? 'Open audio'
        : 'Open attachment'

  const content = (
    <div className="overflow-hidden rounded-[18px] bg-[rgb(var(--color-bg-secondary))]">
      {previewUrl && !compact && (
        <img
          src={previewUrl}
          alt={attachment.alt ?? ''}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => {
            recordMediaUrlSuccess(previewUrl)
          }}
          onError={() => {
            recordMediaUrlFailure(previewUrl)
          }}
          className="max-h-[18rem] w-full object-cover"
        />
      )}

      <div className="space-y-2 px-4 py-3">
        <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
          {attachment.alt ?? attachment.summary ?? attachment.mimeType ?? 'Attached file'}
        </p>
        <div className="flex flex-wrap gap-2 text-[12px] text-[rgb(var(--color-label-secondary))]">
          {attachment.mimeType && (
            <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
              {attachment.mimeType}
            </span>
          )}
          {sizeLabel && (
            <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
              {sizeLabel}
            </span>
          )}
          {attachment.dim && (
            <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1">
              {attachment.dim}
            </span>
          )}
        </div>
        {interactive && sourceUrl && (
          <p className="text-[12px] font-medium text-[#007AFF]">
            {openLabel}
          </p>
        )}
      </div>
    </div>
  )

  if (!interactive || !sourceUrl) return content

  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={stopPropagation}
      className="block"
      aria-label={openLabel}
    >
      {content}
    </a>
  )
}

export function NoteMediaAttachments({
  attachments,
  className = '',
  compact = false,
  interactive = true,
  isSensitive = false,
  sensitiveReason,
  isUnfollowed = false,
}: NoteMediaAttachmentsProps) {
  const renderableAttachments = useMemo(
    () => attachments.filter((attachment) => canRenderMediaAttachmentInline(attachment)),
    [attachments],
  )

  if (renderableAttachments.length === 0) return null

  const gridClassName = renderableAttachments.length === 1
    ? 'grid-cols-1'
    : 'grid-cols-2'

  return (
    <div className={`grid gap-3 ${gridClassName} ${className}`}>
      {renderableAttachments.map((attachment) => (
        <AttachmentTile
          key={attachment.url}
          attachment={attachment}
          compact={compact}
          interactive={interactive}
          isSensitive={isSensitive}
          sensitiveReason={sensitiveReason ?? null}
          isUnfollowed={isUnfollowed}
        />
      ))}
    </div>
  )
}
