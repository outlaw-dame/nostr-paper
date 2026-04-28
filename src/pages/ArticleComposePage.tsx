import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'
import {
  getArticleRoute,
  getDraftRoute,
  parseLongFormEvent,
  publishLongForm,
} from '@/lib/nostr/longForm'
import { isSafeMediaURL } from '@/lib/security/sanitize'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
}

function parseHashtagsInput(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((h) => h.replace(/^#+/, '').trim().toLowerCase())
    .filter((h) => h.length > 0 && /^[a-z0-9_-]+$/i.test(h))
}

export default function ArticleComposePage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()

  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [image, setImage] = useState('')
  const [hashtagsInput, setHashtagsInput] = useState('')
  const [content, setContent] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [identifierTouched, setIdentifierTouched] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-slug identifier from title until the user manually edits it
  useEffect(() => {
    if (identifierTouched) return
    setIdentifier(slugify(title) || '')
  }, [identifierTouched, title])

  const imageWarning =
    image.trim().length > 0 && !isSafeMediaURL(image.trim())
      ? 'Cover image must be an https:// URL pointing to an image file.'
      : null

  async function handlePublish(isDraft: boolean) {
    if (publishing || savingDraft) return
    if (!currentUser) {
      setError('No signer available — install and unlock a NIP-07 extension to publish.')
      return
    }
    if (!identifier.trim()) {
      setError('An identifier (d tag) is required. Give your article a title to auto-generate one.')
      return
    }
    if (!content.trim()) {
      setError('Article content must not be empty.')
      return
    }

    if (isDraft) {
      setSavingDraft(true)
    } else {
      setPublishing(true)
    }
    setError(null)

    try {
      const published = await publishLongForm({
        identifier: identifier.trim(),
        content: content.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(image.trim() && isSafeMediaURL(image.trim()) ? { image: image.trim() } : {}),
        hashtags: parseHashtagsInput(hashtagsInput),
        isDraft,
      })

      const article = parseLongFormEvent(published)
      const route = article
        ? (isDraft ? getDraftRoute(published.pubkey, article.identifier) : getArticleRoute(published.pubkey, article.identifier))
        : `/${isDraft ? 'draft' : 'article'}/${published.pubkey}/${encodeURIComponent(identifier.trim())}`

      navigate(route, { replace: true })
    } catch (publishError: unknown) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : isDraft
            ? 'Failed to save draft.'
            : 'Failed to publish article.',
      )
      if (isDraft) {
        setSavingDraft(false)
      } else {
        setPublishing(false)
      }
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
            Write Article
          </h1>
          <p className="text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
            Publish a NIP-23 long-form article (kind 30023) or save as a private draft (kind 30024). Markdown is supported.
          </p>
        </header>

        {/* Metadata */}
        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Title
            </span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Your article title"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Identifier (d tag)
            </span>
            <input
              type="text"
              value={identifier}
              onChange={(event) => {
                setIdentifierTouched(true)
                setIdentifier(event.target.value)
              }}
              placeholder="auto-generated-from-title"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 font-mono text-[14px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
            <p className="text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
              Used as the addressable key. Edit this only if you want a custom slug.
            </p>
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Summary
            </span>
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={3}
              placeholder="Short excerpt shown in previews"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Cover Image URL
            </span>
            <input
              type="url"
              value={image}
              onChange={(event) => setImage(event.target.value)}
              placeholder="https://example.com/cover.jpg"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
            {imageWarning && (
              <p className="text-[12px] text-[rgb(var(--color-system-orange))]">{imageWarning}</p>
            )}
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Hashtags
            </span>
            <input
              type="text"
              value={hashtagsInput}
              onChange={(event) => setHashtagsInput(event.target.value)}
              placeholder="nostr bitcoin technology (space or comma-separated)"
              className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
            />
          </label>
        </section>

        {/* Content */}
        <section className="space-y-4 rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
          <div>
            <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Content (Markdown)
            </span>
          </div>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={20}
            placeholder="Write your article in Markdown…"
            spellCheck
            className="w-full rounded-[16px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-3 font-mono text-[14px] leading-7 text-[rgb(var(--color-label))] outline-none focus:border-[#007AFF]"
          />
          <p className="text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
            Markdown headings, bold, italic, inline code, code blocks, and links are rendered by the article viewer.
          </p>
        </section>

        {error && (
          <p className="text-[14px] text-[rgb(var(--color-system-red))]">{error}</p>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void handlePublish(false)}
            disabled={publishing || savingDraft || !!imageWarning}
            className="w-full rounded-[18px] bg-[rgb(var(--color-label))] px-5 py-4 text-[15px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
          >
            {publishing ? 'Publishing…' : 'Publish Article'}
          </button>

          <button
            type="button"
            onClick={() => void handlePublish(true)}
            disabled={publishing || savingDraft || !!imageWarning}
            className="w-full rounded-[18px] border border-[rgb(var(--color-fill)/0.22)] bg-[rgb(var(--color-bg-secondary))] px-5 py-4 text-[15px] font-medium text-[rgb(var(--color-label))] transition-opacity active:opacity-80 disabled:opacity-40"
          >
            {savingDraft ? 'Saving Draft…' : 'Save as Draft'}
          </button>
        </div>
      </div>
    </div>
  )
}
