import type { NDKFilter } from '@nostr-dev-kit/ndk'
import { getLatestAddressableEvent, insertEvent, queryEvents } from '@/lib/db/nostr'
import {
  parseNip51ListEvent,
  type ParsedNip51ListEvent,
} from '@/lib/nostr/lists'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const FOLLOW_PACK_FETCH_LIMIT = 24
const FOLLOW_PACK_LOCAL_MULTIPLIER = 4
const FOLLOW_PACK_PREVIEW_LIMIT = 3

const EMPTY_PUBKEY_SET = new Set<string>()

export const FOLLOW_PACK_KINDS = [Kind.StarterPack, Kind.MediaStarterPack] as const

export interface FollowPackProfileEntry {
  pubkey: string
  relayUrl?: string | null
  petname?: string | null
}

export interface ExploreFollowPackCandidate {
  event: NostrEvent
  parsed: ParsedNip51ListEvent
  profiles: FollowPackProfileEntry[]
}

export interface RankedExploreFollowPack extends ExploreFollowPackCandidate {
  totalProfiles: number
  missingProfiles: FollowPackProfileEntry[]
  overlapProfiles: FollowPackProfileEntry[]
  previewProfiles: FollowPackProfileEntry[]
  missingCount: number
  overlapCount: number
  authorFollowed: boolean
  reason: string
  score: number
}

export function getExploreFollowPackLabel(kind: number): string {
  return kind === Kind.MediaStarterPack ? 'Media Pack' : 'Starter Pack'
}

export function getExploreFollowPackSummary(parsed: ParsedNip51ListEvent): string {
  if (parsed.description) return parsed.description

  const itemCount = parsed.publicItems.filter((item) => item.tagName === 'p').length
  if (parsed.kind === Kind.MediaStarterPack) {
    return `${itemCount} media-focused profile${itemCount === 1 ? '' : 's'} to follow together.`
  }

  return `${itemCount} profile${itemCount === 1 ? '' : 's'} to follow together.`
}

function compareEventsByRecency(left: { createdAt: number; id: string }, right: { createdAt: number; id: string }): number {
  if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt
  return right.id.localeCompare(left.id)
}

export function extractFollowPackProfiles(parsed: ParsedNip51ListEvent): FollowPackProfileEntry[] {
  const deduped = new Map<string, FollowPackProfileEntry>()

  for (const item of parsed.publicItems) {
    if (item.tagName !== 'p') continue
    const pubkey = item.values[0]
    if (!pubkey || deduped.has(pubkey)) continue
    deduped.set(pubkey, {
      pubkey,
      ...(item.values[1] ? { relayUrl: item.values[1] } : {}),
      ...(item.values[2] ? { petname: item.values[2] } : {}),
    })
  }

  return [...deduped.values()]
}

