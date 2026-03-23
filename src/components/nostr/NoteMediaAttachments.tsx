import { useMemo, useState, type MouseEvent } from 'react'
import { useMediaModerationDocument } from '@/hooks/useMediaModeration'
import { buildAttachmentPlaybackPlan } from '@/lib/media/playback'
import { buildAttachmentMediaModerationDocument } from '@/lib/moderation/mediaContent'
import { canRenderMediaAttachmentInline, getMediaAttachmentKind, getMediaAttachmentPreviewUrl, getMediaAttachmentSourceUrl } from '@/lib/nostr/imeta'
import type { Nip92MediaAttachment } from '@/types'

interface NoteMediaAttachmentsProps {
  attachments: Nip92MediaAttachment[]
  className?: string
  compact?: boolean
  interactive?: boolean
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
  const candidates = [
    getMediaAttachmentPreviewUrl(attachment),
    getMediaAttachmentKind(attachment) === 'image' ? getMediaAttachmentSourceUrl(attachment) : null,
  ]

  return [...new Set(candidates.filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

function buildSourceCandidates(attachment: Nip92MediaAttachment): string[] {
  const primary = getMediaAttachmentSourceUrl(attachment)
  return primary ? [primary] : []
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
}: {
  attachment: Nip92MediaAttachment
  compact?: boolean
  interactive?: boolean
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
  const playbackSources = playbackPlan?.sources ?? []
  const canRenderInlinePlayback = playbackPlan?.playability !== 'unsupported' && playbackSources.length > 0
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const [showAlt, setShowAlt] = useState(false)

  const previewUrl = previewCandidates[previewIndex] ?? null
  const sourceUrl = playbackPlan?.sources[0]?.url ?? buildSourceCandidates(attachment)[0] ?? null
  const sizeLabel = formatByteSize(attachment.size)
  const summary = attachment.alt ?? attachment.summary ?? attachment.mimeType ?? 'Attached file'

  if (moderationDocument && (loading || blocked)) {
    return null
  }

  function handleAltToggle(e: MouseEvent<HTMLElement>) {
    e.stopPropagation()
    setShowAlt((v) => !v)
  }

  if (kind === 'image' && previewUrl && !previewFailed) {
    return (
      <div className="overflow-hidden rounded-[18px] bg-[rgb(var(--color-bg-secondary))]">
        <div className="relative">
          <img
            src={previewUrl}
            alt={attachment.alt ?? ''}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => {
              if (previewIndex < previewCandidates.length - 1) {
                setPreviewIndex(previewIndex + 1)
              } else {
                setPreviewFailed(true)
              }
            }}
            className={compact ? 'h-full w-full object-cover aspect-[4/3]' : 'max-h-[70vh] w-full object-cover'}
          />
          {attachment.alt && (
            <AltBadge alt={attachment.alt} show={showAlt} onToggle={handleAltToggle} />
          )}
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
              <img
                src={previewUrl}
                alt={attachment.alt ?? 'Video attachment'}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => {
                  if (previewIndex < previewCandidates.length - 1) {
                    setPreviewIndex(previewIndex + 1)
                  } else {
                    setPreviewFailed(true)
                  }
                }}
                className="aspect-[4/3] h-full w-full object-cover"
              />
              {attachment.alt && (
                <AltBadge alt={attachment.alt} show={showAlt} onToggle={handleAltToggle} />
              )}
            </div>
          </div>
        )
      }

      if (sourceUrl && !playbackFailed && canRenderInlinePlayback) {
        return (
          <div className="overflow-hidden rounded-[18px] bg-[rgb(var(--color-bg-secondary))]">
            <video
              muted
              playsInline
              preload="metadata"
              onError={() => setPlaybackFailed(true)}
              className="aspect-[4/3] h-full w-full object-cover"
            >
              {playbackSources.map((source) => (
                <source key={source.url} src={source.url} {...(source.type ? { type: source.type } : {})} />
              ))}
            </video>
          </div>
        )
      }

      return <GenericFileCard attachment={attachment} compact interactive={interactive} />
    }

    if (sourceUrl && !playbackFailed && canRenderInlinePlayback) {
      return (
        <div className="overflow-hidden rounded-[18px] bg-[rgb(var(--color-bg-secondary))]">
          <div className="relative">
            <video
              poster={previewUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              onError={() => {
                setPlaybackFailed(true)
              }}
              className="max-h-[70vh] w-full bg-black object-contain"
            >
              {playbackSources.map((source) => (
                <source key={source.url} src={source.url} {...(source.type ? { type: source.type } : {})} />
              ))}
            </video>
            {attachment.alt && (
              <AltBadge alt={attachment.alt} show={showAlt} onToggle={handleAltToggle} />
            )}
          </div>
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
          onError={() => {
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
  const previewUrl = getMediaAttachmentPreviewUrl(attachment)
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
        />
      ))}
    </div>
  )
}
