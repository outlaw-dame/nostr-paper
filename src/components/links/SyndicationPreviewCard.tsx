import React from 'react'
import { TwemojiText } from '@/components/ui/TwemojiText'
import type { SyndicationFeed } from '@/lib/syndication/types'

interface SyndicationPreviewCardProps {
  feed: SyndicationFeed
  sourceUrl?: string
  className?: string
}

function stopPropagation(event: React.MouseEvent<HTMLElement>) {
  event.stopPropagation()
}

function getHost(value: string | undefined): string | null {
  if (!value) return null

  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function formatFeedFormat(format: SyndicationFeed['format']): string {
  switch (format) {
    case 'json':
      return 'JSON Feed'
    case 'rss':
      return 'RSS'
    case 'atom':
      return 'Atom'
    case 'rdf':
      return 'RDF'
    default:
      return 'Feed'
  }
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null

  try {
    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return null
  }
}

function getPrimaryImage(feed: SyndicationFeed): string | undefined {
  return feed.items.find((item) => item.image)?.image ?? feed.icon ?? feed.favicon
}

function getPrimaryUrl(feed: SyndicationFeed, sourceUrl?: string): string {
  return feed.homePageUrl ?? feed.feedUrl ?? sourceUrl ?? feed.sourceUrl ?? '#'
}

export function SyndicationPreviewCard({
  feed,
  sourceUrl,
  className = '',
}: SyndicationPreviewCardProps) {
  const destination = getPrimaryUrl(feed, sourceUrl)
  const image = getPrimaryImage(feed)
  const subtitleHost = getHost(feed.homePageUrl) ?? getHost(feed.feedUrl) ?? getHost(feed.sourceUrl)
  const leadAuthor = feed.authors[0] ?? feed.items.find((item) => item.authors[0])?.authors[0] ?? null
  const previewItems = feed.items.slice(0, 3)

  return (
    <a
      href={destination}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={stopPropagation}
      className={`
        mt-3 block overflow-hidden rounded-ios-xl
        border border-[rgb(var(--color-fill)/0.10)]
        bg-[rgb(var(--color-bg-secondary))]
        transition-opacity active:opacity-70
        ${className}
      `}
    >
      {image && (
        <div className="aspect-[1.91/1] w-full overflow-hidden bg-[rgb(var(--color-fill)/0.06)]">
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <div className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[rgb(var(--color-tint)/0.10)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-tint))]">
            {formatFeedFormat(feed.format)}
          </span>
          {subtitleHost && (
            <span className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
              {subtitleHost}
            </span>
          )}
          <span className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
            {feed.items.length} {feed.items.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-[18px] font-semibold leading-tight text-[rgb(var(--color-label))]">
            <TwemojiText text={feed.title} />
          </h3>
          {feed.description && (
            <p className="line-clamp-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              <TwemojiText text={feed.description} />
            </p>
          )}
          {leadAuthor && (
            <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
              By <TwemojiText text={leadAuthor} />
            </p>
          )}
        </div>

        {previewItems.length > 0 && (
          <div className="space-y-2 border-t border-[rgb(var(--color-fill)/0.08)] pt-3">
            {previewItems.map((item) => {
              const itemMeta = [item.authors[0], formatDate(item.publishedAt)].filter(Boolean).join(' · ')
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-[18px] bg-[rgb(var(--color-fill)/0.04)] px-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[14px] font-medium leading-6 text-[rgb(var(--color-label))]">
                      <TwemojiText text={item.title ?? item.summary ?? item.url ?? 'Untitled entry'} />
                    </p>
                    {itemMeta && (
                      <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))]">
                        <TwemojiText text={itemMeta} />
                      </p>
                    )}
                  </div>
                  {item.image && (
                    <img
                      src={item.image}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="h-14 w-14 shrink-0 rounded-[14px] object-cover"
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </a>
  )
}
