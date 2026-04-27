import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BlossomUpload } from '@/components/blossom/BlossomUpload'
import { useApp } from '@/contexts/app-context'
import { listSavedSyndicationFeedLinks } from '@/lib/syndication/feedLinks'
import { getMediaPlaybackProfile, getMediaPlaybackProfileLabel } from '@/lib/media/playback'
import { deriveMediaDimensions, normalizeNip94Tags } from '@/lib/nostr/fileMetadata'
import {
  deriveMediaPlaybackMetadata,
  parseVideoEvent,
  publishVideoEvent,
  type VideoVariantInput,
} from '@/lib/nostr/video'
import type { BlossomBlob } from '@/types'

interface DraftVideoVariant {
  sha256: string
  blob: BlossomBlob
  variant: VideoVariantInput
}

function getDraftVariantProfileLabel(variant: VideoVariantInput): string {
  const playbackKind = variant.mimeType.startsWith('audio/') ? 'audio' : 'video'
  return getMediaPlaybackProfileLabel(
    getMediaPlaybackProfile(variant.mimeType, variant.url, playbackKind),
  )
}

function slugifyIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function parseLineList(value: string): string[] {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

export default function VideoComposePage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [alt, setAlt] = useState('')
  const [isShort, setIsShort] = useState(false)
  const [addressable, setAddressable] = useState(true)
  const [identifier, setIdentifier] = useState('')
  const [identifierTouched, setIdentifierTouched] = useState(false)
  const [publishedAtInput, setPublishedAtInput] = useState('')
  const [markSensitive, setMarkSensitive] = useState(false)
  const [contentWarningReason, setContentWarningReason] = useState('')
  const [hashtagsInput, setHashtagsInput] = useState('')
  const [referencesInput, setReferencesInput] = useState('')
  const [showSavedSourcePicker, setShowSavedSourcePicker] = useState(false)
  const [participantsInput, setParticipantsInput] = useState('')
  const [textTracksInput, setTextTracksInput] = useState('')
  const [segmentsInput, setSegmentsInput] = useState('')
  const [originPlatform, setOriginPlatform] = useState('')
  const [originExternalId, setOriginExternalId] = useState('')
  const [originUrl, setOriginUrl] = useState('')
  const [originMetadata, setOriginMetadata] = useState('')
  const [variants, setVariants] = useState<DraftVideoVariant[]>([])
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (identifierTouched || !addressable) return
    setIdentifier(slugifyIdentifier(title))
  }, [addressable, identifierTouched, title])

  const kindLabel = useMemo(() => {
    if (addressable) return isShort ? 'Kind 34236' : 'Kind 34235'
    return isShort ? 'Kind 22' : 'Kind 21'
  }, [addressable, isShort])

  const savedSources = useMemo(
    () => listSavedSyndicationFeedLinks(currentUser?.pubkey?.trim() || 'anon'),
    [currentUser?.pubkey],
  )

  const handleAddSavedSource = (url: string) => {
    const existing = referencesInput.trim()
    const lines = existing ? existing.split('\n').map((l) => l.trim()).filter(Boolean) : []
    if (!lines.includes(url)) {
      setReferencesInput(lines.length > 0 ? `${existing}\n${url}` : url)
    }
    setShowSavedSourcePicker(false)
  }

  const handleUploaded = async (blob: BlossomBlob, file?: File) => {
    try {
      const baseMetadata = blob.nip94 ?? normalizeNip94Tags({
        url: blob.url,
        mimeType: blob.type,
        fileHash: blob.sha256,
        size: blob.size,
      })

      if (!baseMetadata) {
        setError('Uploaded blob metadata was invalid.')
        return
      }

      const [derivedDim, playback] = await Promise.all([
        file ? deriveMediaDimensions(file) : Promise.resolve(undefined),
        file
          ? deriveMediaPlaybackMetadata(file)
          : Promise.resolve<{ durationSeconds?: number; bitrate?: number }>({}),
      ])

      const dim = baseMetadata.dim ?? derivedDim

      const nextVariant: VideoVariantInput = {
        url: baseMetadata.url,
        mimeType: baseMetadata.mimeType,
        fileHash: baseMetadata.fileHash,
        ...(baseMetadata.originalHash ? { originalHash: baseMetadata.originalHash } : {}),
        ...(baseMetadata.size !== undefined ? { size: baseMetadata.size } : {}),
        ...(dim ? { dim } : {}),
        ...(baseMetadata.magnet ? { magnet: baseMetadata.magnet } : {}),
        ...(baseMetadata.torrentInfoHash ? { torrentInfoHash: baseMetadata.torrentInfoHash } : {}),
        ...(baseMetadata.blurhash ? { blurhash: baseMetadata.blurhash } : {}),
        ...(baseMetadata.thumb ? { thumb: baseMetadata.thumb } : {}),
        ...(baseMetadata.image ? { image: baseMetadata.image } : {}),
        ...(baseMetadata.summary ? { summary: baseMetadata.summary } : {}),
        ...(baseMetadata.alt ? { alt: baseMetadata.alt } : {}),
        ...(baseMetadata.fallbacks ? { fallbacks: baseMetadata.fallbacks } : {}),
        ...(baseMetadata.service ? { service: baseMetadata.service } : {}),
        ...(playback.durationSeconds !== undefined ? { durationSeconds: playback.durationSeconds } : {}),
        ...(playback.bitrate !== undefined ? { bitrate: playback.bitrate } : {}),
      }

      setVariants((current) => {
        if (current.some((item) => item.sha256 === blob.sha256)) return current
        return [...current, { sha256: blob.sha256, blob, variant: nextVariant }]
      })
      setError(null)

      if (!alt && baseMetadata.alt) {
        setAlt(baseMetadata.alt)
      }
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : 'Failed to prepare video variant metadata.')
    }
  }

  const handlePublish = async () => {
    if (publishing) return
    if (!currentUser) {
      setError('No signer available — install and unlock a NIP-07 extension to publish.')
      return
    }
    if (variants.length === 0) {
      setError('Upload at least one video or audio source first.')
      return
    }

    setPublishing(true)
    setError(null)

    try {
      const published = await publishVideoEvent({
        title,
        summary,
        alt,
        isShort,
        addressable,
        identifier,
        ...(publishedAtInput ? { publishedAt: Math.floor(new Date(publishedAtInput).getTime() / 1000) } : {}),
        ...(markSensitive ? { contentWarning: { enabled: true, reason: contentWarningReason } } : {}),
        hashtags: hashtagsInput.split(/[\s,]+/).filter(Boolean),
        references: parseLineList(referencesInput),
        participants: parseLineList(participantsInput).map((line) => {
          const [pubkey, relayHint] = line.split('|').map(part => part.trim())
          return {
            pubkey: pubkey ?? '',
            ...(relayHint ? { relayHint } : {}),
          }
        }),
        textTracks: parseLineList(textTracksInput).map((line) => {
          const [reference, trackType, language] = line.split('|').map(part => part.trim())
          return {
            reference: reference ?? '',
            ...(trackType ? { trackType } : {}),
            ...(language ? { language } : {}),
          }
        }),
        segments: parseLineList(segmentsInput).map((line) => {
          const [start, end, segmentTitle, thumbnail] = line.split('|').map(part => part.trim())
          return {
            start: start ?? '',
            end: end ?? '',
            ...(segmentTitle ? { title: segmentTitle } : {}),
            ...(thumbnail ? { thumbnail } : {}),
          }
        }),
        ...(originPlatform && originExternalId
          ? {
              origin: {
                platform: originPlatform,
                externalId: originExternalId,
                ...(originUrl ? { originalUrl: originUrl } : {}),
                ...(originMetadata ? { metadata: originMetadata } : {}),
              },
            }
          : {}),
        variants: variants.map(item => item.variant),
      })

      const video = parseVideoEvent(published)
      navigate(video?.route ?? `/note/${published.id}`, { replace: true })
    } catch (publishError: unknown) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish video event.')
      setPublishing(false)
    }
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

      <div className="space-y-6 pb-10 pt-4">
        <header className="space-y-2">
          <h1 className="text-[34px] leading-[1.05] tracking-[-0.04em] font-semibold text-[rgb(var(--color-label))]">
            Publish Video
          </h1>
          <p className="text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
            Publish NIP-71 video content with inline `imeta` variants and the correct video kind.
          </p>
          <p className="text-[13px] text-[rgb(var(--color-label-tertiary))]">
            Current target: {kindLabel}
          </p>
        </header>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Title
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Description
            </span>
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={5}
              placeholder="Describe the video"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Alt
            </span>
            <input
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
              placeholder="Accessible description"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3">
              <span className="text-[15px] text-[rgb(var(--color-label))]">Short video</span>
              <input type="checkbox" checked={isShort} onChange={(event) => setIsShort(event.target.checked)} />
            </label>

            <label className="flex items-center justify-between rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3">
              <span className="text-[15px] text-[rgb(var(--color-label))]">Addressable</span>
              <input type="checkbox" checked={addressable} onChange={(event) => setAddressable(event.target.checked)} />
            </label>
          </div>

          {addressable && (
            <label className="block space-y-2">
              <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Identifier
              </span>
              <input
                value={identifier}
                onChange={(event) => {
                  setIdentifierTouched(true)
                  setIdentifier(event.target.value)
                }}
                placeholder="video-slug"
                className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
              />
            </label>
          )}

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Published At
            </span>
            <input
              type="datetime-local"
              value={publishedAtInput}
              onChange={(event) => setPublishedAtInput(event.target.value)}
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>
        </section>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-semibold text-[rgb(var(--color-label))]">
                Variants
              </h2>
              <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                Upload one or more video sources. Each upload already publishes its own kind-1063 metadata.
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
                Best practice: upload a WebM (AV1 or VP9 + Opus) as the primary open profile, then add an MP4 (H.264 + AAC) variant for Safari and older devices. WebM/AV1 gives the highest quality at the lowest bitrate and plays natively in Chrome, Firefox, and Edge. MP4/H.264 covers Safari and iOS.
              </p>
            </div>
            <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
              {variants.length}
            </span>
          </div>

          <BlossomUpload
            accept="video/*,audio/*"
            onUploaded={(blob, file) => void handleUploaded(blob, file)}
            disabled={publishing}
            className="max-w-none"
          />

          {variants.length > 0 && (
            <div className="space-y-3">
              {variants.map((item) => (
                <div
                  key={item.sha256}
                  className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium text-[rgb(var(--color-label))]">
                        {item.variant.dim ?? item.variant.mimeType}
                      </p>
                      <p className="mt-1 truncate text-[13px] text-[rgb(var(--color-label-secondary))]">
                        {item.variant.url}
                      </p>
                      <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))]">
                        {item.variant.durationSeconds
                          ? `${Math.round(item.variant.durationSeconds)}s`
                          : 'unknown duration'}
                        {item.variant.bitrate ? ` · ${Math.round(item.variant.bitrate / 1000)} kbps` : ''}
                        {` · ${getDraftVariantProfileLabel(item.variant)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setVariants((current) => current.filter((variant) => variant.sha256 !== item.sha256))}
                      className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <label className="flex items-center justify-between rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3">
            <span className="text-[15px] text-[rgb(var(--color-label))]">Content warning</span>
            <input type="checkbox" checked={markSensitive} onChange={(event) => setMarkSensitive(event.target.checked)} />
          </label>

          {markSensitive && (
            <input
              value={contentWarningReason}
              onChange={(event) => setContentWarningReason(event.target.value)}
              placeholder="Optional warning reason"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          )}

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Hashtags
            </span>
            <input
              value={hashtagsInput}
              onChange={(event) => setHashtagsInput(event.target.value)}
              placeholder="nostr bitcoin video"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <div className="block space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                References
              </span>
              {savedSources.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSavedSourcePicker((previous) => !previous)}
                  className="rounded-[8px] border border-[rgb(var(--color-fill)/0.18)] px-2.5 py-1 text-[11px] font-medium text-[rgb(var(--color-label))] active:opacity-80"
                >
                  {showSavedSourcePicker ? 'Hide saved' : 'Add from saved'}
                </button>
              )}
            </div>

            {showSavedSourcePicker && (
              <div className="rounded-[12px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-2 space-y-1">
                {savedSources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => handleAddSavedSource(source.url)}
                    className="flex w-full items-center justify-between gap-3 rounded-[8px] px-2.5 py-2 text-left hover:bg-[rgb(var(--color-fill)/0.08)] active:opacity-80"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-[rgb(var(--color-label))]">{source.label}</p>
                      <p className="truncate text-[11px] text-[rgb(var(--color-label-tertiary))]">{source.url}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-[rgb(var(--color-accent))]">Add</span>
                  </button>
                ))}
              </div>
            )}

            <textarea
              value={referencesInput}
              onChange={(event) => setReferencesInput(event.target.value)}
              rows={3}
              placeholder={'One URL per line'}
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </div>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Participants
            </span>
            <textarea
              value={participantsInput}
              onChange={(event) => setParticipantsInput(event.target.value)}
              rows={3}
              placeholder={'pubkey | relayHint (optional)'}
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Text Tracks
            </span>
            <textarea
              value={textTracksInput}
              onChange={(event) => setTextTracksInput(event.target.value)}
              rows={3}
              placeholder={'reference | type | language'}
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Segments
            </span>
            <textarea
              value={segmentsInput}
              onChange={(event) => setSegmentsInput(event.target.value)}
              rows={4}
              placeholder={'HH:MM:SS.sss | HH:MM:SS.sss | Title | thumbnail URL'}
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>
        </section>

        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <h2 className="text-[18px] font-semibold text-[rgb(var(--color-label))]">
            Origin
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={originPlatform}
              onChange={(event) => setOriginPlatform(event.target.value)}
              placeholder="Platform"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
            <input
              value={originExternalId}
              onChange={(event) => setOriginExternalId(event.target.value)}
              placeholder="External ID"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </div>
          <input
            value={originUrl}
            onChange={(event) => setOriginUrl(event.target.value)}
            placeholder="Original URL"
            className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
          />
          <textarea
            value={originMetadata}
            onChange={(event) => setOriginMetadata(event.target.value)}
            rows={3}
            placeholder="Origin metadata"
            className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
          />
        </section>

        {!currentUser && (
          <p className="text-[13px] text-[rgb(var(--color-system-red))]">
            Install and unlock a NIP-07 signer to publish videos.
          </p>
        )}

        {error && (
          <p className="text-[13px] text-[rgb(var(--color-system-red))]">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            disabled={publishing}
            className="flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5 text-[14px] font-medium text-[rgb(var(--color-label))] transition-opacity active:opacity-75 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handlePublish()}
            disabled={publishing}
            className="flex-1 rounded-[14px] bg-[rgb(var(--color-label))] px-4 py-2.5 text-[14px] font-semibold text-[rgb(var(--color-bg))] transition-opacity active:opacity-80 disabled:opacity-40"
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  )
}
