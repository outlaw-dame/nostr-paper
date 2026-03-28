import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'
import { useVisibilityOnce } from '@/hooks/useVisibilityOnce'
import { buildComposeSearch } from '@/lib/compose'
import { getEventEngagementSummary } from '@/lib/db/nostr'
import { canBookmarkEvent, toggleGlobalBookmark } from '@/lib/nostr/lists'
import { buildEventReferenceValue } from '@/lib/nostr/nip21'
import { publishReaction } from '@/lib/nostr/reaction'
import { publishRepost } from '@/lib/nostr/repost'
import { getMetricsVisible, ZEN_SETTINGS_UPDATED_EVENT } from '@/lib/ui/zenSettings'
import type { EventEngagementSummary, NostrEvent } from '@/types'

const EMPTY_SUMMARY: EventEngagementSummary = {
  replyCount: 0,
  repostCount: 0,
  reactionCount: 0,
  likeCount: 0,
  dislikeCount: 0,
  emojiReactions: [],
  zapCount: 0,
  zapTotalMsats: 0,
  currentUserHasReposted: false,
  currentUserHasLiked: false,
  currentUserHasDisliked: false,
}

const MAX_SUMMARY_CACHE = 500
const summaryCache = new Map<string, EventEngagementSummary>()
const pendingSummaryCache = new Map<string, Promise<EventEngagementSummary>>()

function getSummaryCacheKey(eventId: string, currentUserPubkey?: string): string {
  return `${currentUserPubkey ?? 'anon'}:${eventId}`
}

function setCachedSummary(key: string, value: EventEngagementSummary): void {
  summaryCache.set(key, value)
  if (summaryCache.size <= MAX_SUMMARY_CACHE) return
  const oldestKey = summaryCache.keys().next().value
  if (oldestKey !== undefined) {
    summaryCache.delete(oldestKey)
  }
}

async function loadEngagementSummary(eventId: string, currentUserPubkey?: string): Promise<EventEngagementSummary> {
  const key = getSummaryCacheKey(eventId, currentUserPubkey)
  const cached = summaryCache.get(key)
  if (cached) return cached

  const pending = pendingSummaryCache.get(key)
  if (pending) return pending

  const request = getEventEngagementSummary(eventId, currentUserPubkey)
    .then((summary) => {
      setCachedSummary(key, summary)
      pendingSummaryCache.delete(key)
      return summary
    })
    .catch((error) => {
      pendingSummaryCache.delete(key)
      throw error
    })

  pendingSummaryCache.set(key, request)
  return request
}

interface EventMetricsRowProps {
  event: NostrEvent
  className?: string
  tone?: 'default' | 'inverse'
  interactive?: boolean
}

