import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { useApp } from '@/contexts/app-context'
import { useEvent } from '@/hooks/useEvent'
import { useNostrFeed } from '@/hooks/useNostrFeed'
import { useProfile } from '@/hooks/useProfile'
import { useActivitySeen } from '@/hooks/useActivitySeen'
import { buildActivityRecapFallback, getDaySegment, type ActivityRecapSignal } from '@/lib/ai/insights'
import { generateAssistText, type AiAssistProvider, type AiAssistSource } from '@/lib/ai/gemmaAssist'
import { AI_ASSIST_PROVIDER_UPDATED_EVENT, getAiAssistProvider, setAiAssistProvider } from '@/lib/ai/provider'
import { ACTIVITY_KINDS, ACTIVITY_WINDOW_DAYS } from '@/lib/activity/constants'
import { parseReactionEvent } from '@/lib/nostr/reaction'
import { parseRepostEvent } from '@/lib/nostr/repost'
import { parseZapReceipt } from '@/lib/nostr/zap'
import { getAppLocale, tApp } from '@/lib/i18n/app'
import { isValidHex32 } from '@/lib/security/sanitize'
import type { FeedSection, NostrEvent } from '@/types'

type ActivityGroupKind = 'engagement' | 'mention'

interface ActivityGroup {
  id: string
  kind: ActivityGroupKind
  createdAt: number
  actors: string[]
  events: NostrEvent[]
  targetEventId: string | null
  stats: {
    reaction: number
    repost: number
    zap: number
    mention: number
  }
}

