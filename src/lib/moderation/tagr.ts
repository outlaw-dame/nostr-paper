import { NDKRelaySet, type NDKEvent } from '@nostr-dev-kit/ndk'
import { dbQuery, initDB } from '@/lib/db/client'
import { insertEvent } from '@/lib/db/nostr'
import { getNDK } from '@/lib/nostr/ndk'
import { isValidEvent } from '@/lib/security/sanitize'
import type { ModerationDecision, ModerationDocument, NostrEvent, NostrFilter } from '@/types'
import { Kind } from '@/types'

const TAGR_BOT_PUBKEY_HEX = '56d4b3d6310fadb7294b7f041aab469c5ffc8991b1b1b331981b96a246f6ae65'
const TAGR_RELAY_URL = 'wss://relay.nos.social'

const KNOWN_MODERATION_NAMESPACES = new Set([
  'social.nos.ontology',
  'nip28.moderation',
])

const KNOWN_ONTOLOGY_CODE_RE = /^(?:NS|PN|IL|VI|SP|NW|IM|IH|CL|HC|NA)(?:-[a-z]{3})?$/

// Per-document-ID sync TTL cache.  Key = sorted comma-joined IDs, value = timestamp.
// Prevents hammering the Tagr relay when the same event is viewed repeatedly
// (e.g. a viral note appearing in multiple feeds, or the same page re-rendering).
const TAGR_SYNC_TTL_MS = 60_000 // 1 minute
const tagrSyncCache = new Map<string, number>()

function tagrSyncCacheKey(eventIds: string[], profilePubkeys: string[]): string {
  return [...eventIds, ...profilePubkeys].sort().join(',')
}

function isTagrSyncFresh(key: string): boolean {
  const ts = tagrSyncCache.get(key)
  return ts !== undefined && Date.now() - ts < TAGR_SYNC_TTL_MS
}

function markTagrSynced(key: string): void {
  tagrSyncCache.set(key, Date.now())
  // Evict entries older than 5× TTL to bound memory use.
  const cutoff = Date.now() - TAGR_SYNC_TTL_MS * 5
  for (const [k, ts] of tagrSyncCache) {
    if (ts < cutoff) tagrSyncCache.delete(k)
  }
}

interface TagrReason {
  reason: string
  createdAt: number
}

function parseRawEvent(raw: string): NostrEvent | null {
  try {
    const parsed = JSON.parse(raw) as NostrEvent
    return isValidEvent(parsed) ? parsed : null
  } catch {
    return null
  }
}

function getNormalizedLabelValues(event: NostrEvent): string[] {
  const values: string[] = []
  for (const tag of event.tags) {
    if (tag[0] !== 'l') continue
    const value = (tag[1] ?? '').trim()
    if (!value) continue
    values.push(value)
  }
  return values
}

function hasModerationNamespace(event: NostrEvent): boolean {
  for (const tag of event.tags) {
    if (tag[0] !== 'L') continue
    const namespace = (tag[1] ?? '').trim().toLowerCase()
    if (KNOWN_MODERATION_NAMESPACES.has(namespace)) return true
  }
  return false
}

function isLikelyModerationLabel(event: NostrEvent): boolean {
  const values = getNormalizedLabelValues(event)
  if (values.some((value) => value.startsWith('MOD>'))) return true
  if (values.some((value) => KNOWN_ONTOLOGY_CODE_RE.test(value))) return true
  if (hasModerationNamespace(event)) return true
  return false
}

export function isTagrModerationEvent(event: NostrEvent): boolean {
  if (event.pubkey !== TAGR_BOT_PUBKEY_HEX) return false

  if (event.kind === Kind.Report) {
    return event.tags.some((tag) => tag[0] === 'e' || tag[0] === 'p')
  }

  if (event.kind === Kind.Label) {
    if (!event.tags.some((tag) => tag[0] === 'e' || tag[0] === 'p')) return false
    return isLikelyModerationLabel(event)
  }

  return false
}

export function getTagrReason(event: NostrEvent): string {
  const labelValues = getNormalizedLabelValues(event)

  const modPrefixed = labelValues.find((value) => value.startsWith('MOD>'))
  if (modPrefixed) {
    const code = modPrefixed.slice(4).trim()
    return code.length > 0 ? code : 'tagr_moderation'
  }

  const ontologyCode = labelValues.find((value) => KNOWN_ONTOLOGY_CODE_RE.test(value))
  if (ontologyCode) return ontologyCode

  const reportType = event.tags
    .filter((tag) => tag[0] === 'e' || tag[0] === 'p' || tag[0] === 'x')
    .map((tag) => (tag[2] ?? '').trim().toLowerCase())
    .find((value) => value.length > 0)

  if (reportType) return reportType
  if (event.kind === Kind.Report) return 'report'
  return 'label'
}

