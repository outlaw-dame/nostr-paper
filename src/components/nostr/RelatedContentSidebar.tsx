import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { queryEvents } from '@/lib/db/nostr'
import { parseLongFormEvent } from '@/lib/nostr/longForm'
import { parseVideoEvent } from '@/lib/nostr/video'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

interface RelatedContentSidebarProps {
  event: NostrEvent
  className?: string
  showPerspectives?: boolean
}

function collectHashtags(event: NostrEvent): Set<string> {
  const hashtags = new Set<string>()
  for (const tag of event.tags) {
    if (tag[0] !== 't') continue
    const value = tag[1]?.trim().toLowerCase()
    if (value) hashtags.add(value)
  }
  return hashtags
}

function rankByTagOverlap(source: NostrEvent, candidates: NostrEvent[], limit: number): NostrEvent[] {
  const sourceTags = collectHashtags(source)

  return candidates
    .map((candidate) => {
      const candidateTags = collectHashtags(candidate)
      let overlap = 0
      for (const tag of candidateTags) {
        if (sourceTags.has(tag)) overlap += 1
      }
      return { candidate, overlap }
    })
    .sort((a, b) => {
      if (b.overlap !== a.overlap) return b.overlap - a.overlap
      return b.candidate.created_at - a.candidate.created_at
    })
    .slice(0, limit)
    .map((entry) => entry.candidate)
}

export function RelatedContentSidebar({ event, className = '', showPerspectives = true }: RelatedContentSidebarProps) {
  const [relatedReads, setRelatedReads] = useState<NostrEvent[]>([])
  const [relatedVideos, setRelatedVideos] = useState<NostrEvent[]>([])
  const [perspectives, setPerspectives] = useState<Array<{ topic: string; event: NostrEvent }>>([])
  const [perspectivesExpanded, setPerspectivesExpanded] = useState(true)

  const article = useMemo(() => parseLongFormEvent(event), [event])
  const video = useMemo(() => parseVideoEvent(event), [event])

  useEffect(() => {
    let cancelled = false

    queryEvents({
      kinds: [Kind.LongFormContent, Kind.AddressableVideo, Kind.AddressableShortVideo],
      limit: 80,
    })
      .then((events) => {
        if (cancelled) return

        const articles = events.filter((entry) => entry.id !== event.id && parseLongFormEvent(entry))
        const videos = events.filter((entry) => entry.id !== event.id && parseVideoEvent(entry))
        const sourceTags = collectHashtags(event)
        const perspectiveCandidates = events
          .filter((entry) => entry.id !== event.id && entry.pubkey !== event.pubkey)
          .map((entry) => {
            const tags = collectHashtags(entry)
            const shared = [...tags].find((tag) => sourceTags.has(tag))
            return shared ? { topic: shared, event: entry } : null
          })
          .filter((entry): entry is { topic: string; event: NostrEvent } => entry !== null)
          .sort((a, b) => b.event.created_at - a.event.created_at)

        const seenTopics = new Set<string>()
        const limitedPerspectives: Array<{ topic: string; event: NostrEvent }> = []
        for (const candidate of perspectiveCandidates) {
          if (seenTopics.has(candidate.topic)) continue
          limitedPerspectives.push(candidate)
          seenTopics.add(candidate.topic)
          if (limitedPerspectives.length >= 3) break
        }

        setRelatedReads(rankByTagOverlap(event, articles, 4))
        setRelatedVideos(rankByTagOverlap(event, videos, 4))
        setPerspectives(limitedPerspectives)
      })
      .catch(() => {
        if (cancelled) return
        setRelatedReads([])
        setRelatedVideos([])
        setPerspectives([])
      })

    return () => {
      cancelled = true
    }
  }, [event])

  if (!article && !video) return null
  const visiblePerspectives = showPerspectives && perspectivesExpanded ? perspectives : []
  if (relatedReads.length === 0 && relatedVideos.length === 0 && visiblePerspectives.length === 0) return null

  return (
    <aside className={`space-y-3 rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-4 ${className}`}>
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        Keep Reading
      </h2>

      {relatedReads.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Related reads</h3>
          <div className="space-y-2">
            {relatedReads.map((entry) => {
              const parsed = parseLongFormEvent(entry)
              if (!parsed) return null
              return (
                <Link
                  key={entry.id}
                  to={parsed.route}
                  className="block rounded-[12px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] px-3 py-2 transition-colors hover:bg-[rgb(var(--color-fill)/0.08)]"
                >
                  <p className="text-[13px] font-medium leading-5 text-[rgb(var(--color-label))] line-clamp-2">{parsed.title || 'Untitled article'}</p>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {relatedVideos.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Related videos</h3>
          <div className="space-y-2">
            {relatedVideos.map((entry) => {
              const parsed = parseVideoEvent(entry)
              if (!parsed) return null
              return (
                <Link
                  key={entry.id}
                  to={parsed.route}
                  className="block rounded-[12px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] px-3 py-2 transition-colors hover:bg-[rgb(var(--color-fill)/0.08)]"
                >
                  <p className="text-[13px] font-medium leading-5 text-[rgb(var(--color-label))] line-clamp-2">{parsed.title}</p>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {showPerspectives && perspectives.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Different angles</h3>
            <button
              type="button"
              onClick={() => setPerspectivesExpanded((value) => !value)}
              className="rounded-full border border-[rgb(var(--color-fill)/0.14)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]"
            >
              {perspectivesExpanded ? 'Hide' : 'Show'}
            </button>
          </div>
          {visiblePerspectives.length > 0 && (
            <div className="space-y-2">
              {visiblePerspectives.map(({ topic, event: entry }) => {
                const articleEntry = parseLongFormEvent(entry)
                const videoEntry = parseVideoEvent(entry)
                const route = articleEntry?.route ?? videoEntry?.route ?? `/note/${entry.id}`
                const title = articleEntry?.title ?? videoEntry?.title ?? 'Perspective note'
                return (
                  <Link
                    key={`perspective:${entry.id}`}
                    to={route}
                    className="block rounded-[12px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] px-3 py-2 transition-colors hover:bg-[rgb(var(--color-fill)/0.08)]"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">#{topic}</p>
                    <p className="mt-1 text-[13px] font-medium leading-5 text-[rgb(var(--color-label))] line-clamp-2">{title}</p>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      )}
    </aside>
  )
}