export default function ActivityPage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()
  const { seenAt, markAllSeen } = useActivitySeen()

  const section = useMemo<FeedSection | null>(() => {
    if (!currentUser?.pubkey) return null
    return {
      id: 'activity',
      label: tApp('activityLabel'),
      filter: {
        kinds: ACTIVITY_KINDS,
        '#p': [currentUser.pubkey],
        since: Math.floor(Date.now() / 1000) - (ACTIVITY_WINDOW_DAYS * 24 * 60 * 60),
        limit: 240,
      },
    }
  }, [currentUser?.pubkey])

  const { events, loading, error, refresh } = useNostrFeed({
    section: section ?? {
      id: 'activity-disabled',
      label: tApp('activityLabel'),
      filter: { kinds: [], limit: 1 },
    },
    enabled: section !== null,
  })

  const groups = useMemo(() => {
    if (!currentUser?.pubkey) return []
    return buildActivityGroups(events, currentUser.pubkey)
  }, [currentUser?.pubkey, events])
  const unreadGroupCount = useMemo(
    () => groups.filter((group) => group.createdAt > seenAt).length,
    [groups, seenAt],
  )
  const hasUnread = unreadGroupCount > 0
  const [recap, setRecap] = useState('')
  const [recapSource, setRecapSource] = useState<AiAssistSource | 'fallback'>('fallback')
  const [recapLoading, setRecapLoading] = useState(false)
  const [aiAssistProvider, setAiAssistProviderState] = useState<AiAssistProvider>(() => getAiAssistProvider())

  useEffect(() => {
    const onProviderUpdated = () => {
      setAiAssistProviderState(getAiAssistProvider())
    }

    window.addEventListener(AI_ASSIST_PROVIDER_UPDATED_EVENT, onProviderUpdated)
    window.addEventListener('storage', onProviderUpdated)

    return () => {
      window.removeEventListener(AI_ASSIST_PROVIDER_UPDATED_EVENT, onProviderUpdated)
      window.removeEventListener('storage', onProviderUpdated)
    }
  }, [])

  const recapSignals = useMemo<ActivityRecapSignal[]>(() => groups.map((group) => ({
    createdAt: group.createdAt,
    kind: group.kind,
    actors: group.actors.length,
    reactionCount: group.stats.reaction,
    repostCount: group.stats.repost,
    zapCount: group.stats.zap,
    mentionCount: group.stats.mention,
  })), [groups])

  const recapFallback = useMemo(
    () => buildActivityRecapFallback(recapSignals, getDaySegment()),
    [recapSignals],
  )

  useEffect(() => {
    setRecap(recapFallback)
    setRecapSource('fallback')

    if (!currentUser?.pubkey || recapSignals.length === 0) {
      setRecapLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setRecapLoading(true)

      const prompt = [
        'Write 2 to 4 sentences summarising this social media activity.',
        'Mention the dominant engagement type, any notable patterns across threads, and suggest one specific next action.',
        'Plain text only, no markdown, no lists.',
        'Reference actual signal counts — do not give vague generalities.',
        `Time segment: ${getDaySegment()}`,
        `Activity groups: ${recapSignals.length}`,
        `Signals: ${JSON.stringify(recapSignals.slice(0, 18))}`,
      ].join('\n')

      generateAssistText(prompt, {
        signal: controller.signal,
        provider: aiAssistProvider,
        taskType: 'article_summary',
      })
        .then((result) => {
          if (controller.signal.aborted) return
          if (result.text.length > 0) {
            setRecap(result.text)
            setRecapSource(result.source)
          }
          setRecapLoading(false)
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setRecap(recapFallback)
          setRecapSource('fallback')
          setRecapLoading(false)
        })
    }, 550)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [aiAssistProvider, currentUser?.pubkey, recapFallback, recapSignals])

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))]">
      <div className="app-chrome sticky top-0 z-20 px-4 pt-safe pb-3">
        <div className="flex items-center justify-between gap-3 pt-1.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="app-panel-muted h-10 w-10 rounded-full text-[rgb(var(--color-label))] flex items-center justify-center active:opacity-80"
            aria-label={tApp('activityGoBack')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M9.5 3.25L4.75 8l4.75 4.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={markAllSeen}
              disabled={!hasUnread}
              className="app-panel-muted h-10 rounded-full px-3 text-[13px] font-medium text-[rgb(var(--color-label-secondary))] active:opacity-80 disabled:opacity-45"
              aria-label={tApp('activityMarkAllSeenAria')}
            >
              {tApp('activityMarkAllSeen')}
            </button>

            <button
              type="button"
              onClick={refresh}
              className="app-panel-muted h-10 rounded-full px-3 text-[13px] font-medium text-[rgb(var(--color-label-secondary))] active:opacity-80"
              aria-label={tApp('activityRefreshAria')}
            >
              {tApp('activityRefresh')}
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pb-safe pb-8">
        <div className="app-panel mt-3 rounded-ios-xl p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              {getDaySegment() === 'morning' ? 'Morning recap' : getDaySegment() === 'evening' ? 'Evening recap' : 'Night recap'}
            </p>
            <div className="flex items-center gap-2">
              <select
                value={aiAssistProvider}
                onChange={(event) => {
                  const next = event.target.value as AiAssistProvider
                  setAiAssistProvider(next)
                  setAiAssistProviderState(next)
                }}
                className="rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-2 py-1 text-[11px] text-[rgb(var(--color-label-secondary))]"
                aria-label="AI provider"
              >
                <option value="auto">Auto</option>
                <option value="gemma">Gemma</option>
                <option value="gemini">Gemini</option>
              </select>
              <span className="text-[11px] text-[rgb(var(--color-label-tertiary))]">
                {recapLoading ? 'Analyzing…' : recapSource === 'gemma' ? 'Gemma on-device' : recapSource === 'gemini' ? 'Gemini API' : 'Fallback'}
              </span>
            </div>
          </div>
          <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
            {recap}
          </p>
        </div>

        {!currentUser?.pubkey ? (
          <div className="app-panel mt-3 rounded-ios-xl p-5 text-center">
            <p className="text-[15px] text-[rgb(var(--color-label-secondary))]">
              {tApp('activitySignInPrompt')}
            </p>
          </div>
        ) : loading && groups.length === 0 ? (
          <div className="space-y-3 mt-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-28 rounded-ios-xl bg-[rgb(var(--color-fill)/0.08)] animate-pulse" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="app-panel mt-3 rounded-ios-xl p-5 text-center">
            <p className="text-[15px] text-[rgb(var(--color-label-secondary))]">
              {tApp('activityCaughtUpTitle')}
            </p>
            <p className="mt-2 text-[13px] text-[rgb(var(--color-label-tertiary))]">
              {tApp('activityCaughtUpSubtitle')}
            </p>
          </div>
        ) : (
          <div className="space-y-3 mt-3">
            {groups.map((group) => (
              <ActivityGroupCard key={group.id} group={group} />
            ))}
          </div>
        )}

        {error && (
          <p className="mt-4 text-[13px] text-[#C65D2E]">{tApp('activityDegraded', { error })}</p>
        )}
      </div>
    </div>
  )
}

