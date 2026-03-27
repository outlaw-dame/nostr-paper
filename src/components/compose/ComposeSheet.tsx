import { useEffect, useMemo, useRef, useState } from 'react'
import { Sheet } from 'konsta/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BlossomUpload } from '@/components/blossom/BlossomUpload'
import { GifPicker } from '@/components/compose/GifPicker'
import { useApp } from '@/contexts/app-context'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { useAddressableEvent } from '@/hooks/useAddressableEvent'
import { useEvent } from '@/hooks/useEvent'
import { useHashtagSuggestions } from '@/hooks/useHashtagSuggestions'
import { applyHashtagSuggestion } from '@/lib/compose/hashtags'
import {
  clearComposeSearch,
  getComposeQuoteReference,
  getComposeReplyReference,
  getComposeStoryMode,
  isComposeOpen,
} from '@/lib/compose'
import { normalizeNip94Tags } from '@/lib/nostr/fileMetadata'
import { decodeAddressReference, decodeEventReference } from '@/lib/nostr/nip21'
import { publishNote } from '@/lib/nostr/note'
import { STORY_EXPIRATION_SECONDS } from '@/lib/nostr/stories'
import {
  parseCommentEvent,
  publishComment,
  publishTextReply,
  publishThread,
} from '@/lib/nostr/thread'
import { isTenorConfigured, type TenorGif } from '@/lib/tenor/client'
import type { BlossomBlob } from '@/types'
import { Kind } from '@/types'

function inferBlobPreviewKind(blob: BlossomBlob): 'image' | 'video' | 'audio' | 'file' {
  const mimeType = blob.nip94?.mimeType ?? blob.type
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'file'
}

function getBlobPreviewUrl(blob: BlossomBlob): string | null {
  const metadata = blob.nip94 ?? normalizeNip94Tags({
    url: blob.url,
    mimeType: blob.type,
    fileHash: blob.sha256,
    size: blob.size,
  })

  if (!metadata) return null

  const candidates = [
    metadata.image,
    metadata.thumb,
    inferBlobPreviewKind(blob) === 'image' ? metadata.url : undefined,
    ...(metadata.fallbacks ?? []),
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate
    }
  }

  return null
}

