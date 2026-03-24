import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { SyndicationExportBar } from '@/components/syndication/SyndicationExportBar'
import { ConversationSection } from '@/components/nostr/ConversationSection'
import { EventActionBar } from '@/components/nostr/EventActionBar'
import { QuotePreviewList } from '@/components/nostr/QuotePreviewList'
import { TranslateTextPanel } from '@/components/translation/TranslateTextPanel'
import { MarkdownContent } from '@/components/article/MarkdownContent'
import { useMediaModerationDocument } from '@/hooks/useMediaModeration'
import { buildMediaModerationDocument } from '@/lib/moderation/mediaContent'
import { getArticleNaddr, parseLongFormEvent } from '@/lib/nostr/longForm'
import type { ArticleCrossReference } from '@/lib/nostr/longForm'
import { generateArticleSyndicationDocuments } from '@/lib/syndication/export'
import { markdownToPlainText } from '@/lib/translation/text'
import type { NostrEvent, Profile } from '@/types'

interface ArticleBodyProps {
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

function ArticleTimestamps({
  publishedAt,
  updatedAt,
}: {
  publishedAt?: number | undefined
  updatedAt: number
}) {
  // Three cases per NIP-23 semantics:
  //   1. No published_at → show "Published <created_at>"
  //   2. published_at == created_at → show only "Published <published_at>"
  //   3. published_at != created_at → show "Published <published_at>" + "Updated <created_at>"
  if (!publishedAt) {
    return <span>Published {formatDate(updatedAt)}</span>
  }

  const publishedStr = formatDate(publishedAt)
  if (publishedAt === updatedAt) {
    return <span>Published {publishedStr}</span>
  }

  return (
    <>
      <span>Published {publishedStr}</span>
      <span>Updated {formatDate(updatedAt)}</span>
    </>
  )
}

function CrossReferenceList({ references }: { references: ArticleCrossReference[] }) {
  if (references.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[rgb(var(--color-label-tertiary))]">
        References
      </h2>
      <ul className="space-y-1.5">
        {references.map(ref => (
          <li key={ref.coordinate}>
            <Link
              to={`/a/${ref.naddr}`}
              className="
                inline-flex items-center gap-1.5
                text-[14px] text-[#007AFF] underline decoration-[#007AFF]/30
                underline-offset-2 break-all
              "
            >
              <span className="
                text-[11px] font-mono
                bg-[rgb(var(--color-fill)/0.08)]
                text-[rgb(var(--color-label-tertiary))]
                px-1.5 py-0.5 rounded shrink-0
              ">
                {ref.kind === 30023 ? 'article' : ref.kind === 30024 ? 'draft' : `kind:${ref.kind}`}
              </span>
              <span className="font-mono text-[rgb(var(--color-label-tertiary))] text-[11px]">
                {ref.naddr.slice(0, 32)}…
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ArticleBody({ event, profile, className = '' }: ArticleBodyProps) {
  const article = useMemo(() => parseLongFormEvent(event), [event])
  const articleImageModerationDocument = useMemo(
    () => buildMediaModerationDocument({
      id: `${event.id}:hero-image`,
      kind: 'article_image',
      url: article?.image ?? null,
      updatedAt: event.created_at,
    }),
    [article?.image, event.created_at, event.id],
  )
  const { blocked: articleImageBlocked, loading: articleImageLoading } = useMediaModerationDocument(articleImageModerationDocument)
  if (!article) return null

  const title = article.title ?? 'Untitled Article'
  const translationSourceText = [
    title,
    article.summary ?? '',
    markdownToPlainText(event.content),
  ]
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n\n')

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
          <div className="flex items-center gap-2">
            <h1 className="text-[34px] leading-[1.05] tracking-[-0.04em] font-semibold text-[rgb(var(--color-label))]">
              {title}
            </h1>
            {article.isDraft && (
              <span className="
                self-start mt-2 shrink-0
                rounded-full bg-[rgb(var(--color-fill)/0.12)]
                px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide
                text-[rgb(var(--color-label-secondary))]
              ">
                Draft
              </span>
            )}
          </div>

          {article.summary && (
            <p className="text-[18px] leading-8 text-[rgb(var(--color-label-secondary))]">
              {article.summary}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[rgb(var(--color-label-secondary))]">
            <ArticleTimestamps
              publishedAt={article.publishedAt}
              updatedAt={article.updatedAt}
            />
            <Link
              to={`/a/${article.naddr}`}
              className="font-mono text-[rgb(var(--color-label-tertiary))]"
            >
              nostr:{getArticleNaddr(article.pubkey, article.identifier).slice(0, 24)}…
            </Link>
          </div>
        </div>

        {article.image && !(articleImageModerationDocument && (articleImageLoading || articleImageBlocked)) && (
          <div className="overflow-hidden rounded-ios-2xl bg-[rgb(var(--color-bg-secondary))] card-elevated">
            <img
              src={article.image}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="w-full h-auto object-cover"
            />
          </div>
        )}

        {article.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {article.hashtags.map(tag => (
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
        )}
      </header>

      <SyndicationExportBar onGenerate={() => generateArticleSyndicationDocuments(event, profile)} />

      <MarkdownContent content={event.content} />
      <TranslateTextPanel text={translationSourceText} />

      {article.references.length > 0 && (
        <CrossReferenceList references={article.references} />
      )}

      <QuotePreviewList event={event} />
      <EventActionBar event={event} />
      <ConversationSection event={event} />
    </article>
  )
}