export function EventMetricsRow({ event, className = '', tone = 'default', interactive = false }: EventMetricsRowProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useApp()
  const [summary, setSummary] = useState<EventEngagementSummary>(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [visible, setVisible] = useState(true)
  const [publishing, setPublishing] = useState<'like' | 'repost' | 'bookmark' | null>(null)
  const scopeId = useMemo(() => currentUser?.pubkey ?? 'anon', [currentUser?.pubkey])
  const summaryKey = useMemo(() => getSummaryCacheKey(event.id, currentUser?.pubkey), [currentUser?.pubkey, event.id])
  const { ref, visible: metricsInView } = useVisibilityOnce<HTMLDivElement>({ disabled: !visible, rootMargin: '220px 0px' })

  useEffect(() => {
    setVisible(getMetricsVisible(scopeId))

    const onUpdated = (rawEvent: Event) => {
      const customEvent = rawEvent as CustomEvent<{ scopeId?: string }>
      if ((customEvent.detail?.scopeId ?? 'anon') !== scopeId) return
      setVisible(getMetricsVisible(scopeId))
    }

    const onStorage = (storageEvent: StorageEvent) => {
      if (!storageEvent.key) return
      if (!storageEvent.key.endsWith(`:${scopeId}`)) return
      setVisible(getMetricsVisible(scopeId))
    }

    window.addEventListener(ZEN_SETTINGS_UPDATED_EVENT, onUpdated as EventListener)
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(ZEN_SETTINGS_UPDATED_EVENT, onUpdated as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [scopeId])

  useEffect(() => {
    if (!visible) {
      setLoading(false)
      return
    }

    const cached = summaryCache.get(summaryKey)
    if (cached) {
      setSummary(cached)
      setLoading(false)
      return
    }

    if (!metricsInView) {
      setLoading(true)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    loadEngagementSummary(event.id, currentUser?.pubkey)
      .then((nextSummary) => {
        if (!controller.signal.aborted) {
          setSummary(nextSummary)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSummary(EMPTY_SUMMARY)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [currentUser?.pubkey, event.id, metricsInView, summaryKey, visible])

  const refreshSummary = async () => {
    const key = getSummaryCacheKey(event.id, currentUser?.pubkey)
    summaryCache.delete(key)
    const next = await getEventEngagementSummary(event.id, currentUser?.pubkey)
    setCachedSummary(key, next)
    setSummary(next)
  }

  const handleReply = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!currentUser) { navigate('/onboard'); return }
    const ref = buildEventReferenceValue(event)
    if (!ref) return
    navigate({ pathname: location.pathname, search: buildComposeSearch(location.search, { quoteReference: null, replyReference: ref }) })
  }

  const handleRepost = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!currentUser) { navigate('/onboard'); return }
    if (summary.currentUserHasReposted || publishing !== null) return
    setPublishing('repost')
    try {
      await publishRepost(event)
      await refreshSummary()
    } catch { /* silent */ } finally { setPublishing(null) }
  }

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!currentUser) { navigate('/onboard'); return }
    if (summary.currentUserHasLiked || publishing !== null) return
    setPublishing('like')
    try {
      await publishReaction(event, '+')
      await refreshSummary()
    } catch { /* silent */ } finally { setPublishing(null) }
  }

  const handleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!currentUser) { navigate('/onboard'); return }
    if (publishing !== null) return
    setPublishing('bookmark')
    try {
      await toggleGlobalBookmark(event)
      await refreshSummary()
    } catch { /* silent */ } finally { setPublishing(null) }
  }

  if (!visible) return null

  const labelClass = tone === 'inverse'
    ? 'text-white/82'
    : 'text-[rgb(var(--color-label-tertiary))]'
  const activeClass = tone === 'inverse'
    ? 'text-white'
    : 'text-[rgb(var(--color-label-secondary))]'
  const bookmarkable = canBookmarkEvent(event)

  return (
    <div ref={ref} className={`mt-3 flex flex-wrap items-center gap-3 text-[12px] ${labelClass} ${className}`}>
      {loading ? (
        <MetricsLoadingSkeleton tone={tone} />
      ) : (
        <>
          <MetricItem
            icon={<ReplyIcon />}
            value={summary.replyCount}
            className={activeClass}
            label="Replies"
            {...(interactive ? { onClick: handleReply } : {})}
          />
          <MetricItem
            icon={<RepostIcon />}
            value={summary.repostCount}
            className={summary.currentUserHasReposted ? activeClass : (interactive ? activeClass : activeClass)}
            label={publishing === 'repost' ? 'Reposting…' : 'Reposts'}
            {...(interactive && !summary.currentUserHasReposted
              ? { onClick: (event: React.MouseEvent) => { void handleRepost(event) } }
              : {})}
            disabled={interactive && (summary.currentUserHasReposted || publishing !== null)}
          />
          <MetricItem
            icon={<HeartIcon filled={summary.currentUserHasLiked} />}
            value={summary.likeCount}
            className={summary.currentUserHasLiked ? activeClass : labelClass}
            label={publishing === 'like' ? 'Liking…' : 'Likes'}
            {...(interactive && !summary.currentUserHasLiked
              ? { onClick: (event: React.MouseEvent) => { void handleLike(event) } }
              : {})}
            disabled={interactive && (summary.currentUserHasLiked || publishing !== null)}
          />
          {bookmarkable ? (
            <MetricItem
              icon={<BookmarkIcon />}
              value={undefined}
              className={labelClass}
              label="Bookmark"
              {...(interactive ? { onClick: (event: React.MouseEvent) => { void handleBookmark(event) } } : {})}
              disabled={interactive && publishing !== null}
            />
          ) : (
            <span className={`inline-flex items-center ${labelClass}`} aria-label="Bookmark">
              <BookmarkIcon />
            </span>
          )}
        </>
      )}
    </div>
  )
}

function MetricsLoadingSkeleton({ tone }: { tone: 'default' | 'inverse' }) {
  const fillClass = tone === 'inverse'
    ? 'bg-white/22'
    : 'bg-[rgb(var(--color-fill)/0.2)]'

  return (
    <div className="flex items-center gap-3 animate-pulse" aria-hidden>
      <span className={`inline-block h-3 w-10 rounded-full ${fillClass}`} />
      <span className={`inline-block h-3 w-10 rounded-full ${fillClass}`} />
      <span className={`inline-block h-3 w-10 rounded-full ${fillClass}`} />
      <span className={`inline-block h-3 w-3 rounded ${fillClass}`} />
    </div>
  )
}

function MetricItem({
  icon,
  value,
  className,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  value: number | undefined
  className: string
  label: string
  onClick?: (e: React.MouseEvent) => void
  disabled?: boolean
}) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex items-center gap-1 ${className} transition-opacity active:opacity-60 disabled:opacity-40 cursor-pointer`}
        aria-label={value !== undefined ? `${label}: ${value}` : label}
      >
        {icon}
        {value !== undefined && <span className="font-medium tabular-nums">{value}</span>}
      </button>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-label={value !== undefined ? `${label}: ${value}` : label}>
      {icon}
      {value !== undefined && <span className="font-medium tabular-nums">{value}</span>}
    </span>
  )
}

function ReplyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 17l-5-5 5-5" />
      <path d="M20 18v-1a5 5 0 0 0-5-5H4" />
    </svg>
  )
}

function RepostIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

function HeartIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}