export function ComposeSheet() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useApp()

  const open = isComposeOpen(location.search)
  const quoteReference = getComposeQuoteReference(location.search)
  const replyReference = getComposeReplyReference(location.search)
  const storyIntent = getComposeStoryMode(location.search)
  const targetReference = replyReference ?? quoteReference

  const eventReference = useMemo(
    () => decodeEventReference(targetReference),
    [targetReference],
  )
  const addressReference = useMemo(
    () => decodeAddressReference(targetReference),
    [targetReference],
  )

  const { event: quotedEvent, loading: quoteEventLoading } = useEvent(eventReference?.eventId)
  const {
    event: quotedAddressEvent,
    loading: quoteAddressLoading,
  } = useAddressableEvent({
    pubkey: addressReference?.pubkey,
    kind: addressReference?.kind,
    identifier: addressReference?.identifier,
  })

  const targetEvent = quotedEvent ?? quotedAddressEvent
  const quoteTarget = quoteReference ? targetEvent : null
  const replyTarget = replyReference ? targetEvent : null
  const targetLoading = Boolean(targetReference) && (quoteEventLoading || quoteAddressLoading)
  const targetInvalid = Boolean(
    targetReference &&
    !eventReference &&
    !addressReference,
  )
  const [publishMode, setPublishMode] = useState<'note' | 'thread'>('note')
  const [storyMode, setStoryMode] = useState(false)
  const [threadTitle, setThreadTitle] = useState('')

  const [body,          setBody]          = useState('')
  const [media,         setMedia]         = useState<BlossomBlob[]>([])
  const [selectedGifs,  setSelectedGifs]  = useState<TenorGif[]>([])
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [publishing,    setPublishing]    = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [altTexts,      setAltTexts]      = useState<Record<string, string>>({})
  const [editingAltFor, setEditingAltFor] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const tenorEnabled = isTenorConfigured()
  const replyingToKind1 = replyTarget?.kind === Kind.ShortNote
  const replyingToThread = replyTarget?.kind === Kind.Thread || (
    replyTarget?.kind === Kind.Comment &&
    parseCommentEvent(replyTarget)?.rootKind === String(Kind.Thread)
  )
  const threadModeAvailable = !quoteReference && !replyReference
  const threadMode = threadModeAvailable && publishMode === 'thread'
  const attachmentsAllowed = !replyReference && !threadMode
  const storyModeAvailable = !replyReference && !quoteReference && !threadMode
  const suggestionContext = useMemo(
    () => (threadMode ? `${threadTitle}\n\n${body}` : body),
    [body, threadMode, threadTitle],
  )
  const {
    suggestions: hashtagSuggestions,
    loading: hashtagSuggestionsLoading,
  } = useHashtagSuggestions(suggestionContext, {
    enabled: open && !publishing,
    limit: 6,
  })

  useEffect(() => {
    if (!open) {
      setBody('')
      setThreadTitle('')
      setPublishMode('note')
      setStoryMode(false)
      setMedia([])
      setSelectedGifs([])
      setShowGifPicker(false)
      setError(null)
      setPublishing(false)
      setAltTexts({})
      setEditingAltFor(null)
      return
    }

    setBody('')
    setThreadTitle('')
    setPublishMode('note')
    setStoryMode(!quoteReference && !replyReference && storyIntent)
    setMedia([])
    setSelectedGifs([])
    setShowGifPicker(false)
    setError(null)
    setAltTexts({})
    setEditingAltFor(null)

    const timer = window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 40)

    return () => window.clearTimeout(timer)
  }, [open, quoteReference, replyReference, storyIntent])

  const closeComposer = () => {
    if (publishing) return
    navigate(
      {
        pathname: location.pathname,
        search: clearComposeSearch(location.search),
      },
      { replace: true },
    )
  }

  const handlePublish = async () => {
    if (publishing) return

    if (!currentUser) {
      setError('No signer available — install and unlock a NIP-07 extension to publish.')
      return
    }

    if (targetReference && !targetEvent) {
      setError(targetInvalid
        ? (replyReference ? 'Invalid reply target reference.' : 'Invalid quoted event reference.')
        : (replyReference ? 'Reply target is still loading.' : 'Quoted event is still loading.'))
      return
    }

    setPublishing(true)
    setError(null)

    try {
      const published = replyTarget
        ? await (replyingToKind1
          ? publishTextReply({ target: replyTarget, body })
          : publishComment({ target: replyTarget, body }))
        : threadMode
          ? await publishThread({ title: threadTitle, body })
          : await publishNote({
              body,
              quoteTarget,
              media,
              expiresAt: storyMode ? Math.floor(Date.now() / 1000) + STORY_EXPIRATION_SECONDS : null,
              gifUrls: selectedGifs.map((g) => g.gifUrl),
              mediaAlt: altTexts,
            })

      navigate(`/note/${published.id}`, { replace: true })
    } catch (publishError: unknown) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish note.')
      setPublishing(false)
    }
  }

  const publishDisabled = publishing ||
    !currentUser ||
    targetInvalid ||
    (Boolean(targetReference) && !targetEvent) ||
    (threadMode
      ? threadTitle.trim().length === 0 || body.trim().length === 0
      : replyReference
        ? body.trim().length === 0
        : storyMode
          ? (media.length === 0 && selectedGifs.length === 0)
          : (!quoteReference && body.trim().length === 0 && media.length === 0 && selectedGifs.length === 0))

  const handleUploaded = (blob: BlossomBlob) => {
    setMedia((current) => {
      if (current.some((item) => item.sha256 === blob.sha256)) return current
      return [...current, blob]
    })
  }

  const removeMedia = (sha256: string) => {
    if (publishing) return
    setMedia((current) => current.filter((item) => item.sha256 !== sha256))
    setAltTexts((prev) => { const { [sha256]: _, ...rest } = prev; return rest })
    if (editingAltFor === sha256) setEditingAltFor(null)
  }

  const handleGifSelect = (gif: TenorGif) => {
    setSelectedGifs((current) => {
      if (current.some((g) => g.id === gif.id)) return current
      return [...current, gif]
    })
    setShowGifPicker(false)
  }

  const removeGif = (id: string) => {
    if (publishing) return
    setSelectedGifs((current) => current.filter((g) => g.id !== id))
  }

  const handleHashtagSuggestion = (tag: string) => {
    if (publishing) return
    setBody((current) => applyHashtagSuggestion(current, tag))
    textareaRef.current?.focus()
  }

  const formatSuggestionRecency = (timestamp: number) => {
    if (timestamp <= 0) return 'recent'

    const delta = Math.max(0, Math.floor(Date.now() / 1000) - timestamp)
    if (delta < 3600) return `${Math.max(1, Math.floor(delta / 60) || 1)}m`
    if (delta < 86400) return `${Math.floor(delta / 3600)}h`
    if (delta < 30 * 86400) return `${Math.floor(delta / 86400)}d`

    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }

  if (!open) return null

  return (
    <Sheet
      opened={open}
      onBackdropClick={closeComposer}
      className="rounded-t-[28px]"
    >
      <div className="pb-safe min-h-[44vh] flex flex-col">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-[rgb(var(--color-fill)/0.3)]" />
        </div>

        <div className="px-5 py-4 flex-1 flex flex-col gap-4">
          <div>
            <h2 className="text-headline text-[rgb(var(--color-label))]">
              {replyReference ? 'Reply' : quoteReference ? 'New Quote Post' : threadMode ? 'New Thread' : storyMode ? 'New Story' : 'New Note'}
            </h2>
            <p className="mt-1 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {replyReference
                ? replyingToKind1
                  ? 'This will publish as a kind-1 NIP-10 reply for compatibility with older note threads.'
                  : replyingToThread
                    ? 'This will publish as a kind-1111 comment scoped to the root thread, as required by NIP-7D.'
                    : 'This will publish as a kind-1111 NIP-22 comment on the selected event.'
                : quoteReference
                ? 'Your comment will publish as a kind-1 note with an appended NIP-21 reference and matching q tags.'
                : threadMode
                  ? 'Publish a kind-11 thread root with a title and plaintext content. Replies will use kind-1111 comments.'
                : storyMode
                  ? 'Publish a signed kind-1 note with media and a NIP-40 expiration tag. Story clients should ignore it after 24 hours.'
                  : 'Publish a signed kind-1 note to your write relays. Uploaded media is embedded with NIP-92 imeta tags and its own kind-1063 metadata event.'}
            </p>
          </div>

          {threadModeAvailable && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPublishMode('note')}
                disabled={publishing}
                className={`
                  flex-1 rounded-[14px] border px-3 py-2.5 text-[14px] font-medium transition-colors disabled:opacity-40
                  ${publishMode === 'note'
                    ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                    : 'border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label))]'
                  }
                `}
              >
                Note
              </button>
              <button
                type="button"
                onClick={() => {
                  setPublishMode('thread')
                  setStoryMode(false)
                }}
                disabled={publishing}
                className={`
                  flex-1 rounded-[14px] border px-3 py-2.5 text-[14px] font-medium transition-colors disabled:opacity-40
                  ${publishMode === 'thread'
                    ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                    : 'border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label))]'
                  }
                `}
              >
                Thread
              </button>
            </div>
          )}

          {storyModeAvailable && publishMode === 'note' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStoryMode(false)}
                  disabled={publishing}
                  className={`
                    flex-1 rounded-[14px] border px-3 py-2.5 text-[14px] font-medium transition-colors disabled:opacity-40
                    ${!storyMode
                      ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                      : 'border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label))]'
                    }
                  `}
                >
                  Post
                </button>
                <button
                  type="button"
                  onClick={() => setStoryMode(true)}
                  disabled={publishing}
                  className={`
                    flex-1 rounded-[14px] border px-3 py-2.5 text-[14px] font-medium transition-colors disabled:opacity-40
                    ${storyMode
                      ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                      : 'border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label))]'
                    }
                  `}
                >
                  Story
                </button>
              </div>

              {storyMode && (
                <p className="text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                  Stories require at least one image, video, or GIF and expire 24 hours after publishing.
                </p>
              )}
            </div>
          )}

          {threadMode && (
            <label className="block">
              <span className="sr-only">Thread title</span>
              <input
                value={threadTitle}
                onChange={(event) => setThreadTitle(event.target.value)}
                placeholder="Thread title"
                maxLength={160}
                className="
                  w-full rounded-[18px] border border-[rgb(var(--color-fill)/0.18)]
                  bg-[rgb(var(--color-bg-secondary))] px-4 py-3
                  text-[15px] leading-6 text-[rgb(var(--color-label))]
                  outline-none transition-colors focus:border-[#007AFF]
                  placeholder:text-[rgb(var(--color-label-tertiary))]
                "
              />
            </label>
          )}

          <label className="block">
            <span className="sr-only">Note content</span>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={replyReference ? 'Write your reply…' : quoteReference ? 'Add your comment…' : threadMode ? 'Start the thread…' : storyMode ? 'Add a caption…' : 'Share what is happening…'}
              rows={replyReference || quoteReference ? 5 : 7}
              className="
                w-full resize-none rounded-[18px] border border-[rgb(var(--color-fill)/0.18)]
                bg-[rgb(var(--color-bg-secondary))] px-4 py-3
                text-[15px] leading-7 text-[rgb(var(--color-label))]
                outline-none transition-colors focus:border-[#007AFF]
                placeholder:text-[rgb(var(--color-label-tertiary))]
              "
            />
          </label>

          {(hashtagSuggestionsLoading || hashtagSuggestions.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                  Suggested Hashtags
                </p>
                <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                  {hashtagSuggestionsLoading ? 'Updating…' : 'Recent + relevant'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {hashtagSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.tag}
                    type="button"
                    onClick={() => handleHashtagSuggestion(suggestion.tag)}
                    disabled={publishing}
                    className="
                      rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                      bg-[rgb(var(--color-bg-secondary))] px-3 py-2 text-left
                      transition-colors active:opacity-80 disabled:opacity-40
                    "
                  >
                    <p className="text-[13px] font-semibold text-[#007AFF]">
                      #{suggestion.tag}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-5 text-[rgb(var(--color-label-tertiary))]">
                      {suggestion.usageCount} use{suggestion.usageCount === 1 ? '' : 's'} · {formatSuggestionRecency(suggestion.latestCreatedAt)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {attachmentsAllowed && (
            <div className="space-y-3">
            {/* Header row */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Media
              </p>
              {(media.length > 0 || selectedGifs.length > 0) && (
                <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                  {media.length + selectedGifs.length} attachment{media.length + selectedGifs.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* Upload row: Blossom uploader + GIF toggle */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <BlossomUpload
                  onUploaded={handleUploaded}
                  disabled={publishing}
                  className="max-w-none"
                />
              </div>

              {tenorEnabled && (
                <button
                  type="button"
                  onClick={() => setShowGifPicker((v) => !v)}
                  disabled={publishing}
                  className={`
                    shrink-0 rounded-[14px] border px-3 py-2
                    text-[13px] font-semibold transition-colors
                    disabled:opacity-40
                    ${showGifPicker
                      ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                      : 'border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label))]'
                    }
                  `}
                >
                  GIF
                </button>
              )}
            </div>

            {/* Tenor GIF picker — inline panel */}
            {showGifPicker && (
              <GifPicker onSelect={handleGifSelect} />
            )}

            {/* Attachment preview grid — Blossom blobs + selected GIFs */}
            {(media.length > 0 || selectedGifs.length > 0) && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((blob) => {
                  const previewKind    = inferBlobPreviewKind(blob)
                  const previewUrl     = getBlobPreviewUrl(blob)
                  const currentAlt     = altTexts[blob.sha256] ?? blob.nip94?.alt ?? ''
                  const isEditingAlt   = editingAltFor === blob.sha256

                  return (
                    <div
                      key={blob.sha256}
                      className="
                        overflow-hidden rounded-[18px] border border-[rgb(var(--color-fill)/0.12)]
                        bg-[rgb(var(--color-bg-secondary))]
                      "
                    >
                      <div className="relative aspect-[4/3] bg-[rgb(var(--color-fill)/0.08)]">
                        {previewKind === 'image' && previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={currentAlt || blob.nip94?.alt || ''}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center px-3 text-center text-[13px] text-[rgb(var(--color-label-secondary))]">
                            {previewKind === 'video' ? 'Video' : previewKind === 'audio' ? 'Audio' : 'File'}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => removeMedia(blob.sha256)}
                          disabled={publishing}
                          className="
                            absolute right-2 top-2 rounded-full bg-black/55 px-2 py-1
                            text-[11px] font-medium text-white transition-opacity active:opacity-70
                            disabled:opacity-40
                          "
                        >
                          Remove
                        </button>
                      </div>

                      {/* Alt text section */}
                      <div className="px-3 py-2.5">
                        {isEditingAlt ? (
                          <div className="space-y-1.5">
                            <textarea
                              value={currentAlt}
                              onChange={(e) =>
                                setAltTexts((prev) => ({ ...prev, [blob.sha256]: e.target.value }))
                              }
                              placeholder="Describe this media for people who can't see it…"
                              rows={3}
                              maxLength={1000}
                              disabled={publishing}
                              autoFocus
                              className="
                                w-full resize-none rounded-[12px]
                                border border-[#007AFF]
                                bg-[rgb(var(--color-bg))] px-3 py-2
                                text-[13px] leading-5 text-[rgb(var(--color-label))]
                                outline-none placeholder:text-[rgb(var(--color-label-tertiary))]
                                disabled:opacity-40
                              "
                            />
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-[rgb(var(--color-label-tertiary))]">
                                {currentAlt.length}/1000
                              </span>
                              <button
                                type="button"
                                onClick={() => setEditingAltFor(null)}
                                className="text-[13px] font-semibold text-[#007AFF]"
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingAltFor(blob.sha256)}
                            disabled={publishing}
                            className="
                              text-[13px] text-[#007AFF] disabled:opacity-40
                              text-left w-full truncate
                            "
                          >
                            {currentAlt
                              ? `"${currentAlt.slice(0, 40)}${currentAlt.length > 40 ? '…' : ''}"`
                              : '+ Add description'
                            }
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}

                {selectedGifs.map((gif) => (
                  <div
                    key={gif.id}
                    className="
                      overflow-hidden rounded-[18px] border border-[rgb(var(--color-fill)/0.12)]
                      bg-[rgb(var(--color-bg-secondary))]
                    "
                  >
                    <div className="relative aspect-[4/3] bg-[rgb(var(--color-fill)/0.08)]">
                      <img
                        src={gif.previewUrl}
                        alt={gif.title}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />

                      <button
                        type="button"
                        onClick={() => removeGif(gif.id)}
                        disabled={publishing}
                        className="
                          absolute right-2 top-2 rounded-full bg-black/55 px-2 py-1
                          text-[11px] font-medium text-white transition-opacity active:opacity-70
                          disabled:opacity-40
                        "
                      >
                        Remove
                      </button>
                    </div>

                    <div className="px-3 py-2.5">
                      <p className="truncate text-[12px] text-[rgb(var(--color-label-tertiary))]">
                        GIF · Tenor
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          )}

          {targetReference && (
            <div className="space-y-2">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                {replyReference ? 'Replying To' : 'Quoting'}
              </p>

              {targetEvent ? (
                <EventPreviewCard event={targetEvent} linked={false} />
              ) : (
                <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
                  <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                    {targetInvalid
                      ? (replyReference ? 'Reply target reference is invalid.' : 'Quoted event reference is invalid.')
                      : targetLoading
                        ? (replyReference ? 'Loading reply target…' : 'Loading quoted event…')
                        : (replyReference ? 'Reply target unavailable.' : 'Quoted event unavailable.')}
                  </p>
                </div>
              )}
            </div>
          )}

          {!currentUser && (
            <p className="text-[13px] text-[rgb(var(--color-system-red))]">
              Install and unlock a NIP-07 signer to publish notes.
            </p>
          )}

          {error && (
            <p className="text-[13px] text-[rgb(var(--color-system-red))]">
              {error}
            </p>
          )}

          <div className="mt-auto flex gap-2">
            <button
              type="button"
              onClick={closeComposer}
              disabled={publishing}
              className="
                flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
                text-[14px] font-medium text-[rgb(var(--color-label))]
                transition-opacity active:opacity-75 disabled:opacity-40
              "
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={publishDisabled}
              className="
                flex-1 rounded-[14px] bg-[rgb(var(--color-label))]
                px-4 py-2.5 text-[14px] font-semibold text-[rgb(var(--color-bg))]
                transition-opacity active:opacity-80 disabled:opacity-40
              "
            >
              {publishing ? 'Publishing…' : storyMode ? 'Publish Story' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
