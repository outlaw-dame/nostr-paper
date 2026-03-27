/**
 * Nostr DB — High-level event storage and retrieval
 *
 * All data in / data out goes through validation + sanitization.
 * Query layer translates NIP-01 filters into SQL.
 *
 * insertEvent() handles:
 * - Signature verification (via isValidEvent)
 * - Deletion check before insert
 * - Atomic transaction: event row + tag rows + kind-specific side effects
 * - Profile upsert (kind 0) inside the same transaction
 * - Follow list replacement (kind 3) inside the same transaction
 * - Relay list replacement (kind 10002) inside the same transaction
 * - Deletion marking (kind 5) inside the same transaction
 */

import { dbQuery, dbRun, dbTransaction } from './client'
import {
  isValidEvent,
  isValidHex32,
  isValidRelayURL,
  normalizeHashtag,
} from '@/lib/security/sanitize'
import {
  getEventAddressCoordinate,
  isAddressableKind,
  normalizeAddressIdentifier,
  parseAddressCoordinate,
} from '@/lib/nostr/addressable'
import {
  normalizeContactPetname,
  normalizeContactRelayHint,
  parseContactListEvent,
  isNewerReplaceableEvent,
} from '@/lib/nostr/contactList'
import {
  getLongFormIdentifier,
  normalizeLongFormIdentifier,
} from '@/lib/nostr/longForm'
import { parseProfileMetadataEvent } from '@/lib/nostr/metadata'
import { parseNip39IdentityTags } from '@/lib/nostr/nip39'
import { parseReactionEvent } from '@/lib/nostr/reaction'
import { parseRepostEvent } from '@/lib/nostr/repost'
import { parseZapReceipt, sumZapMsats } from '@/lib/nostr/zap'
import { parseSearchQuery } from '@/lib/nostr/search'
import type {
  ContactList,
  ContactListEntry,
  DBContactList,
  DBFollow,
  EventEngagementSummary,
  ReactionAggregate,
  NostrEvent,
  NostrFilter,
  DBProfile,
  Profile,
} from '@/types'
import { Kind } from '@/types'

// ── Event Write ──────────────────────────────────────────────

type SQLOperation = { sql: string; bind?: unknown[] }
const MAX_TAG_INSERT_ROWS_PER_STATEMENT = 100

function getEventDeletionHiddenCondition(eventAlias = 'e'): string {
  return `EXISTS (
    SELECT 1
    FROM event_deletions event_del
    WHERE event_del.event_id = ${eventAlias}.id
      AND event_del.deleted_by = ${eventAlias}.pubkey
  )`
}

function getAddressDeletionHiddenCondition(eventAlias = 'e'): string {
  return `(
    ${eventAlias}.kind BETWEEN 30000 AND 39999
    AND EXISTS (
      SELECT 1
      FROM tags event_d
      JOIN address_deletions address_del
        ON address_del.coordinate = (${eventAlias}.kind || ':' || ${eventAlias}.pubkey || ':' || event_d.value)
       AND address_del.deleted_by = ${eventAlias}.pubkey
       AND ${eventAlias}.created_at <= address_del.until_created_at
      WHERE event_d.event_id = ${eventAlias}.id
        AND event_d.name = 'd'
        AND length(event_d.value) > 0
    )
  )`
}

function getHiddenEventCondition(eventAlias = 'e'): string {
  return `(
    ${getEventDeletionHiddenCondition(eventAlias)}
    OR ${getAddressDeletionHiddenCondition(eventAlias)}
  )`
}

function getExpiredEventCondition(eventAlias = 'e'): string {
  return `EXISTS (
    SELECT 1
    FROM tags expiration_tag
    WHERE expiration_tag.event_id = ${eventAlias}.id
      AND expiration_tag.name = 'expiration'
      AND length(expiration_tag.value) BETWEEN 1 AND 12
      AND expiration_tag.value NOT GLOB '*[^0-9]*'
      AND CAST(expiration_tag.value AS INTEGER) > 0
      AND CAST(expiration_tag.value AS INTEGER) <= CAST(strftime('%s', 'now') AS INTEGER)
  )`
}

function getVisibleEventCondition(eventAlias = 'e'): string {
  return `(
    ${eventAlias}.kind = ${Kind.EventDeletion}
    OR (
      NOT ${getHiddenEventCondition(eventAlias)}
      AND NOT ${getExpiredEventCondition(eventAlias)}
    )
  )`
}

function normalizeRelayListUrl(value: string): string | null {
  if (!isValidRelayURL(value)) return null

  try {
    const normalized = new URL(value)
    normalized.hash = ''
    normalized.username = ''
    normalized.password = ''
    if (
      (normalized.protocol === 'wss:' && normalized.port === '443') ||
      (normalized.protocol === 'ws:' && normalized.port === '80')
    ) {
      normalized.port = ''
    }
    return normalized.toString()
  } catch {
    return null
  }
}

function getDeletionTargets(event: NostrEvent): {
  eventIds: string[]
  coordinates: string[]
} {
  const seenEventIds = new Set<string>()
  const eventIds: string[] = []
  const seenCoordinates = new Set<string>()
  const coordinates: string[] = []

  for (const tag of event.tags) {
    if (tag[0] === 'e' && tag[1] && isValidHex32(tag[1]) && !seenEventIds.has(tag[1])) {
      seenEventIds.add(tag[1])
      eventIds.push(tag[1])
      continue
    }

    if (tag[0] === 'a' && typeof tag[1] === 'string') {
      const parsedCoordinate = parseAddressCoordinate(tag[1])
      if (
        parsedCoordinate &&
        parsedCoordinate.pubkey === event.pubkey &&
        !seenCoordinates.has(tag[1])
      ) {
        seenCoordinates.add(tag[1])
        coordinates.push(tag[1])
      }
    }
  }

  return { eventIds, coordinates }
}

