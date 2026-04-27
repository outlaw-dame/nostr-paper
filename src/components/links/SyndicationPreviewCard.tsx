import React, { useState } from 'react'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { useSyndicationFeedModeration } from '@/hooks/useModeration'
import {
  formatDurationSeconds,
  formatSyndicationContentKind,
  getAudioAttachment,
  getSyndicationEntryKind,
  getSyndicationFeedDominantKind,
  getVideoAttachment,
} from '@/lib/syndication/contentKind'
import type { SyndicationEntry, SyndicationFeed } from '@/lib/syndication/types'

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

// ---------------------------------------------------------------------------
// Content-type-aware item row components
// ---------------------------------------------------------------------------

function PodcastEntryRow({ item, feedArtwork }: { item: SyndicationEntry; feedArtwork?: string }) {
  const audio = getAudioAttachment(item)
  const duration = audio?.durationSeconds
  const artwork = item.podcast?.image ?? item.image ?? feedArtwork
  const ep = item.podcast?.episode
  const season = item.podcast?.season
  const explicit = item.podcast?.explicit
  const meta = [
    item.authors[0],
    duration !== undefined ? formatDurationSeconds(duration) : null,
    explicit ? 'Explicit' : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex items-center gap-3 rounded-[18px] bg-[rgb(var(--color-fill)/0.04)] px-3 py-3">
      {artwork ? (
        <img
          src={artwork}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-12 w-12 shrink-0 rounded-[10px] object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-[rgb(var(--color-system-orange,255_149_0)/0.12)]">
          {/* Microphone icon */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="9" y="2" width="6" height="12" rx="3" fill="rgb(var(--color-system-orange,255_149_0))" />
            <path
              d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6"
              stroke="rgb(var(--color-system-orange,255_149_0))"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {ep !== undefined && (
            <span className="rounded-full bg-[rgb(var(--color-system-orange,255_149_0)/0.12)] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--color-system-orange,255_149_0))]">
              {season !== undefined ? `S${season} E${ep}` : `Ep. ${ep}`}
            </span>
          )}
          {explicit && !ep && (
            <span className="rounded-full bg-[rgb(var(--color-label-tertiary)/0.12)] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--color-label-tertiary))]">
              E
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-[14px] font-medium leading-[1.35] text-[rgb(var(--color-label))]">
          <TwemojiText text={item.title ?? item.summary ?? 'Untitled episode'} />
        </p>
        {meta && (
          <p className="mt-0.5 text-[11px] text-[rgb(var(--color-label-tertiary))]">
            <TwemojiText text={meta} />
          </p>
        )}
      </div>
    </div>
  )
}

function VideoEntryRow({ item }: { item: SyndicationEntry }) {
  const videoAtt = getVideoAttachment(item)
  const duration = videoAtt?.durationSeconds
  const thumbnail = item.image
  const meta = [item.authors[0], formatDate(item.publishedAt)].filter(Boolean).join(' · ')

  return (
    <div className="flex items-start gap-3 rounded-[18px] bg-[rgb(var(--color-fill)/0.04)] px-3 py-3">
      <div className="relative h-14 w-[88px] shrink-0 overflow-hidden rounded-[10px] bg-[rgb(var(--color-fill)/0.1)]">
        {thumbnail && (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        )}
        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/40 p-[5px]">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="white" aria-hidden="true">
              <path d="M2.5 1.5l8 4.5-8 4.5V1.5z" />
            </svg>
          </div>
        </div>
        {duration !== undefined && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px text-[9px] font-medium leading-tight text-white">
            {formatDurationSeconds(duration)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[14px] font-medium leading-[1.35] text-[rgb(var(--color-label))]">
          <TwemojiText text={item.title ?? item.summary ?? 'Untitled video'} />
        </p>
        {meta && (
          <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))]">
            <TwemojiText text={meta} />
          </p>
        )}
      </div>
    </div>
  )
}

function AudioEntryRow({ item }: { item: SyndicationEntry }) {
  const audio = getAudioAttachment(item)
  const duration = audio?.durationSeconds
  const meta = [item.authors[0], duration !== undefined ? formatDurationSeconds(duration) : null, formatDate(item.publishedAt)].filter(Boolean).join(' · ')

  return (
    <div className="flex items-center gap-3 rounded-[18px] bg-[rgb(var(--color-fill)/0.04)] px-3 py-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[rgb(var(--color-system-blue,0_122_255)/0.10)]">
        {/* Music note icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9 18V5l12-2v13"
            stroke="rgb(var(--color-system-blue,0_122_255))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="6" cy="18" r="3" stroke="rgb(var(--color-system-blue,0_122_255))" strokeWidth="2" />
          <circle cx="18" cy="16" r="3" stroke="rgb(var(--color-system-blue,0_122_255))" strokeWidth="2" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-[14px] font-medium leading-[1.35] text-[rgb(var(--color-label))]">
          <TwemojiText text={item.title ?? item.summary ?? 'Untitled audio'} />
        </p>
        {meta && (
          <p className="mt-0.5 text-[11px] text-[rgb(var(--color-label-tertiary))]">
            <TwemojiText text={meta} />
          </p>
        )}
      </div>
    </div>
  )
}

function ArticleEntryRow({ item }: { item: SyndicationEntry }) {
  const author = item.authors[0] ?? null
  const date = formatDate(item.publishedAt)
  const summary = item.summary ?? item.contentText?.slice(0, 160)

  return (
    <div className="flex items-start gap-3 rounded-[18px] bg-[rgb(var(--color-fill)/0.04)] px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[14px] font-semibold leading-[1.35] text-[rgb(var(--color-label))]">
          <TwemojiText text={item.title ?? 'Untitled article'} />
        </p>
        {summary && (
          <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
            <TwemojiText text={summary} />
          </p>
        )}
        {author && (
          <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))] leading-snug">
            By <TwemojiText text={author} />
          </p>
        )}
        {date && (
          <p className="mt-0.5 text-[11px] text-[rgb(var(--color-label-tertiary))]">
            <TwemojiText text={date} />
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
          className="h-16 w-16 shrink-0 rounded-[10px] object-cover"
        />
      )}
    </div>
  )
}

function PostEntryRow({ item }: { item: SyndicationEntry }) {
  const meta = [item.authors[0], formatDate(item.publishedAt)].filter(Boolean).join(' · ')

  return (
    <div className="flex items-start gap-3 rounded-[18px] bg-[rgb(var(--color-fill)/0.04)] px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[14px] font-medium leading-6 text-[rgb(var(--color-label))]">
          <TwemojiText text={item.title ?? item.summary ?? item.url ?? 'Untitled entry'} />
        </p>
        {meta && (
          <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))]">
            <TwemojiText text={meta} />
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
}

function SyndicationEntryRow({
  item,
  feed,
}: {
  item: SyndicationEntry
  feed: SyndicationFeed
}) {
  const feedArtwork = feed.icon ?? feed.favicon
  const kind = getSyndicationEntryKind(item, feed)

  switch (kind) {
    case 'podcast':
      return (
        <PodcastEntryRow
          item={item}
          {...(feedArtwork !== undefined ? { feedArtwork } : {})}
        />
      )
    case 'video':
      return <VideoEntryRow item={item} />
    case 'audio':
      return <AudioEntryRow item={item} />
    case 'article':
      return <ArticleEntryRow item={item} />
    default:
      return <PostEntryRow item={item} />
  }
}

export function SyndicationPreviewCard({
  feed,
  sourceUrl,
  className = '',
}: SyndicationPreviewCardProps) {
  const { feedBlocked, filteredItems, loading } = useSyndicationFeedModeration(feed)
  const [override, setOverride] = useState(false)

  const destination = getPrimaryUrl(feed, sourceUrl)
  const image = getPrimaryImage(feed)
  const subtitleHost = getHost(feed.homePageUrl) ?? getHost(feed.feedUrl) ?? getHost(feed.sourceUrl)
  const leadAuthor = feed.authors[0] ?? feed.items.find((item) => item.authors[0])?.authors[0] ?? null
  const previewItems = filteredItems.slice(0, 3)
  const dominantKind = getSyndicationFeedDominantKind(feed)

  if (loading) {
    return (
      <div className={`mt-3 h-36 animate-pulse rounded-ios-xl bg-[rgb(var(--color-fill)/0.06)] ${className}`} />
    )
  }

  if (feedBlocked && !override) {
    return (
      <div className={`mt-3 rounded-ios-xl border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg-secondary))] p-4 text-center ${className}`}>
        <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">Content hidden</p>
        <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">This feed preview was hidden by your content filters.</p>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOverride(true) }}
          className="mt-3 rounded-full bg-[rgb(var(--color-fill)/0.12)] px-4 py-1.5 text-[13px] font-medium text-[rgb(var(--color-label))]"
        >
          Show
        </button>
      </div>
    )
  }

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
          {dominantKind && (
            <span className="rounded-full bg-[rgb(var(--color-tint)/0.10)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-tint))]">
              {formatSyndicationContentKind(dominantKind)}
            </span>
          )}
          <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">
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
            {previewItems.map((item) => (
              <SyndicationEntryRow key={item.id} item={item} feed={feed} />
            ))}
          </div>
        )}
      </div>
    </a>
  )
}