function ActivityGroupCard({ group }: { group: ActivityGroup }) {
  const target = useEvent(group.targetEventId)
  const latestEvent = group.events[0]

  return (
    <article className="app-panel rounded-ios-xl p-4 card-elevated">
      <div className="flex items-start gap-3">
        <ActorStack actors={group.actors} />

        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-6 text-[rgb(var(--color-label))]">
            {renderSummary(group)}
          </p>

          <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))]">
            {formatRelative(group.createdAt)}
          </p>

          {group.kind === 'engagement' && group.targetEventId && target.event && (
            <EventPreviewCard event={target.event} className="mt-3" compact linked />
          )}

          {group.kind === 'mention' && latestEvent && (
            <EventPreviewCard event={latestEvent} className="mt-3" compact linked />
          )}
        </div>
      </div>
    </article>
  )
}

function ActorStack({ actors }: { actors: string[] }) {
  const visible = actors.slice(0, 5)
  const extra = Math.max(actors.length - visible.length, 0)

  return (
    <div className="flex items-center">
      {visible.map((pubkey, index) => (
        <div key={pubkey} className={index === 0 ? '' : '-ml-2'}>
          <ActorAvatar pubkey={pubkey} />
        </div>
      ))}
      {extra > 0 && (
        <span className="ml-2 text-[12px] font-medium text-[rgb(var(--color-label-tertiary))]">
          +{extra}
        </span>
      )}
    </div>
  )
}

function ActorAvatar({ pubkey }: { pubkey: string }) {
  const { profile } = useProfile(pubkey, { background: false })
  const name = profile?.display_name ?? profile?.name ?? pubkey.slice(0, 8)

  if (profile?.picture) {
    return (
      <img
        src={profile.picture}
        alt={name}
        className="h-8 w-8 rounded-full border border-[rgb(var(--color-bg))] object-cover"
        loading="lazy"
      />
    )
  }

  return (
    <div className="h-8 w-8 rounded-full border border-[rgb(var(--color-bg))] bg-[rgb(var(--color-fill)/0.16)] text-[10px] font-semibold text-[rgb(var(--color-label-secondary))] flex items-center justify-center">
      {name.slice(0, 2).toUpperCase()}
    </div>
  )
}

function renderSummary(group: ActivityGroup): string {
  const actorCount = group.actors.length
  const lead = actorCount <= 1
    ? tApp('activitySomeone')
    : tApp('activityPeopleCount', { count: actorCount })

  if (group.kind === 'mention') {
    return actorCount <= 1
      ? tApp('activityMentionSingle')
      : tApp('activityMentionMulti', { count: actorCount })
  }

  const segments: string[] = []
  if (group.stats.reaction > 0) {
    segments.push(group.stats.reaction === 1
      ? tApp('activitySegmentReacted')
      : tApp('activitySegmentReactions', { count: group.stats.reaction }))
  }
  if (group.stats.repost > 0) {
    segments.push(group.stats.repost === 1
      ? tApp('activitySegmentReposted')
      : tApp('activitySegmentReposts', { count: group.stats.repost }))
  }
  if (group.stats.zap > 0) {
    segments.push(group.stats.zap === 1
      ? tApp('activitySegmentZapped')
      : tApp('activitySegmentZaps', { count: group.stats.zap }))
  }

  if (segments.length === 0) return tApp('activityInteractedFallback', { lead })
  return tApp('activityInteractedSummary', { lead, segments: segments.join(' • ') })
}

function formatRelative(createdAt: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - createdAt

  if (diff < 60) return tApp('activityJustNow')

  const formatter = new Intl.RelativeTimeFormat(getAppLocale(), { numeric: 'auto' })
  if (diff < 3600) return formatter.format(-Math.floor(diff / 60), 'minute')
  if (diff < 86_400) return formatter.format(-Math.floor(diff / 3600), 'hour')
  if (diff < 604_800) return formatter.format(-Math.floor(diff / 86_400), 'day')

  return new Intl.DateTimeFormat(getAppLocale()).format(new Date(createdAt * 1000))
}

function getLastEventTag(event: NostrEvent, tagName: string): string | null {
  for (let index = event.tags.length - 1; index >= 0; index -= 1) {
    const tag = event.tags[index]
    if (!tag) continue
    if (tag[0] === tagName && typeof tag[1] === 'string' && tag[1].length > 0) {
      return tag[1]
    }
  }
  return null
}

