import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { queryEvents } from '@/lib/db/nostr'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const LIVE_PRESENCE_KINDS = [
  Kind.LiveActivity,
  Kind.MeetingSpace,
  Kind.MeetingRoom,
] as const

type LivePresenceState = 'live' | 'planned' | 'ended' | 'unknown'

export interface ParsedLivePresenceEvent {
  event: NostrEvent
  id: string
  pubkey: string
  createdAt: number
  kind: number
  identifier?: string
  title?: string
  summary?: string
  status: LivePresenceState
  startsAt?: number
  endsAt?: number
  streamingUrl?: string
}

function getTagValue(tags: string[][], name: string): string | undefined {
  for (const tag of tags) {
    if (tag[0] !== name || typeof tag[1] !== 'string') continue
    const normalized = tag[1].trim()
    if (normalized.length > 0) return normalized
  }
  return undefined
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,12}$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function normalizePresenceState(value: string | undefined): LivePresenceState {
  switch ((value ?? '').toLowerCase()) {
    case 'live':
      return 'live'
    case 'planned':
      return 'planned'
    case 'ended':
      return 'ended'
    default:
      return 'unknown'
  }
}

function getPresenceScore(presence: ParsedLivePresenceEvent): number {
  if (presence.status === 'live') return 3
  if (presence.status === 'planned') return 2
  if (presence.status === 'unknown') return 1
  return 0
}

export function parseLivePresenceEvent(event: NostrEvent): ParsedLivePresenceEvent | null {
  if (!LIVE_PRESENCE_KINDS.includes(event.kind as (typeof LIVE_PRESENCE_KINDS)[number])) {
    return null
  }

  const identifier = getTagValue(event.tags, 'd')
  const title = getTagValue(event.tags, 'title')
  const summary = getTagValue(event.tags, 'summary')
  const startsAt = parseTimestamp(getTagValue(event.tags, 'starts'))
  const endsAt = parseTimestamp(getTagValue(event.tags, 'ends'))
  const streamingUrl = getTagValue(event.tags, 'streaming')

  const parsed: ParsedLivePresenceEvent = {
    event,
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    kind: event.kind,
    status: normalizePresenceState(getTagValue(event.tags, 'status')),
    ...(identifier !== undefined ? { identifier } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(startsAt !== undefined ? { startsAt } : {}),
    ...(endsAt !== undefined ? { endsAt } : {}),
    ...(streamingUrl !== undefined ? { streamingUrl } : {}),
  }

  return parsed
}

export async function getLatestLivePresence(pubkey: string): Promise<ParsedLivePresenceEvent | null> {
  const events = await queryEvents({
    authors: [pubkey],
    kinds: [...LIVE_PRESENCE_KINDS],
    limit: 60,
  })

  const now = Math.floor(Date.now() / 1000)
  const parsed = events
    .map(parseLivePresenceEvent)
    .filter((value): value is ParsedLivePresenceEvent => value !== null)
    .filter((value) => {
      if (value.status === 'ended') return false
      if (value.endsAt !== undefined && value.endsAt <= now) return false
      return true
    })

  if (parsed.length === 0) return null

  parsed.sort((a, b) => {
    const scoreDelta = getPresenceScore(b) - getPresenceScore(a)
    if (scoreDelta !== 0) return scoreDelta
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
    return b.id.localeCompare(a.id)
  })

  return parsed[0] ?? null
}

export async function fetchFreshLivePresence(pubkey: string, signal?: AbortSignal): Promise<void> {
  const ndk = getNDK()
  const filter = {
    authors: [pubkey],
    kinds: [...LIVE_PRESENCE_KINDS],
    limit: 40,
  } as unknown as NDKFilter

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await ndk.fetchEvents(filter, { closeOnEose: true })
    },
    {
      maxAttempts: 2,
      baseDelayMs: 1_000,
      maxDelayMs: 3_000,
      ...(signal ? { signal } : {}),
    },
  )
}