export function buildExploreFollowPackCandidates(events: NostrEvent[]): ExploreFollowPackCandidate[] {
  const parsedCandidates = events
    .filter((event) => FOLLOW_PACK_KINDS.includes(event.kind as (typeof FOLLOW_PACK_KINDS)[number]))
    .map((event) => {
      const parsed = parseNip51ListEvent(event)
      if (!parsed) return null

      const profiles = extractFollowPackProfiles(parsed)
      if (profiles.length === 0) return null

      return { event, parsed, profiles }
    })
    .filter((candidate): candidate is ExploreFollowPackCandidate => candidate !== null)
    .sort((left, right) => compareEventsByRecency(
      { createdAt: left.parsed.createdAt, id: left.parsed.id },
      { createdAt: right.parsed.createdAt, id: right.parsed.id },
    ))

  const deduped: ExploreFollowPackCandidate[] = []
  const seen = new Set<string>()

  for (const candidate of parsedCandidates) {
    const key = `${candidate.parsed.kind}:${candidate.parsed.pubkey}:${candidate.parsed.identifier ?? candidate.parsed.id}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(candidate)
  }

  return deduped
}

export async function listLocalExploreFollowPackCandidates(limit = FOLLOW_PACK_FETCH_LIMIT): Promise<ExploreFollowPackCandidate[]> {
  const localLimit = Math.min(Math.max(limit * FOLLOW_PACK_LOCAL_MULTIPLIER, limit), 96)
  const events = await queryEvents({
    kinds: [...FOLLOW_PACK_KINDS],
    limit: localLimit,
  })
  return buildExploreFollowPackCandidates(events).slice(0, limit)
}

export async function refreshExploreFollowPackCandidates(
  limit = FOLLOW_PACK_FETCH_LIMIT,
  signal?: AbortSignal,
): Promise<ExploreFollowPackCandidate[]> {
  let ndk
  try {
    ndk = getNDK()
  } catch {
    return listLocalExploreFollowPackCandidates(limit)
  }

  const filter: NDKFilter = {
    kinds: [...FOLLOW_PACK_KINDS],
    limit: Math.min(Math.max(limit, 1), FOLLOW_PACK_FETCH_LIMIT),
  }

  try {
    const events = await withRetry(
      async () => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const results = await ndk.fetchEvents(filter)
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        return [...results].map((event) => event.rawEvent() as unknown as NostrEvent)
      },
      {
        maxAttempts: 2,
        baseDelayMs: 1_000,
        maxDelayMs: 3_000,
        ...(signal ? { signal } : {}),
      },
    )

    await Promise.all(events.map((event) => insertEvent(event).catch(() => undefined)))
  } catch {
    return listLocalExploreFollowPackCandidates(limit)
  }

  return listLocalExploreFollowPackCandidates(limit)
}

function buildFollowPackReason(options: {
  missingCount: number
  overlapCount: number
  authorFollowed: boolean
  kind: number
  createdAt: number
}): string {
  const {
    missingCount,
    overlapCount,
    authorFollowed,
    kind,
    createdAt,
  } = options

  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - createdAt)
  const isFresh = ageSeconds < 7 * 24 * 60 * 60
  const packLabel = kind === Kind.MediaStarterPack ? 'media-focused pack' : 'starter pack'

  if (authorFollowed && missingCount > 0) {
    return `${missingCount} new from someone you already follow`
  }
  if (missingCount > 0 && overlapCount > 0) {
    return `${missingCount} new, ${overlapCount} already in your network`
  }
  if (missingCount > 0) {
    return `${missingCount} new profile${missingCount === 1 ? '' : 's'} to add`
  }
  if (authorFollowed) {
    return `Curated by someone you already follow`
  }
  if (overlapCount > 0) {
    return `${overlapCount} already in your network`
  }
  if (isFresh) {
    return `Fresh ${packLabel} from your relays`
  }
  return kind === Kind.MediaStarterPack ? 'Media-focused discovery' : 'Curated discovery pack'
}

export function rankExploreFollowPacks(
  candidates: ExploreFollowPackCandidate[],
  options: {
    currentUserPubkey?: string | null
    followedPubkeys?: ReadonlySet<string>
    isMuted?: (pubkey: string) => boolean
    limit?: number
  } = {},
): RankedExploreFollowPack[] {
  const followedPubkeys = options.followedPubkeys ?? EMPTY_PUBKEY_SET
  const isMuted = options.isMuted ?? (() => false)
  const currentUserPubkey = options.currentUserPubkey ?? null
  const limit = options.limit ?? candidates.length

  return candidates
    .filter((candidate) => candidate.parsed.pubkey !== currentUserPubkey)
    .filter((candidate) => !isMuted(candidate.parsed.pubkey))
    .map((candidate) => {
      const eligibleProfiles = candidate.profiles.filter((profile) =>
        profile.pubkey !== currentUserPubkey && !isMuted(profile.pubkey),
      )

      if (eligibleProfiles.length === 0) return null

      const missingProfiles = eligibleProfiles.filter((profile) => !followedPubkeys.has(profile.pubkey))
      const overlapProfiles = eligibleProfiles.filter((profile) => followedPubkeys.has(profile.pubkey))
      const previewProfiles = [...missingProfiles, ...overlapProfiles].slice(0, FOLLOW_PACK_PREVIEW_LIMIT)
      const authorFollowed = followedPubkeys.has(candidate.parsed.pubkey)
      const ageDays = Math.max(0, (Date.now() / 1000 - candidate.parsed.createdAt) / (24 * 60 * 60))
      const freshnessBoost = ageDays < 2 ? 2.4 : ageDays < 7 ? 1.6 : ageDays < 30 ? 0.8 : 0
      const metadataBoost = (candidate.parsed.title ? 0.8 : 0)
        + (candidate.parsed.description ? 0.6 : 0)
        + (candidate.parsed.image ? 0.4 : 0)
      const sizeBoost = eligibleProfiles.length >= 3 && eligibleProfiles.length <= 24
        ? 1.2
        : eligibleProfiles.length <= 64
          ? 0.4
          : -0.8
      const score = Math.min(missingProfiles.length, 12) * 2.4
        + Math.min(overlapProfiles.length, 5) * 0.7
        + (authorFollowed ? 0.9 : 0)
        + (candidate.parsed.kind === Kind.MediaStarterPack ? 0.35 : 0)
        + freshnessBoost
        + metadataBoost
        + sizeBoost

      return {
        ...candidate,
        totalProfiles: eligibleProfiles.length,
        missingProfiles,
        overlapProfiles,
        previewProfiles,
        missingCount: missingProfiles.length,
        overlapCount: overlapProfiles.length,
        authorFollowed,
        reason: buildFollowPackReason({
          missingCount: missingProfiles.length,
          overlapCount: overlapProfiles.length,
          authorFollowed,
          kind: candidate.parsed.kind,
          createdAt: candidate.parsed.createdAt,
        }),
        score,
      }
    })
    .filter((candidate): candidate is RankedExploreFollowPack => candidate !== null)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      return compareEventsByRecency(
        { createdAt: left.parsed.createdAt, id: left.parsed.id },
        { createdAt: right.parsed.createdAt, id: right.parsed.id },
      )
    })
    .slice(0, Math.max(limit, 0))
}

export async function getExploreFollowPackByAddress(
  pubkey: string,
  identifier: string,
  kind = Kind.StarterPack,
): Promise<ExploreFollowPackCandidate | null> {
  const event = await getLatestAddressableEvent(pubkey, kind, identifier)
  if (!event) return null
  return buildExploreFollowPackCandidates([event])[0] ?? null
}