function buildContactListReplacementOps(
  parsedContacts: NonNullable<ReturnType<typeof parseContactListEvent>>,
  options: { pruneHistoricalEvents?: boolean } = {},
): SQLOperation[] {
  const ops: SQLOperation[] = []

  if (options.pruneHistoricalEvents) {
    ops.push({
      sql:  'DELETE FROM events WHERE pubkey = ? AND kind = ? AND id != ?',
      bind: [parsedContacts.pubkey, Kind.Contacts, parsedContacts.eventId],
    })
  }

  ops.push(
    {
      sql:  'DELETE FROM follows WHERE follower = ?',
      bind: [parsedContacts.pubkey],
    },
    {
      sql: `
        INSERT INTO contact_lists (pubkey, event_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(pubkey) DO UPDATE SET
          event_id = excluded.event_id,
          updated_at = excluded.updated_at
      `,
      bind: [parsedContacts.pubkey, parsedContacts.eventId, parsedContacts.createdAt],
    },
  )

  for (const entry of parsedContacts.entries) {
    ops.push({
      sql: `
        INSERT OR REPLACE INTO follows
          (follower, followee, relay_url, petname, position, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      bind: [
        parsedContacts.pubkey,
        entry.pubkey,
        entry.relayUrl ?? null,
        entry.petname ?? null,
        entry.position,
        parsedContacts.createdAt,
      ],
    })
  }

  return ops
}

function buildRelayListReplacementOps(event: NostrEvent): SQLOperation[] {
  const ops: SQLOperation[] = [
    {
      sql:  'DELETE FROM relay_list WHERE pubkey = ?',
      bind: [event.pubkey],
    },
  ]

  for (const tag of event.tags) {
    const [name, url, mode] = tag
    const normalizedUrl = typeof url === 'string' ? normalizeRelayListUrl(url) : null
    if (name !== 'r' || !normalizedUrl) continue

    const read = (!mode || mode === 'read') ? 1 : 0
    const write = (!mode || mode === 'write') ? 1 : 0
    ops.push({
      sql:  'INSERT OR IGNORE INTO relay_list (pubkey, url, read, write) VALUES (?,?,?,?)',
      bind: [event.pubkey, normalizedUrl, read, write],
    })
  }

  return ops
}

function buildTagInsertOps(event: NostrEvent): SQLOperation[] {
  const rows: Array<[string, string, number]> = []

  for (let index = 0; index < event.tags.length; index += 1) {
    const tag = event.tags[index]
    if (!tag) continue

    const [name, value] = tag
    const indexedValue = name === 't'
      ? normalizeHashtag(value ?? '')
      : value

    if (!name || name.length !== 1 || !indexedValue) continue
    rows.push([name, indexedValue, index])
  }

  if (rows.length === 0) return []

  const ops: SQLOperation[] = []
  for (let offset = 0; offset < rows.length; offset += MAX_TAG_INSERT_ROWS_PER_STATEMENT) {
    const chunk = rows.slice(offset, offset + MAX_TAG_INSERT_ROWS_PER_STATEMENT)
    const bind: unknown[] = []
    const valuesSql = chunk.map(() => '(?,?,?,?)').join(', ')

    for (const [name, value, index] of chunk) {
      bind.push(event.id, name, value, index)
    }

    ops.push({
      sql: `INSERT OR IGNORE INTO tags (event_id, name, value, idx) VALUES ${valuesSql}`,
      bind,
    })
  }

  return ops
}

async function getLatestVisibleAuthorEventMeta(
  pubkey: string,
  kind: number,
): Promise<{ eventId: string; createdAt: number } | null> {
  const rows = await dbQuery<{ id: string; created_at: number }>(`
    SELECT e.id, e.created_at
    FROM events e
    WHERE e.pubkey = ?
      AND e.kind = ?
      AND ${getVisibleEventCondition('e')}
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1
  `, [pubkey, kind])

  const row = rows[0]
  return row ? { eventId: row.id, createdAt: row.created_at } : null
}

async function getLatestVisibleAuthorEvent(
  pubkey: string,
  kind: number,
): Promise<NostrEvent | null> {
  const rows = await dbQuery<{ raw: string }>(`
    SELECT e.raw
    FROM events e
    WHERE e.pubkey = ?
      AND e.kind = ?
      AND ${getVisibleEventCondition('e')}
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1
  `, [pubkey, kind])

  const row = rows[0]
  if (!row) return null

  try {
    return JSON.parse(row.raw) as NostrEvent
  } catch {
    return null
  }
}

async function shouldReplaceRelayList(
  pubkey: string,
  candidate: { eventId: string; createdAt: number },
): Promise<boolean> {
  const current = await getLatestVisibleAuthorEventMeta(pubkey, Kind.RelayList)
  if (!current) return true

  return isNewerReplaceableEvent(candidate, current)
}

async function repairProfile(pubkey: string): Promise<void> {
  const latestProfileEvent = await getLatestVisibleAuthorEvent(pubkey, Kind.Metadata)
  if (!latestProfileEvent) {
    await dbRun('DELETE FROM profiles WHERE pubkey = ?', [pubkey])
    return
  }

  await dbTransaction(buildProfileOps(latestProfileEvent, { force: true }))
}

export async function repairStoredProfile(pubkey: string): Promise<void> {
  if (!isValidHex32(pubkey)) return
  await repairProfile(pubkey)
}

async function repairContactList(pubkey: string): Promise<void> {
  const latestContactsEvent = await getLatestVisibleAuthorEvent(pubkey, Kind.Contacts)
  if (!latestContactsEvent) {
    await dbTransaction([
      { sql: 'DELETE FROM contact_lists WHERE pubkey = ?', bind: [pubkey] },
      { sql: 'DELETE FROM follows WHERE follower = ?', bind: [pubkey] },
    ])
    return
  }

  const parsedContacts = parseContactListEvent(latestContactsEvent)
  if (!parsedContacts) {
    await dbTransaction([
      { sql: 'DELETE FROM contact_lists WHERE pubkey = ?', bind: [pubkey] },
      { sql: 'DELETE FROM follows WHERE follower = ?', bind: [pubkey] },
    ])
    return
  }

  await dbTransaction(buildContactListReplacementOps(parsedContacts))
}

async function repairRelayList(pubkey: string): Promise<void> {
  const latestRelayListEvent = await getLatestVisibleAuthorEvent(pubkey, Kind.RelayList)
  if (!latestRelayListEvent) {
    await dbRun('DELETE FROM relay_list WHERE pubkey = ?', [pubkey])
    return
  }

  await dbTransaction(buildRelayListReplacementOps(latestRelayListEvent))
}

async function repairDeletionDerivedState(event: NostrEvent): Promise<void> {
  const targets = getDeletionTargets(event)
  if (targets.eventIds.length === 0) return

  const repairedProfiles = new Set<string>()
  const repairedContacts = new Set<string>()
  const repairedRelays = new Set<string>()

  const rows = await dbQuery<{ id: string; pubkey: string; kind: number }>(`
    SELECT id, pubkey, kind
    FROM events
    WHERE id IN (${targets.eventIds.map(() => '?').join(',')})
  `, targets.eventIds)

  for (const row of rows) {
    if (row.pubkey !== event.pubkey) continue

    if (row.kind === Kind.Metadata && !repairedProfiles.has(row.pubkey)) {
      repairedProfiles.add(row.pubkey)
      await repairProfile(row.pubkey)
      continue
    }

    if (row.kind === Kind.Contacts && !repairedContacts.has(row.pubkey)) {
      repairedContacts.add(row.pubkey)
      await repairContactList(row.pubkey)
      continue
    }

    if (row.kind === Kind.RelayList && !repairedRelays.has(row.pubkey)) {
      repairedRelays.add(row.pubkey)
      await repairRelayList(row.pubkey)
    }
  }
}

/**
 * Insert a validated Nostr event.
 * Idempotent — duplicate IDs are silently ignored via INSERT OR IGNORE.
 *
 * Returns true if the event was newly inserted, false if it was already
 * present, was deleted, or failed validation.
 */
export async function insertEvent(event: NostrEvent): Promise<boolean> {
  // Cryptographic validation — never trust relay-provided data
  if (!isValidEvent(event)) {
    return false
  }

  const addressCoordinate = event.kind !== Kind.EventDeletion
    ? getEventAddressCoordinate(event)
    : null

  // ── Batch deletion checks in parallel (avoid N+1 queries) ───
  let isDeletionBlocked = false
  if (event.kind !== Kind.EventDeletion) {
    const [deletedById, deletedByAddress] = await Promise.all([
      dbQuery<{ event_id: string }>(
        'SELECT event_id FROM event_deletions WHERE event_id = ? AND deleted_by = ? LIMIT 1',
        [event.id, event.pubkey],
      ),
      addressCoordinate
        ? dbQuery<{ coordinate: string }>(
            'SELECT coordinate FROM address_deletions WHERE coordinate = ? AND deleted_by = ? AND until_created_at >= ? LIMIT 1',
            [addressCoordinate, event.pubkey, event.created_at],
          )
        : Promise.resolve([]),
    ])
    
    isDeletionBlocked = deletedById.length > 0 || deletedByAddress.length > 0
  }
  
  if (isDeletionBlocked) return false

  // ── Batch replaceable event checks in parallel ───
  const parsedContacts = event.kind === Kind.Contacts
    ? parseContactListEvent(event)
    : null

  const [shouldApplyContacts, shouldApplyRelayList] = await Promise.all([
    parsedContacts
      ? shouldReplaceContactList(parsedContacts.pubkey, {
          eventId: parsedContacts.eventId,
          createdAt: parsedContacts.createdAt,
        })
      : Promise.resolve(false),
    event.kind === Kind.RelayList
      ? shouldReplaceRelayList(event.pubkey, {
          eventId: event.id,
          createdAt: event.created_at,
        })
      : Promise.resolve(false),
  ])

  // Kind-3 is replaceable and obsolete historical lists should not be kept.
  if (parsedContacts && !shouldApplyContacts) {
    return false
  }

  if (event.kind === Kind.RelayList && !shouldApplyRelayList) {
    return false
  }

  // Build the full operation list for a single atomic transaction
  const ops: SQLOperation[] = []

  // ── Core event row ────────────────────────────────────────
  ops.push({
    sql: `
      INSERT OR IGNORE INTO events
        (id, pubkey, created_at, kind, content, sig, raw)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    bind: [
      event.id,
      event.pubkey,
      event.created_at,
      event.kind,
      event.content,
      event.sig,
      JSON.stringify(event),
    ],
  })

  // ── Deduplication record ──────────────────────────────────
  ops.push({
    sql: 'INSERT OR IGNORE INTO seen_events (event_id) VALUES (?)',
    bind: [event.id],
  })

  // ── Tag index (single-letter tags only, per NIP-01) ───────
  ops.push(...buildTagInsertOps(event))

  // ── Kind-specific side effects ────────────────────────────

  if (event.kind === Kind.Metadata) {
    // Parse and sanitize profile fields, upsert into profiles table
    const profileOps = buildProfileOps(event)
    ops.push(...profileOps)
  }

  if (parsedContacts && shouldApplyContacts) {
    ops.push(...buildContactListReplacementOps(parsedContacts, {
      pruneHistoricalEvents: true,
    }))
  }

  if (event.kind === Kind.RelayList && shouldApplyRelayList) {
    ops.push(...buildRelayListReplacementOps(event))
  }

  if (event.kind === Kind.EventDeletion) {
    const targets = getDeletionTargets(event)
    for (const eventId of targets.eventIds) {
      ops.push({
        sql: `
          INSERT OR IGNORE INTO event_deletions (event_id, deleted_by, request_event_id)
          VALUES (?, ?, ?)
        `,
        bind: [eventId, event.pubkey, event.id],
      })
    }
    for (const coordinate of targets.coordinates) {
      ops.push({
        sql: `
          INSERT OR IGNORE INTO address_deletions
            (coordinate, deleted_by, until_created_at, request_event_id)
          VALUES (?, ?, ?, ?)
        `,
        bind: [coordinate, event.pubkey, event.created_at, event.id],
      })
    }
  }

  try {
    await dbTransaction(ops)
    if (event.kind === Kind.EventDeletion) {
      try {
        await repairDeletionDerivedState(event)
      } catch (repairError) {
        console.warn('[DB] Deletion-state repair degraded:', repairError)
      }
    }
    return true
  } catch {
    // INSERT OR IGNORE prevents duplicate-key errors from being thrown,
    // so reaching here indicates a genuine write failure
    return false
  }
}

/**
 * Build the SQL operations to upsert a profile from a kind-0 event.
 * Returns an empty array if the content cannot be parsed.
 * All fields are sanitised before building the bind params.
 */
function buildProfileOps(
  event: NostrEvent,
  options: { force?: boolean } = {},
): Array<{ sql: string; bind: unknown[] }> {
  const parsed = parseProfileMetadataEvent(event)
  if (!parsed) return []

  const metadata = parsed.metadata
  const birthdayJson = metadata.birthday ? JSON.stringify(metadata.birthday) : null
  const externalIdentities = parseNip39IdentityTags(event.tags)
  const externalIdentitiesJson = externalIdentities.length > 0 ? JSON.stringify(externalIdentities) : null
  const sanitised = {
    ...(metadata.name ? { name: metadata.name } : {}),
    ...(metadata.display_name ? { display_name: metadata.display_name } : {}),
    ...(metadata.picture ? { picture: metadata.picture } : {}),
    ...(metadata.banner ? { banner: metadata.banner } : {}),
    ...(metadata.about ? { about: metadata.about } : {}),
    ...(metadata.website ? { website: metadata.website } : {}),
    ...(metadata.bot ? { bot: true } : {}),
    ...(metadata.birthday ? { birthday: metadata.birthday } : {}),
    ...(metadata.nip05 ? { nip05: metadata.nip05 } : {}),
    ...(metadata.lud06 ? { lud06: metadata.lud06 } : {}),
    ...(metadata.lud16 ? { lud16: metadata.lud16 } : {}),
  }

  return [
    {
      sql: `
        INSERT INTO profiles
          (
            pubkey, event_id, name, display_name, picture, banner, about, website,
            nip05, nip05_domain, nip05_verified, nip05_verified_at, nip05_last_checked_at,
            lud06, lud16, bot, birthday_json, external_identities, updated_at, raw
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pubkey) DO UPDATE SET
          event_id      = excluded.event_id,
          name         = excluded.name,
          display_name = excluded.display_name,
          picture      = excluded.picture,
          banner       = excluded.banner,
          about        = excluded.about,
          website      = excluded.website,
          nip05        = excluded.nip05,
          nip05_domain = CASE
            WHEN excluded.nip05 = profiles.nip05 THEN profiles.nip05_domain
            ELSE NULL
          END,
          nip05_verified = CASE
            WHEN excluded.nip05 = profiles.nip05 THEN profiles.nip05_verified
            ELSE 0
          END,
          nip05_verified_at = CASE
            WHEN excluded.nip05 = profiles.nip05 THEN profiles.nip05_verified_at
            ELSE NULL
          END,
          nip05_last_checked_at = CASE
            WHEN excluded.nip05 = profiles.nip05 THEN profiles.nip05_last_checked_at
            ELSE NULL
          END,
          lud06        = excluded.lud06,
          lud16        = excluded.lud16,
          bot          = excluded.bot,
          birthday_json = excluded.birthday_json,
          external_identities = excluded.external_identities,
          updated_at   = excluded.updated_at,
          raw          = excluded.raw
        ${options.force ? '' : `
          WHERE excluded.updated_at > profiles.updated_at
             OR (
               excluded.updated_at = profiles.updated_at
               AND (
                 profiles.event_id IS NULL
                 OR excluded.event_id < profiles.event_id
               )
             )
        `}
      `,
      bind: [
        event.pubkey,
        event.id,
        metadata.name ?? null,
        metadata.display_name ?? null,
        metadata.picture ?? null,
        metadata.banner ?? null,
        metadata.about ?? null,
        metadata.website ?? null,
        metadata.nip05 ?? null,
        null,
        0,
        null,
        null,
        metadata.lud06 ?? null,
        metadata.lud16 ?? null,
        metadata.bot ? 1 : 0,
        birthdayJson,
        externalIdentitiesJson,
        event.created_at,
        JSON.stringify(sanitised),
      ],
    },
  ]
}

async function shouldReplaceContactList(
  pubkey: string,
  candidate: { eventId: string; createdAt: number },
): Promise<boolean> {
  const rows = await dbQuery<DBContactList>(
    'SELECT pubkey, event_id, updated_at FROM contact_lists WHERE pubkey = ? LIMIT 1',
    [pubkey],
  )
  const current = rows[0]
  if (!current) return true

  return isNewerReplaceableEvent(candidate, {
    eventId: current.event_id,
    createdAt: current.updated_at,
  })
}

export async function rebuildDeletionState(): Promise<void> {
  const deletionEvents = await dbQuery<{ raw: string }>(
    'SELECT raw FROM events WHERE kind = ? ORDER BY created_at DESC, id DESC',
    [Kind.EventDeletion],
  )

  const ops: SQLOperation[] = [
    { sql: 'DELETE FROM event_deletions' },
    { sql: 'DELETE FROM address_deletions' },
  ]

  const eventDeletionAuthorsById = new Map<string, Set<string>>()

  for (const row of deletionEvents) {
    let event: NostrEvent
    try {
      event = JSON.parse(row.raw) as NostrEvent
    } catch {
      continue
    }

    if (!isValidHex32(event.pubkey)) continue
    const targets = getDeletionTargets(event)
    for (const eventId of targets.eventIds) {
      ops.push({
        sql: `
          INSERT OR IGNORE INTO event_deletions (event_id, deleted_by, request_event_id)
          VALUES (?, ?, ?)
        `,
        bind: [eventId, event.pubkey, event.id],
      })
      const authors = eventDeletionAuthorsById.get(eventId) ?? new Set<string>()
      authors.add(event.pubkey)
      eventDeletionAuthorsById.set(eventId, authors)
    }
    for (const coordinate of targets.coordinates) {
      ops.push({
        sql: `
          INSERT OR IGNORE INTO address_deletions
            (coordinate, deleted_by, until_created_at, request_event_id)
          VALUES (?, ?, ?, ?)
        `,
        bind: [coordinate, event.pubkey, event.created_at, event.id],
      })
    }
  }

  await dbTransaction(ops)

  const repairProfiles = new Set<string>()
  const repairContacts = new Set<string>()
  const repairRelays = new Set<string>()
  const targetIds = [...eventDeletionAuthorsById.keys()]

  for (let offset = 0; offset < targetIds.length; offset += 100) {
    const batch = targetIds.slice(offset, offset + 100)
    if (batch.length === 0) continue

    const rows = await dbQuery<{ id: string; pubkey: string; kind: number }>(`
      SELECT id, pubkey, kind
      FROM events
      WHERE id IN (${batch.map(() => '?').join(',')})
    `, batch)

    for (const row of rows) {
      if (!eventDeletionAuthorsById.get(row.id)?.has(row.pubkey)) continue
      if (row.kind === Kind.Metadata) repairProfiles.add(row.pubkey)
      if (row.kind === Kind.Contacts) repairContacts.add(row.pubkey)
      if (row.kind === Kind.RelayList) repairRelays.add(row.pubkey)
    }
  }

  for (const pubkey of repairProfiles) {
    await repairProfile(pubkey)
  }
  for (const pubkey of repairContacts) {
    await repairContactList(pubkey)
  }
  for (const pubkey of repairRelays) {
    await repairRelayList(pubkey)
  }
}

/** Check whether an event ID has been received before */
export async function hasSeenEvent(eventId: string): Promise<boolean> {
  const rows = await dbQuery<{ event_id: string }>(
    'SELECT event_id FROM seen_events WHERE event_id = ? LIMIT 1',
    [eventId],
  )
  return rows.length > 0
}

// ── Event Read ───────────────────────────────────────────────

/**
 * Query events with a NIP-01 compatible filter.
 * Returns deserialized NostrEvent objects from the `raw` column.
 * Hard-caps at 1000 results regardless of filter.limit.
 *
 * When `filter.search` is present the query is routed through the FTS5
 * index with results ordered by BM25 relevance rank, then recency.
 * All other filter fields (kinds, authors, since, until, tag filters) are
 * applied as additional WHERE conditions inside the FTS join.
 */
export async function queryEvents(filter: NostrFilter): Promise<NostrEvent[]> {
  const limit = Math.min(filter.limit ?? 100, 1000)

  if (!filter.search?.trim()) {
    return _queryEventsStandard(filter, limit)
  }

  const parsed = parseSearchQuery(filter.search)
  if (parsed.localQuery !== null) {
    return _queryEventsFts(filter, parsed.localQuery, limit, {
      nip05Domains: parsed.domains,
    })
  }
  if (parsed.domains.length > 0) {
    return _queryEventsStandard(filter, limit, {
      nip05Domains: parsed.domains,
    })
  }

  return []
}

/** Standard (non-search) event query — ordered by recency. */
interface EventQueryOptions {
  nip05Domains?: string[]
}

async function _queryEventsStandard(
  filter: NostrFilter,
  limit: number,
  options: EventQueryOptions = {},
): Promise<NostrEvent[]> {
  const conditions: string[] = []
  const bind: unknown[]      = []
  const joins: string[]      = []

  if (filter.ids?.length) {
    conditions.push(`e.id IN (${filter.ids.map(() => '?').join(',')})`)
    bind.push(...filter.ids)
  }
  if (filter.authors?.length) {
    conditions.push(`e.pubkey IN (${filter.authors.map(() => '?').join(',')})`)
    bind.push(...filter.authors)
  }
  if (filter.kinds?.length) {
    conditions.push(`e.kind IN (${filter.kinds.map(() => '?').join(',')})`)
    bind.push(...filter.kinds)
  }
  if (filter.since !== undefined) {
    conditions.push('e.created_at >= ?')
    bind.push(filter.since)
  }
  if (filter.until !== undefined) {
    conditions.push('e.created_at <= ?')
    bind.push(filter.until)
  }

  if (options.nip05Domains?.length) {
    joins.push('JOIN profiles p ON p.pubkey = e.pubkey')
    conditions.push(`p.nip05_domain IN (${options.nip05Domains.map(() => '?').join(',')})`)
    bind.push(...options.nip05Domains)
  }

  _appendTagConditions(filter, conditions, bind)
  _appendAddressableContentVisibilityConditions(filter, conditions, bind)
  conditions.push(getVisibleEventCondition('e'))

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows  = await dbQuery<{ raw: string }>(
    `SELECT e.raw FROM events e ${joins.join(' ')} ${where} ORDER BY e.created_at DESC, e.id DESC LIMIT ?`,
    [...bind, limit],
  )
  return _parseRaw(rows)
}

/**
 * FTS5 search query — ordered by BM25 relevance rank then recency.
 *
 * Uses a direct JOIN between events_fts and events so that:
 *   1. SQLite can push the MATCH condition to the FTS5 inverted index first
 *      (very fast — reads only matching rowids)
 *   2. Additional WHERE conditions on `e` narrow the FTS hit-set
 *   3. events_fts.rank (negative BM25 score) drives ordering — the outer
 *      ORDER BY is preserved because events_fts is the driving table
 */
async function _queryEventsFts(
  filter:   NostrFilter,
  ftsQuery: string,
  limit:    number,
  options:  EventQueryOptions = {},
): Promise<NostrEvent[]> {
  // ftsQuery is already sanitized — it is the first bind parameter (MATCH ?)
  const conditions: string[] = []
  const bind: unknown[]      = [ftsQuery]
  const joins: string[]      = ['JOIN events e ON e.rowid = events_fts.rowid']

  if (filter.ids?.length) {
    conditions.push(`e.id IN (${filter.ids.map(() => '?').join(',')})`)
    bind.push(...filter.ids)
  }
  if (filter.authors?.length) {
    conditions.push(`e.pubkey IN (${filter.authors.map(() => '?').join(',')})`)
    bind.push(...filter.authors)
  }
  if (filter.kinds?.length) {
    conditions.push(`e.kind IN (${filter.kinds.map(() => '?').join(',')})`)
    bind.push(...filter.kinds)
  }
  if (filter.since !== undefined) {
    conditions.push('e.created_at >= ?')
    bind.push(filter.since)
  }
  if (filter.until !== undefined) {
    conditions.push('e.created_at <= ?')
    bind.push(filter.until)
  }

  if (options.nip05Domains?.length) {
    joins.push('JOIN profiles p ON p.pubkey = e.pubkey')
    conditions.push(`p.nip05_domain IN (${options.nip05Domains.map(() => '?').join(',')})`)
    bind.push(...options.nip05Domains)
  }

  _appendTagConditions(filter, conditions, bind)
  _appendAddressableContentVisibilityConditions(filter, conditions, bind)
  conditions.push(getVisibleEventCondition('e'))

  const extraWhere = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''

  // events_fts.rank is the BM25 score (negative float — lower = more relevant)
  // ORDER BY rank ASC: most relevant first; created_at DESC breaks ties by recency
  const rows = await dbQuery<{ raw: string }>(`
    SELECT   e.raw
    FROM     events_fts
    ${joins.join('\n    ')}
    WHERE    events_fts MATCH ?
             ${extraWhere}
    ORDER BY events_fts.rank,
             e.created_at DESC,
             e.id DESC
    LIMIT    ?
  `, [...bind, limit])

  return _parseRaw(rows)
}

// ── Dedicated Search Functions ───────────────────────────────

export interface SearchEventsOptions {
  kinds?:   number[]
  authors?: string[]
  since?:   number
  until?:   number
  limit?:   number
}

export interface SemanticCandidateOptions extends SearchEventsOptions {}

/**
 * Full-text search over event content (NIP-50 local path).
 *
 * Equivalent to `queryEvents({ search, ...opts })` but with a cleaner call
 * signature for direct use by the search hook and search page.
 *
 * Returns [] if the query sanitizes to empty.
 */
export async function searchEvents(
  query: string,
  opts:  SearchEventsOptions = {},
): Promise<NostrEvent[]> {
  const parsed = parseSearchQuery(query)
  const limit = Math.min(opts.limit ?? 50, 500)
  const filter = {
    ...(opts.kinds   !== undefined ? { kinds:   opts.kinds }   : {}),
    ...(opts.authors !== undefined ? { authors: opts.authors } : {}),
    ...(opts.since   !== undefined ? { since:   opts.since }   : {}),
    ...(opts.until   !== undefined ? { until:   opts.until }   : {}),
  }

  if (parsed.localQuery !== null) {
    return _queryEventsFts(filter, parsed.localQuery, limit, {
      nip05Domains: parsed.domains,
    })
  }
  if (parsed.domains.length > 0) {
    return _queryEventsStandard(filter, limit, {
      nip05Domains: parsed.domains,
    })
  }

  return []
}

/**
 * Full-text search over profile metadata (name, display_name, about, nip05).
 *
 * Requires migration v3 (profiles_fts) to be applied — returns [] on older DBs.
 * Results ordered by BM25 relevance.
 */
export async function searchProfiles(
  query: string,
  limit = 20,
): Promise<Profile[]> {
  const parsed = parseSearchQuery(query)
  const cappedLimit = Math.min(limit, 200)
  const domainWhere = parsed.domains.length > 0
    ? `AND p.nip05_domain IN (${parsed.domains.map(() => '?').join(',')})`
    : ''

  if (parsed.localQuery === null && parsed.domains.length === 0) {
    return []
  }

  const rows = parsed.localQuery !== null
    ? await dbQuery<DBProfile>(`
      SELECT   p.pubkey, p.name, p.display_name, p.picture,
               p.event_id, p.banner, p.about, p.website,
               p.nip05, p.nip05_domain, p.nip05_verified,
               p.nip05_verified_at, p.nip05_last_checked_at,
               p.lud06, p.lud16, p.bot, p.birthday_json,
               p.external_identities, p.updated_at, p.raw
      FROM     profiles_fts
      JOIN     profiles p ON p.rowid = profiles_fts.rowid
      WHERE    profiles_fts MATCH ?
               ${domainWhere}
      ORDER BY profiles_fts.rank,
               p.updated_at DESC
      LIMIT    ?
    `, [parsed.localQuery, ...parsed.domains, cappedLimit]).catch(() => [] as DBProfile[])
    : await dbQuery<DBProfile>(`
      SELECT   p.pubkey, p.name, p.display_name, p.picture,
               p.event_id, p.banner, p.about, p.website,
               p.nip05, p.nip05_domain, p.nip05_verified,
               p.nip05_verified_at, p.nip05_last_checked_at,
               p.lud06, p.lud16, p.bot, p.birthday_json,
               p.external_identities, p.updated_at, p.raw
      FROM     profiles p
      WHERE    p.nip05_domain IN (${parsed.domains.map(() => '?').join(',')})
      ORDER BY p.updated_at DESC
      LIMIT    ?
    `, [...parsed.domains, cappedLimit]).catch(() => [] as DBProfile[])
  // .catch: profiles_fts may not exist yet on older DBs — degrade gracefully

  return rows.map(rowToProfile)
}

/** Recent event candidates for semantic reranking. */
export async function listSemanticEventCandidates(
  query: string,
  opts: SemanticCandidateOptions = {},
): Promise<NostrEvent[]> {
  const parsed = parseSearchQuery(query)
  const limit = Math.min(opts.limit ?? 300, 2_000)
  const filter = {
    ...(opts.kinds   !== undefined ? { kinds:   opts.kinds }   : {}),
    ...(opts.authors !== undefined ? { authors: opts.authors } : {}),
    ...(opts.since   !== undefined ? { since:   opts.since }   : {}),
    ...(opts.until   !== undefined ? { until:   opts.until }   : {}),
  }

  return _queryEventsStandard(filter, limit, {
    nip05Domains: parsed.domains,
  })
}

/** Recent profile candidates for semantic reranking. */
export async function listSemanticProfileCandidates(
  query: string,
  limit = 200,
): Promise<Profile[]> {
  const parsed = parseSearchQuery(query)
  const cappedLimit = Math.min(limit, 1_000)
  const domainWhere = parsed.domains.length > 0
    ? `WHERE p.nip05_domain IN (${parsed.domains.map(() => '?').join(',')})`
    : ''

  const rows = await dbQuery<DBProfile>(`
    SELECT   p.pubkey, p.name, p.display_name, p.picture,
             p.event_id, p.banner, p.about, p.website,
             p.nip05, p.nip05_domain, p.nip05_verified,
             p.nip05_verified_at, p.nip05_last_checked_at,
             p.lud06, p.lud16, p.bot, p.birthday_json,
             p.external_identities, p.updated_at, p.raw
    FROM     profiles p
    ${domainWhere}
    ORDER BY p.updated_at DESC
    LIMIT    ?
  `, [...parsed.domains, cappedLimit]).catch(() => [] as DBProfile[])

  return rows.map(rowToProfile)
}

export interface RecentHashtagStat {
  tag: string
  usageCount: number
  uniqueAuthorCount: number
  latestCreatedAt: number
}

export interface RecentTaggedEventsOptions extends SearchEventsOptions {}

function escapeSqlLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`)
}

export async function listRecentHashtagStats(
  opts: SearchEventsOptions & {
    prefix?: string
  } = {},
): Promise<RecentHashtagStat[]> {
  const conditions = [
    "t.name = 't'",
    'length(t.value) > 0',
    getVisibleEventCondition('e'),
  ]
  const bind: unknown[] = []

  if (opts.kinds?.length) {
    conditions.push(`e.kind IN (${opts.kinds.map(() => '?').join(',')})`)
    bind.push(...opts.kinds)
  }
  if (opts.authors?.length) {
    conditions.push(`e.pubkey IN (${opts.authors.map(() => '?').join(',')})`)
    bind.push(...opts.authors)
  }
  if (opts.since !== undefined) {
    conditions.push('e.created_at >= ?')
    bind.push(opts.since)
  }
  if (opts.until !== undefined) {
    conditions.push('e.created_at <= ?')
    bind.push(opts.until)
  }
  if (opts.prefix) {
    conditions.push("t.value LIKE ? ESCAPE '\\'")
    bind.push(`${escapeSqlLikePattern(opts.prefix)}%`)
  }

  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 300)
  const rows = await dbQuery<{
    tag: string
    usage_count: number
    unique_author_count: number
    latest_created_at: number
  }>(`
    SELECT   t.value AS tag,
             COUNT(DISTINCT t.event_id) AS usage_count,
             COUNT(DISTINCT e.pubkey) AS unique_author_count,
             MAX(e.created_at) AS latest_created_at
    FROM     tags t
    JOIN     events e
      ON     e.id = t.event_id
    WHERE    ${conditions.join('\n      AND ')}
    GROUP BY t.value
    ORDER BY usage_count DESC,
             latest_created_at DESC,
             unique_author_count DESC,
             t.value ASC
    LIMIT    ?
  `, [...bind, limit])

  return rows.map((row) => ({
    tag: row.tag,
    usageCount: Number(row.usage_count) || 0,
    uniqueAuthorCount: Number(row.unique_author_count) || 0,
    latestCreatedAt: Number(row.latest_created_at) || 0,
  }))
}

export async function listRecentTaggedEvents(
  opts: RecentTaggedEventsOptions = {},
): Promise<NostrEvent[]> {
  const conditions = [getVisibleEventCondition('e')]
  const bind: unknown[] = []

  if (opts.kinds?.length) {
    conditions.push(`e.kind IN (${opts.kinds.map(() => '?').join(',')})`)
    bind.push(...opts.kinds)
  }
  if (opts.authors?.length) {
    conditions.push(`e.pubkey IN (${opts.authors.map(() => '?').join(',')})`)
    bind.push(...opts.authors)
  }
  if (opts.since !== undefined) {
    conditions.push('e.created_at >= ?')
    bind.push(opts.since)
  }
  if (opts.until !== undefined) {
    conditions.push('e.created_at <= ?')
    bind.push(opts.until)
  }

  const rows = await dbQuery<{ raw: string }>(`
    SELECT e.raw
    FROM     events e
    WHERE    ${conditions.join('\n      AND ')}
      AND    EXISTS (
               SELECT 1
               FROM tags t
               WHERE t.event_id = e.id
                 AND t.name = 't'
                 AND length(t.value) > 0
             )
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT    ?
  `, [...bind, Math.min(Math.max(opts.limit ?? 240, 1), 600)])

  return _parseRaw(rows)
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Append NIP-01 tag filter conditions (#e, #p, #t, …).
 * Single-letter tags only per spec.
 */
function _appendTagConditions(
  filter:     NostrFilter,
  conditions: string[],
  bind:       unknown[],
): void {
  let idx = 0
  for (const [key, vals] of Object.entries(filter)) {
    if (!key.startsWith('#') || !Array.isArray(vals) || vals.length === 0) continue
    const tagName = key.slice(1)
    if (tagName.length !== 1) continue
    const alias = `tq${idx++}`
    conditions.push(`e.id IN (
      SELECT ${alias}.event_id FROM tags ${alias}
      WHERE  ${alias}.name = ? AND ${alias}.value IN (${vals.map(() => '?').join(',')})
    )`)
    bind.push(tagName, ...vals)
  }
}

/**
 * Append deduplication conditions for a single addressable long-form kind.
 *
 * Ensures:
 *   1. Every returned event of this kind has a non-empty `d` tag
 *   2. No newer event with the same pubkey + kind + `d` identifier exists
 *
 * Called once for kind-30023 and once for kind-30024.
 */
function _appendAddressableKindDedup(
  kind: number,
  conditions: string[],
  bind: unknown[],
  eventAlias: string,
): void {
  // Must have a valid `d` tag
  conditions.push(`(
    ${eventAlias}.kind != ?
    OR EXISTS (
      SELECT 1
      FROM tags lf_d
      WHERE lf_d.event_id = ${eventAlias}.id
        AND lf_d.name = 'd'
        AND length(lf_d.value) > 0
    )
  )`)
  bind.push(kind)

  // Must be the latest version (no newer event supersedes it)
  conditions.push(`(
    ${eventAlias}.kind != ?
    OR NOT EXISTS (
      SELECT 1
      FROM tags cur_d
      JOIN tags new_d
        ON new_d.name = 'd'
       AND new_d.value = cur_d.value
      JOIN events newer
        ON newer.id = new_d.event_id
      WHERE cur_d.event_id = ${eventAlias}.id
        AND cur_d.name = 'd'
        AND length(cur_d.value) > 0
        AND newer.kind = ?
        AND newer.pubkey = ${eventAlias}.pubkey
        AND ${getVisibleEventCondition('newer')}
        AND (
          newer.created_at > ${eventAlias}.created_at
          OR (newer.created_at = ${eventAlias}.created_at AND newer.id > ${eventAlias}.id)
        )
    )
  )`)
  bind.push(kind, kind)
}

function _appendAddressableContentVisibilityConditions(
  filter: NostrFilter,
  conditions: string[],
  bind: unknown[],
  eventAlias = 'e',
): void {
  const addressableKinds = [
    Kind.LongFormContent,
    Kind.LongFormDraft,
    Kind.AddressableVideo,
    Kind.AddressableShortVideo,
  ]

  const wantedKinds = addressableKinds.filter((kind) => (
    !filter.kinds || filter.kinds.includes(kind)
  ))

  if (wantedKinds.length === 0) return

  for (const kind of wantedKinds) {
    _appendAddressableKindDedup(kind, conditions, bind, eventAlias)
  }
}

/** Parse the `raw` JSON column back into NostrEvent objects, skipping malformed rows. */
function _parseRaw(rows: { raw: string }[]): NostrEvent[] {
  const events: NostrEvent[] = []
  for (const row of rows) {
    try { events.push(JSON.parse(row.raw) as NostrEvent) }
    catch { /* malformed row — skip, do not crash */ }
  }
  return events
}

/** Get a single event by ID */
export async function getEvent(id: string): Promise<NostrEvent | null> {
  const rows = await dbQuery<{ raw: string }>(
    `
      SELECT e.raw
      FROM events e
      WHERE e.id = ?
        AND ${getVisibleEventCondition('e')}
      LIMIT 1
    `,
    [id],
  )
  if (!rows[0]) return null
  try {
    return JSON.parse(rows[0].raw) as NostrEvent
  } catch {
    return null
  }
}

export async function getLatestAddressableEvent(
  pubkey: string,
  kind: number,
  identifier: string,
): Promise<NostrEvent | null> {
  const normalizedIdentifier = normalizeAddressIdentifier(identifier)
  if (!pubkey || !normalizedIdentifier || !isAddressableKind(kind)) return null

  const rows = await dbQuery<{ raw: string }>(`
    SELECT   e.raw
    FROM     events e
    WHERE    e.pubkey = ?
      AND    e.kind = ?
      AND    EXISTS (
               SELECT 1
               FROM tags d
               WHERE d.event_id = e.id
                 AND d.name = 'd'
                 AND d.value = ?
             )
      AND    ${getVisibleEventCondition('e')}
    ORDER BY e.created_at DESC,
             e.id DESC
    LIMIT    1
  `, [pubkey, kind, normalizedIdentifier])

  const row = rows[0]
  if (!row) return null

  try {
    return JSON.parse(row.raw) as NostrEvent
  } catch {
    return null
  }
}

/** Get the latest valid published (kind-30023) long-form event for a given address. */
export async function getLongFormEvent(
  pubkey: string,
  identifier: string,
): Promise<NostrEvent | null> {
  const longFormIdentifier = normalizeLongFormIdentifier(identifier)
  if (!pubkey || !longFormIdentifier) return null
  const event = await getLatestAddressableEvent(pubkey, Kind.LongFormContent, longFormIdentifier)
  return event && getLongFormIdentifier(event) ? event : null
}

/** Get the latest valid draft (kind-30024) long-form event for a given address. */
export async function getLongFormDraftEvent(
  pubkey: string,
  identifier: string,
): Promise<NostrEvent | null> {
  const longFormIdentifier = normalizeLongFormIdentifier(identifier)
  if (!pubkey || !longFormIdentifier) return null
  const event = await getLatestAddressableEvent(pubkey, Kind.LongFormDraft, longFormIdentifier)
  return event && getLongFormIdentifier(event) ? event : null
}

// ── Profile ──────────────────────────────────────────────────

/** Get a single cached profile by pubkey */
export async function getProfile(pubkey: string): Promise<Profile | null> {
  const rows = await dbQuery<DBProfile>(
    'SELECT * FROM profiles WHERE pubkey = ? LIMIT 1',
    [pubkey],
  )
  const row = rows[0]
  if (!row) return null
  return rowToProfile(row)
}

/** Get multiple profiles in a single query */
export async function getProfiles(pubkeys: string[]): Promise<Map<string, Profile>> {
  if (pubkeys.length === 0) return new Map()

  const placeholders = pubkeys.map(() => '?').join(',')
  const rows = await dbQuery<DBProfile>(
    `SELECT * FROM profiles WHERE pubkey IN (${placeholders})`,
    pubkeys,
  )

  const map = new Map<string, Profile>()
  for (const row of rows) {
    map.set(row.pubkey, rowToProfile(row))
  }
  return map
}

interface Nip05VerificationCandidateRow {
  pubkey: string
  nip05: string
  nip05_verified: number
  nip05_verified_at: number | null
  nip05_last_checked_at: number | null
}

export interface Nip05VerificationCandidate {
  pubkey: string
  nip05: string
  verified: boolean
  verifiedAt: number | null
  lastCheckedAt: number | null
}

function rowToNip05VerificationCandidate(
  row: Nip05VerificationCandidateRow,
): Nip05VerificationCandidate {
  return {
    pubkey: row.pubkey,
    nip05: row.nip05,
    verified: row.nip05_verified === 1,
    verifiedAt: row.nip05_verified_at,
    lastCheckedAt: row.nip05_last_checked_at,
  }
}

export async function getNip05VerificationCandidate(
  pubkey: string,
): Promise<Nip05VerificationCandidate | null> {
  const rows = await dbQuery<Nip05VerificationCandidateRow>(
    `
      SELECT pubkey, nip05, nip05_verified, nip05_verified_at, nip05_last_checked_at
      FROM profiles
      WHERE pubkey = ? AND nip05 IS NOT NULL
      LIMIT 1
    `,
    [pubkey],
  )
  const row = rows[0]
  return row ? rowToNip05VerificationCandidate(row) : null
}

export async function listNip05VerificationCandidates(
  limit = 12,
): Promise<Nip05VerificationCandidate[]> {
  const rows = await dbQuery<Nip05VerificationCandidateRow>(
    `
      SELECT pubkey, nip05, nip05_verified, nip05_verified_at, nip05_last_checked_at
      FROM profiles
      WHERE nip05 IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    [Math.min(Math.max(limit, 1), 50)],
  )

  return rows.map(rowToNip05VerificationCandidate)
}