function getMentionTargetEventId(event: NostrEvent): string | null {
  const target = getLastEventTag(event, 'e')
  return target && isValidHex32(target) ? target : null
}

function getDayKey(createdAt: number): string {
  return new Date(createdAt * 1000).toISOString().slice(0, 10)
}

function buildActivityGroups(events: NostrEvent[], currentUserPubkey: string): ActivityGroup[] {
  const map = new Map<string, ActivityGroup>()

  for (const event of events) {
    if (event.pubkey === currentUserPubkey) continue

    const reaction = parseReactionEvent(event)
    const repost = parseRepostEvent(event)
    const zap = parseZapReceipt(event)

    if (reaction?.targetPubkey !== currentUserPubkey && repost?.targetPubkey !== currentUserPubkey && zap?.recipientPubkey !== currentUserPubkey) {
      const mentionsCurrentUser = event.tags.some((tag) => tag[0] === 'p' && tag[1] === currentUserPubkey)
      if (!mentionsCurrentUser) continue
    }

    const dayKey = getDayKey(event.created_at)

    if (reaction && reaction.targetPubkey === currentUserPubkey) {
      const groupKey = `engagement:${reaction.targetEventId}:${dayKey}`
      const existing = map.get(groupKey)
      if (existing) {
        existing.events.push(event)
        existing.stats.reaction += 1
        if (!existing.actors.includes(event.pubkey)) existing.actors.push(event.pubkey)
        existing.createdAt = Math.max(existing.createdAt, event.created_at)
      } else {
        map.set(groupKey, {
          id: groupKey,
          kind: 'engagement',
          createdAt: event.created_at,
          actors: [event.pubkey],
          events: [event],
          targetEventId: reaction.targetEventId,
          stats: { reaction: 1, repost: 0, zap: 0, mention: 0 },
        })
      }
      continue
    }

    if (repost && repost.targetPubkey === currentUserPubkey) {
      const groupKey = `engagement:${repost.targetEventId}:${dayKey}`
      const existing = map.get(groupKey)
      if (existing) {
        existing.events.push(event)
        existing.stats.repost += 1
        if (!existing.actors.includes(event.pubkey)) existing.actors.push(event.pubkey)
        existing.createdAt = Math.max(existing.createdAt, event.created_at)
      } else {
        map.set(groupKey, {
          id: groupKey,
          kind: 'engagement',
          createdAt: event.created_at,
          actors: [event.pubkey],
          events: [event],
          targetEventId: repost.targetEventId,
          stats: { reaction: 0, repost: 1, zap: 0, mention: 0 },
        })
      }
      continue
    }

    if (zap && zap.recipientPubkey === currentUserPubkey) {
      const targetEventId = zap.targetEventId
      const groupKey = `engagement:${targetEventId ?? event.id}:${dayKey}`
      const existing = map.get(groupKey)
      if (existing) {
        existing.events.push(event)
        existing.stats.zap += 1
        if (!existing.actors.includes(event.pubkey)) existing.actors.push(event.pubkey)
        existing.createdAt = Math.max(existing.createdAt, event.created_at)
      } else {
        map.set(groupKey, {
          id: groupKey,
          kind: 'engagement',
          createdAt: event.created_at,
          actors: [event.pubkey],
          events: [event],
          targetEventId,
          stats: { reaction: 0, repost: 0, zap: 1, mention: 0 },
        })
      }
      continue
    }

    const mentionTargetEventId = getMentionTargetEventId(event)
    const mentionGroupKey = `mention:${mentionTargetEventId ?? event.id}:${dayKey}`
    const existing = map.get(mentionGroupKey)
    if (existing) {
      existing.events.push(event)
      existing.stats.mention += 1
      if (!existing.actors.includes(event.pubkey)) existing.actors.push(event.pubkey)
      existing.createdAt = Math.max(existing.createdAt, event.created_at)
    } else {
      map.set(mentionGroupKey, {
        id: mentionGroupKey,
        kind: 'mention',
        createdAt: event.created_at,
        actors: [event.pubkey],
        events: [event],
        targetEventId: mentionTargetEventId,
        stats: { reaction: 0, repost: 0, zap: 0, mention: 1 },
      })
    }
  }

  return [...map.values()]
    .map((group) => ({
      ...group,
      events: [...group.events].sort((a, b) => b.created_at - a.created_at),
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}
