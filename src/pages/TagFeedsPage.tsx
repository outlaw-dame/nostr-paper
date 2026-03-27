import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'
import { useSavedTagFeeds } from '@/hooks/useSavedTagFeeds'
import { deleteTagFeed, saveTagFeed, type SavedTagFeed } from '@/lib/feed/tagFeeds'
import {
  buildTagTimelineHref,
  describeTagTimeline,
  normalizeTagTimelineTags,
  type TagTimelineMode,
} from '@/lib/feed/tagTimeline'

function formatTagInput(tags: string[]): string {
  return tags.map((tag) => `#${tag}`).join(', ')
}

function formatTagChip(tag: string, excluded = false): string {
  return excluded ? `-#${tag}` : `#${tag}`
}

export default function TagFeedsPage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()
  const scopeId = useMemo(() => currentUser?.pubkey ?? 'anon', [currentUser?.pubkey])
  const savedFeeds = useSavedTagFeeds(scopeId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [includeDraft, setIncludeDraft] = useState('')
  const [excludeDraft, setExcludeDraft] = useState('')
  const [modeDraft, setModeDraft] = useState<TagTimelineMode>('any')
  const [formError, setFormError] = useState<string | null>(null)

  const previewSpec = useMemo(() => {
    const includeTags = normalizeTagTimelineTags(includeDraft)
    if (includeTags.length === 0) return null

    const excludeTags = normalizeTagTimelineTags(excludeDraft).filter(
      (tag) => !includeTags.includes(tag),
    )

    return {
      includeTags,
      excludeTags,
      mode: includeTags.length > 1 && modeDraft === 'all' ? 'all' : 'any',
    } satisfies {
      includeTags: string[]
      excludeTags: string[]
      mode: TagTimelineMode
    }
  }, [excludeDraft, includeDraft, modeDraft])

  const previewDescription = useMemo(
    () => describeTagTimeline(previewSpec),
    [previewSpec],
  )

  function resetForm(): void {
    setEditingId(null)
    setTitleDraft('')
    setIncludeDraft('')
    setExcludeDraft('')
    setModeDraft('any')
    setFormError(null)
  }

  function handleEdit(feed: SavedTagFeed): void {
    setEditingId(feed.id)
    setTitleDraft(feed.title)
    setIncludeDraft(formatTagInput(feed.includeTags))
    setExcludeDraft(formatTagInput(feed.excludeTags))
    setModeDraft(feed.mode)
    setFormError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleDelete(feed: SavedTagFeed): void {
    if (!window.confirm(`Delete "${feed.title}"?`)) return
    deleteTagFeed(feed.id, scopeId)

    if (editingId === feed.id) {
      resetForm()
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    const includeTags = normalizeTagTimelineTags(includeDraft)
    if (includeTags.length === 0) {
      setFormError('Add at least one hashtag to include.')
      return
    }

    const saved = saveTagFeed({
      id: editingId ?? undefined,
      title: titleDraft,
      includeTags,
      excludeTags: normalizeTagTimelineTags(excludeDraft).filter((tag) => !includeTags.includes(tag)),
      mode: includeTags.length > 1 && modeDraft === 'all' ? 'all' : 'any',
    }, scopeId)

    if (!saved) {
      setFormError('Unable to save this tag feed. Check the hashtags and try again.')
      return
    }

    resetForm()
  }

  useEffect(() => {
    if (!editingId) return
    if (savedFeeds.some((feed) => feed.id === editingId)) return
    resetForm()
  }, [editingId, savedFeeds])

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="
              app-panel-muted
              h-10 w-10 rounded-full
              text-[rgb(var(--color-label))]
              flex items-center justify-center
              active:opacity-80
            "
            aria-label="Go back"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M9.5 3.25L4.75 8l4.75 4.75"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-tertiary))]">
              Settings / Feed
            </p>
            <h1 className="text-[20px] font-semibold text-[rgb(var(--color-label))]">
              Tag Feeds
            </h1>
          </div>
        </div>
      </div>

      <div className="space-y-8 pb-10 pt-2">
        <section>
          <h2 className="section-kicker px-1 mb-3">Create</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              Saved tag feeds show up in the main Feed rail beside sections like Articles and Bitcoin. They follow this browser across sign-in state, and they still use exact hashtags, plain text, semantic matching, and moderation.
            </p>

            <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label className="mb-2 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]" htmlFor="tag-feed-title">
                  Feed Name
                </label>
                <input
                  id="tag-feed-title"
                  type="text"
                  value={titleDraft}
                  onChange={(event) => {
                    setTitleDraft(event.target.value)
                    if (formError) setFormError(null)
                  }}
                  placeholder="Apple"
                  className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                />
              </div>

              <div>
                <label className="mb-2 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]" htmlFor="tag-feed-include">
                  Include Hashtags
                </label>
                <input
                  id="tag-feed-include"
                  type="text"
                  value={includeDraft}
                  onChange={(event) => {
                    setIncludeDraft(event.target.value)
                    if (formError) setFormError(null)
                  }}
                  placeholder="#apple, #iphone, #macbook"
                  className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                />
              </div>

              <div>
                <label className="mb-2 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]" htmlFor="tag-feed-exclude">
                  Exclude Hashtags
                </label>
                <input
                  id="tag-feed-exclude"
                  type="text"
                  value={excludeDraft}
                  onChange={(event) => {
                    setExcludeDraft(event.target.value)
                    if (formError) setFormError(null)
                  }}
                  placeholder="#giveaway, #spam"
                  className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                />
              </div>

              <div>
                <span className="mb-2 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
                  Match Logic
                </span>
                <div className="flex flex-wrap gap-2">
                  {(['any', 'all'] as const).map((mode) => {
                    const includeCount = previewSpec?.includeTags.length ?? 0
                    const disabled = mode === 'all' && includeCount < 2
                    const selected = modeDraft === mode

                    return (
                      <button
                        key={mode}
                        type="button"
                        disabled={disabled}
                        onClick={() => setModeDraft(mode)}
                        className={`
                          rounded-full px-4 py-2 text-[13px] font-medium transition-colors
                          ${selected
                            ? 'bg-[rgb(var(--color-label))] text-[rgb(var(--color-bg))]'
                            : 'bg-[rgb(var(--color-fill)/0.08)] text-[rgb(var(--color-label-secondary))]'}
                          ${disabled ? 'cursor-not-allowed opacity-60' : ''}
                        `}
                      >
                        {mode === 'any' ? 'Any tag' : 'All tags'}
                      </button>
                    )
                  })}
                </div>
              </div>

              {previewDescription && (
                <div className="rounded-[16px] bg-[rgb(var(--color-bg-secondary))] p-3">
                  <p className="text-[13px] font-medium text-[rgb(var(--color-label))]">
                    Feed preview
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                    {previewDescription.summary}
                  </p>
                </div>
              )}

              {formError && (
                <p className="text-[13px] text-[rgb(var(--color-system-red))]">
                  {formError}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="rounded-[14px] bg-[rgb(var(--color-label))] px-4 py-3 text-[15px] font-medium text-[rgb(var(--color-bg))] transition-opacity active:opacity-80"
                >
                  {editingId ? 'Save Changes' : 'Create Tag Feed'}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-[14px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] font-medium text-[rgb(var(--color-label))] transition-opacity active:opacity-80"
                >
                  {editingId ? 'Cancel Editing' : 'Clear'}
                </button>
              </div>
            </form>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">Saved</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            {savedFeeds.length === 0 ? (
              <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                No saved tag feeds yet. Create one above and it will appear in the main Feed rail.
              </p>
            ) : (
              <div className="space-y-3">
                {savedFeeds.map((feed) => {
                  const details = describeTagTimeline(feed)

                  return (
                    <div
                      key={feed.id}
                      className="rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-medium text-[rgb(var(--color-label))]">
                            {feed.title}
                          </p>
                          <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                            {details?.summary ?? 'Saved tag feed'}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
                          {feed.mode === 'all' ? 'All tags' : 'Any tag'}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {feed.includeTags.map((tag) => (
                          <span
                            key={`${feed.id}:include:${tag}`}
                            className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]"
                          >
                            {formatTagChip(tag)}
                          </span>
                        ))}
                        {feed.excludeTags.map((tag) => (
                          <span
                            key={`${feed.id}:exclude:${tag}`}
                            className="rounded-full bg-[rgb(var(--color-accent)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]"
                          >
                            {formatTagChip(tag, true)}
                          </span>
                        ))}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(buildTagTimelineHref(feed))}
                          className="rounded-full bg-[rgb(var(--color-label))] px-3 py-2 text-[12px] font-medium text-[rgb(var(--color-bg))] transition-opacity active:opacity-80"
                        >
                          Open Feed
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEdit(feed)}
                          className="rounded-full border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2 text-[12px] font-medium text-[rgb(var(--color-label))] transition-opacity active:opacity-80"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(feed)}
                          className="rounded-full border border-[rgb(var(--color-system-red)/0.2)] bg-[rgb(var(--color-system-red)/0.08)] px-3 py-2 text-[12px] font-medium text-[rgb(var(--color-system-red))] transition-opacity active:opacity-80"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