export async function updateNip05Verification(
  pubkey: string,
  expectedNip05: string,
  params: {
    checkedAt: number
    normalizedNip05?: string
    verified: boolean | null
    verifiedAt?: number | null
    domain?: string | null
  },
): Promise<boolean> {
  const checkedAt = params.checkedAt
  const normalizedNip05 = params.normalizedNip05 ?? expectedNip05

  const changes = params.verified === null
    ? await dbRun(
      `
        UPDATE profiles
        SET
          nip05 = ?,
          nip05_last_checked_at = ?
        WHERE pubkey = ? AND nip05 = ?
      `,
      [normalizedNip05, checkedAt, pubkey, expectedNip05],
    )
    : await dbRun(
      `
        UPDATE profiles
        SET
          nip05 = ?,
          nip05_domain = ?,
          nip05_verified = ?,
          nip05_verified_at = ?,
          nip05_last_checked_at = ?
        WHERE pubkey = ? AND nip05 = ?
      `,
      [
        normalizedNip05,
        params.verified ? (params.domain ?? null) : null,
        params.verified ? 1 : 0,
        params.verified ? (params.verifiedAt ?? checkedAt) : null,
        checkedAt,
        pubkey,
        expectedNip05,
      ],
    )

  return changes > 0
}

function rowToProfile(row: DBProfile): Profile {
  const profile: Profile = {
    pubkey:    row.pubkey,
    updatedAt: row.updated_at,
  }
  if (row.event_id      !== null) profile.eventId      = row.event_id
  if (row.name         !== null) profile.name         = row.name
  if (row.display_name !== null) profile.display_name = row.display_name
  if (row.picture      !== null) profile.picture      = row.picture
  if (row.banner       !== null) profile.banner       = row.banner
  if (row.about        !== null) profile.about        = row.about
  if (row.website      !== null) profile.website      = row.website
  if (row.nip05        !== null) profile.nip05        = row.nip05
  profile.nip05Verified = row.nip05_verified === 1
  if (row.nip05_verified_at !== null) {
    profile.nip05VerifiedAt = row.nip05_verified_at
  }
  if (row.lud06        !== null) profile.lud06        = row.lud06
  if (row.lud16        !== null) profile.lud16        = row.lud16
  if (row.bot === 1) profile.bot = true
  if (row.birthday_json !== null) {
    try {
      const birthday = JSON.parse(row.birthday_json) as Profile['birthday']
      if (birthday && typeof birthday === 'object' && !Array.isArray(birthday)) {
        profile.birthday = birthday
      }
    } catch {
      // Ignore malformed legacy rows.
    }
  }
  if (row.external_identities !== null) {
    try {
      const parsedExt = JSON.parse(row.external_identities) as unknown
      if (Array.isArray(parsedExt)) {
        profile.externalIdentities = parsedExt as NonNullable<Profile['externalIdentities']>
      }
    } catch {
      // ignore malformed rows
    }
  }
  return profile
}