async function syncTagrEvents(
  eventIds: string[],
  profilePubkeys: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return

  let ndk
  try {
    ndk = getNDK()
  } catch {
    return
  }

  const filter: NostrFilter = {
    authors: [TAGR_BOT_PUBKEY_HEX],
    kinds: [Kind.Report, Kind.Label],
    limit: Math.min(500, Math.max(80, (eventIds.length + profilePubkeys.length) * 3)),
  }

  if (eventIds.length > 0) {
    filter['#e'] = eventIds
  }
  if (profilePubkeys.length > 0) {
    filter['#p'] = profilePubkeys
  }

  const relaySet = NDKRelaySet.fromRelayUrls([TAGR_RELAY_URL], ndk, true)

  let ndkEvents: Set<NDKEvent>
  try {
    ndkEvents = await ndk.fetchEvents(filter, undefined, relaySet)
  } catch {
    return
  }

  if (signal?.aborted) return

  for (const ndkEvent of ndkEvents) {
    if (signal?.aborted) return
    const raw = ndkEvent.rawEvent() as unknown as NostrEvent
    if (!isValidEvent(raw)) continue
    if (raw.pubkey !== TAGR_BOT_PUBKEY_HEX) continue

    try {
      await insertEvent(raw)
    } catch {
      // Best-effort cache sync; query path is still fail-open.
    }
  }
}

async function loadLocalTagrEvents(eventIds: string[], profilePubkeys: string[]): Promise<NostrEvent[]> {
  if (eventIds.length === 0 && profilePubkeys.length === 0) return []

  const targetClauses: string[] = []
  const bind: unknown[] = [TAGR_BOT_PUBKEY_HEX, Kind.Report, Kind.Label]

  if (eventIds.length > 0) {
    targetClauses.push(`(t.name = 'e' AND t.value IN (${eventIds.map(() => '?').join(',')}))`)
    bind.push(...eventIds)
  }

  if (profilePubkeys.length > 0) {
    targetClauses.push(`(t.name = 'p' AND t.value IN (${profilePubkeys.map(() => '?').join(',')}))`)
    bind.push(...profilePubkeys)
  }

  if (targetClauses.length === 0) return []

  const rows = await dbQuery<{ raw: string }>(`
    SELECT DISTINCT e.raw
    FROM events e
    JOIN tags t ON t.event_id = e.id
    WHERE e.pubkey = ?
      AND e.kind IN (?, ?)
      AND (${targetClauses.join(' OR ')})
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1000
  `, bind)

  return rows
    .map((row) => parseRawEvent(row.raw))
    .filter((event): event is NostrEvent => event !== null)
    .filter((event) => isTagrModerationEvent(event))
}

function addTagrDecision(
  index: Map<string, TagrReason>,
  targetId: string,
  reason: string,
  createdAt: number,
): void {
  const existing = index.get(targetId)
  if (existing && existing.createdAt >= createdAt) return
  index.set(targetId, { reason, createdAt })
}

function buildTagrDecisionMap(
  events: NostrEvent[],
  eventIds: Set<string>,
  profilePubkeys: Set<string>,
): Map<string, ModerationDecision> {
  const targetReasons = new Map<string, TagrReason>()

  for (const event of events) {
    const reason = getTagrReason(event)

    for (const tag of event.tags) {
      const target = tag[1]
      if (typeof target !== 'string' || target.length === 0) continue

      if (tag[0] === 'e' && eventIds.has(target)) {
        addTagrDecision(targetReasons, target, reason, event.created_at)
      }

      if (tag[0] === 'p' && profilePubkeys.has(target)) {
        addTagrDecision(targetReasons, target, reason, event.created_at)
      }
    }
  }

  const decisions = new Map<string, ModerationDecision>()

  for (const [id, entry] of targetReasons) {
    decisions.set(id, {
      id,
      action: 'block',
      reason: `tagr:${entry.reason}`,
      scores: {
        toxic: 0,
        severe_toxic: 0,
        obscene: 0,
        threat: 0,
        insult: 0,
        identity_hate: 0,
      },
      model: 'tagr-bot',
      policyVersion: 'nip-56+nip-32-v1',
    })
  }

  return decisions
}

export async function resolveTagrModerationDecisions(
  documents: ModerationDocument[],
  signal?: AbortSignal,
): Promise<Map<string, ModerationDecision>> {
  if (documents.length === 0) return new Map()

  await initDB(signal)

  const eventIds = new Set(
    documents
      .filter((document) => document.kind === 'event')
      .map((document) => document.id),
  )
  const profilePubkeys = new Set(
    documents
      .filter((document) => document.kind === 'profile')
      .map((document) => document.id),
  )

  const eventIdList = [...eventIds]
  const profilePubkeyList = [...profilePubkeys]

  const syncKey = tagrSyncCacheKey(eventIdList, profilePubkeyList)
  if (!isTagrSyncFresh(syncKey)) {
    await syncTagrEvents(eventIdList, profilePubkeyList, signal)
    markTagrSynced(syncKey)
  }
  const localEvents = await loadLocalTagrEvents(eventIdList, profilePubkeyList)

  return buildTagrDecisionMap(localEvents, eventIds, profilePubkeys)
}