// ── Follows ──────────────────────────────────────────────────

function rowToContactListEntry(row: DBFollow): ContactListEntry {
  const relayUrl = normalizeContactRelayHint(row.relay_url)
  const petname = normalizeContactPetname(row.petname)

  return {
    pubkey: row.followee,
    position: row.position,
    ...(relayUrl ? { relayUrl } : {}),
    ...(petname ? { petname } : {}),
  }
}

export async function getContactList(pubkey: string): Promise<ContactList | null> {
  const [metaRows, entryRows] = await Promise.all([
    dbQuery<DBContactList>(
      'SELECT pubkey, event_id, updated_at FROM contact_lists WHERE pubkey = ? LIMIT 1',
      [pubkey],
    ),
    dbQuery<DBFollow>(
      `
        SELECT follower, followee, relay_url, petname, position, updated_at
        FROM follows
        WHERE follower = ?
        ORDER BY position ASC, followee ASC
      `,
      [pubkey],
    ),
  ])

  const meta = metaRows[0]
  if (!meta && entryRows.length === 0) return null

  const updatedAt = meta?.updated_at ?? (
    entryRows.length > 0 ? Math.max(...entryRows.map(row => row.updated_at)) : undefined
  )

  return {
    pubkey,
    entries: entryRows.map(rowToContactListEntry),
    ...(meta?.event_id ? { eventId: meta.event_id } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  }
}

export async function getEventReadRelayHints(pubkey: string, limit = 3): Promise<string[]> {
  const rows = await dbQuery<{ url: string }>(
    `
      SELECT url
      FROM relay_list
      WHERE pubkey = ? AND read = 1
      ORDER BY write DESC, url ASC
      LIMIT ?
    `,
    [pubkey, Math.min(Math.max(limit, 1), 12)],
  )

  return rows.map(row => row.url).filter(Boolean)
}

/** Get all pubkeys followed by `pubkey` */
export async function getFollows(pubkey: string): Promise<string[]> {
  const rows = await dbQuery<{ followee: string }>(
    `
      SELECT followee
      FROM follows
      WHERE follower = ?
      ORDER BY position ASC, followee ASC
    `,
    [pubkey],
  )
  return rows.map(r => r.followee)
}

/** Check whether `follower` follows `followee` */
export async function isFollowing(follower: string, followee: string): Promise<boolean> {
  const rows = await dbQuery<{ followee: string }>(
    `
      SELECT followee
      FROM follows
      WHERE follower = ? AND followee = ?
      LIMIT 1
    `,
    [follower, followee],
  )
  return rows.length > 0
}

async function listEventsReferencingEvent(
  kind: number,
  eventId: string,
  limit = 400,
): Promise<NostrEvent[]> {
  const rows = await dbQuery<{ raw: string }>(
    `
      SELECT e.raw
      FROM events e
      WHERE e.kind = ?
        AND ${getVisibleEventCondition('e')}
        AND EXISTS (
          SELECT 1
          FROM tags t
          WHERE t.event_id = e.id
            AND t.name = 'e'
            AND t.value = ?
        )
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ?
    `,
    [kind, eventId, Math.min(Math.max(limit, 1), 800)],
  )

  return _parseRaw(rows)
}

export interface ListPollVoteEventsOptions {
  authors?: string[]
  since?: number
  until?: number
}

export async function listPollVoteEvents(
  pollEventId: string,
  options: ListPollVoteEventsOptions = {},
): Promise<NostrEvent[]> {
  const conditions = [
    'e.kind = ?',
    getVisibleEventCondition('e'),
  ]
  const bind: unknown[] = [Kind.PollVote]

  if (options.authors?.length) {
    conditions.push(`e.pubkey IN (${options.authors.map(() => '?').join(',')})`)
    bind.push(...options.authors)
  }

  if (options.since !== undefined) {
    conditions.push('e.created_at >= ?')
    bind.push(options.since)
  }

  if (options.until !== undefined) {
    conditions.push('e.created_at <= ?')
    bind.push(options.until)
  }

  const rows = await dbQuery<{ raw: string }>(`
    SELECT e.raw
    FROM events e
    WHERE ${conditions.join('\n      AND ')}
      AND EXISTS (
        SELECT 1
        FROM tags t
        WHERE t.event_id = e.id
          AND t.name = ?
          AND t.value = ?
      )
    ORDER BY e.created_at DESC, e.id DESC
  `, [...bind, 'e', pollEventId])

  return _parseRaw(rows)
}

export async function getEventEngagementSummary(
  eventId: string,
  currentUserPubkey?: string,
): Promise<EventEngagementSummary> {
  const [kind6Reposts, kind16Reposts, reactionCandidates, zapCandidates, replyRows] = await Promise.all([
    listEventsReferencingEvent(Kind.Repost, eventId),
    listEventsReferencingEvent(Kind.GenericRepost, eventId),
    listEventsReferencingEvent(Kind.Reaction, eventId),
    listEventsReferencingEvent(Kind.Zap, eventId),
    dbQuery<{ reply_count: number }>(
      `
        SELECT COUNT(DISTINCT e.id) AS reply_count
        FROM events e
        WHERE e.kind IN (?, ?)
          AND ${getVisibleEventCondition('e')}
          AND EXISTS (
            SELECT 1
            FROM tags t
            WHERE t.event_id = e.id
              AND t.name = 'e'
              AND t.value = ?
          )
      `,
      [Kind.ShortNote, Kind.Comment, eventId],
    ),
  ])
  const repostCandidates = [...kind6Reposts, ...kind16Reposts]

  const reposts = repostCandidates
    .map(parseRepostEvent)
    .filter((parsed): parsed is NonNullable<ReturnType<typeof parseRepostEvent>> =>
      parsed !== null && parsed.targetEventId === eventId,
    )

  const reactions = reactionCandidates
    .map(parseReactionEvent)
    .filter((parsed): parsed is NonNullable<ReturnType<typeof parseReactionEvent>> =>
      parsed !== null && parsed.targetEventId === eventId,
    )

  let likeCount = 0
  let dislikeCount = 0
  const emojiMap = new Map<string, ReactionAggregate>()

  for (const reaction of reactions) {
    if (reaction.type === 'like') {
      likeCount++
      continue
    }
    if (reaction.type === 'dislike') {
      dislikeCount++
      continue
    }
    if (reaction.type === 'emoji' || reaction.type === 'custom-emoji') {
      const key = reaction.type === 'custom-emoji'
        ? `:${reaction.emojiName}:`
        : reaction.content
      const label = reaction.type === 'custom-emoji'
        ? `:${reaction.emojiName}:`
        : reaction.content
      const existing = emojiMap.get(key)
      emojiMap.set(key, {
        key,
        label,
        count: (existing?.count ?? 0) + 1,
        type: reaction.type,
        ...(reaction.emojiUrl ? { emojiUrl: reaction.emojiUrl } : {}),
      })
    }
  }

  const emojiReactions = [...emojiMap.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 6)

  const zaps = zapCandidates
    .map(parseZapReceipt)
    .filter((z): z is NonNullable<ReturnType<typeof parseZapReceipt>> =>
      z !== null && z.targetEventId === eventId,
    )

  return {
    replyCount: replyRows[0]?.reply_count ?? 0,
    repostCount: reposts.length,
    reactionCount: reactions.length,
    likeCount,
    dislikeCount,
    emojiReactions,
    zapCount: zaps.length,
    zapTotalMsats: sumZapMsats(zaps),
    currentUserHasReposted: Boolean(
      currentUserPubkey && reposts.some(repost => repost.pubkey === currentUserPubkey),
    ),
    currentUserHasLiked: Boolean(
      currentUserPubkey &&
      reactions.some(reaction => reaction.pubkey === currentUserPubkey && reaction.type === 'like'),
    ),
    currentUserHasDisliked: Boolean(
      currentUserPubkey &&
      reactions.some(reaction => reaction.pubkey === currentUserPubkey && reaction.type === 'dislike'),
    ),
  }
}

// ── Maintenance ──────────────────────────────────────────────

/**
 * Prune seen_events entries older than 24 hours and run an incremental
 * vacuum pass. Safe to call periodically in the background.
 */
export async function runMaintenance(): Promise<void> {
  const cutoffSeconds = Math.floor(Date.now() / 1000) - 86_400

  await dbRun(
    'DELETE FROM seen_events WHERE seen_at < ?',
    [cutoffSeconds],
  )

  // Incremental vacuum reclaims free pages without locking the DB
  await dbRun('PRAGMA incremental_vacuum(100)')
  await dbRun('PRAGMA optimize')
}
