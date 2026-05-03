/**
 * SQLite-backed cross-session caches.
 *
 * These tables hold derived data (moderation decisions, parsed mute lists,
 * feed cursors, profile-repair attempts) that previously lived only in
 * process memory or `localStorage`. Persisting them keeps the local-first
 * UX consistent across reloads:
 *   - moderation decisions don't get re-derived on every page load,
 *   - mute state shows up immediately for returning users without waiting
 *     for the relay round-trip,
 *   - feed subscriptions can resume from a known watermark instead of
 *     re-streaming events we already have, and
 *   - one-shot profile repairs don't re-fire every session.
 *
 * Schema: see `MIGRATION_V13_SQL` in `src/workers/db.worker.ts`.
 */

import { dbQuery, dbRun, dbTransaction } from './client'
import type { ModerationDecision, ModerationScores } from '@/types'

// ── Moderation Decisions ──────────────────────────────────────────────────

interface ModerationDecisionRow {
  document_id: string
  cache_key: string
  document_kind: string
  action: string
  reason: string | null
  model: string
  policy_version: string
  scores_json: string
}

function rowToModerationDecision(row: ModerationDecisionRow): ModerationDecision | null {
  if (row.action !== 'allow' && row.action !== 'block') return null
  let scores: ModerationScores
  try {
    const parsed = JSON.parse(row.scores_json) as Partial<ModerationScores>
    scores = {
      toxic: Number(parsed.toxic ?? 0),
      severe_toxic: Number(parsed.severe_toxic ?? 0),
      obscene: Number(parsed.obscene ?? 0),
      threat: Number(parsed.threat ?? 0),
      insult: Number(parsed.insult ?? 0),
      identity_hate: Number(parsed.identity_hate ?? 0),
    }
  } catch {
    return null
  }
  return {
    id: row.document_id,
    action: row.action,
    reason: row.reason,
    scores,
    model: row.model,
    policyVersion: row.policy_version,
  }
}

export interface PersistedModerationDecision {
  decision: ModerationDecision
  cacheKey: string
}

/** Read-through bulk lookup. Returns a map keyed by `${documentId}:${cacheKey}`. */
export async function getPersistedModerationDecisions(
  pairs: Array<{ documentId: string; cacheKey: string }>,
): Promise<Map<string, ModerationDecision>> {
  if (pairs.length === 0) return new Map()

  const placeholders = pairs.map(() => '(?, ?)').join(',')
  const bind: unknown[] = []
  for (const pair of pairs) {
    bind.push(pair.documentId, pair.cacheKey)
  }

  const rows = await dbQuery<ModerationDecisionRow>(
    `
      SELECT document_id, cache_key, document_kind, action, reason,
             model, policy_version, scores_json
      FROM moderation_decisions
      WHERE (document_id, cache_key) IN (VALUES ${placeholders})
    `,
    bind,
  )

  const out = new Map<string, ModerationDecision>()
  for (const row of rows) {
    const decision = rowToModerationDecision(row)
    if (decision) out.set(`${row.document_id}:${row.cache_key}`, decision)
  }
  return out
}

export interface SaveModerationDecisionInput {
  documentId: string
  cacheKey: string
  documentKind: 'event' | 'profile' | 'syndication-entry' | string
  decision: ModerationDecision
}

/**
 * Upsert a batch of moderation decisions in a single transaction so the
 * write cost is amortised across all newly resolved documents.
 */
export async function savePersistedModerationDecisions(
  inputs: SaveModerationDecisionInput[],
): Promise<void> {
  if (inputs.length === 0) return

  const ops = inputs.map((input) => ({
    sql: `
      INSERT INTO moderation_decisions
        (document_id, cache_key, document_kind, action, reason,
         model, policy_version, scores_json, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(document_id, cache_key) DO UPDATE SET
        document_kind  = excluded.document_kind,
        action         = excluded.action,
        reason         = excluded.reason,
        model          = excluded.model,
        policy_version = excluded.policy_version,
        scores_json    = excluded.scores_json,
        decided_at     = excluded.decided_at
    `,
    bind: [
      input.documentId,
      input.cacheKey,
      input.documentKind,
      input.decision.action,
      input.decision.reason,
      input.decision.model,
      input.decision.policyVersion,
      JSON.stringify(input.decision.scores),
    ] as unknown[],
  }))

  await dbTransaction(ops)
}

const MODERATION_RETENTION_SECONDS = 60 * 60 * 24 * 30 // 30 days

/** Background hygiene — drop decisions older than the retention window. */
export async function pruneModerationDecisions(): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - MODERATION_RETENTION_SECONDS
  await dbRun('DELETE FROM moderation_decisions WHERE decided_at < ?', [cutoff])
}

// ── Mute List Cache ───────────────────────────────────────────────────────

export interface CachedMuteListPersisted {
  pubkeys: string[]
  words: string[]
  hashtags: string[]
  eventId: string | null
  updatedAt: number
}

interface MuteListRow {
  pubkey: string
  event_id: string | null
  pubkeys_json: string
  words_json: string
  hashtags_json: string
  updated_at: number
}

function safeJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

export async function getCachedMuteList(
  pubkey: string,
): Promise<CachedMuteListPersisted | null> {
  const rows = await dbQuery<MuteListRow>(
    `
      SELECT pubkey, event_id, pubkeys_json, words_json, hashtags_json, updated_at
      FROM mute_lists_cache
      WHERE pubkey = ?
      LIMIT 1
    `,
    [pubkey],
  )
  const row = rows[0]
  if (!row) return null
  return {
    pubkeys: safeJsonStringArray(row.pubkeys_json),
    words: safeJsonStringArray(row.words_json),
    hashtags: safeJsonStringArray(row.hashtags_json),
    eventId: row.event_id,
    updatedAt: row.updated_at,
  }
}

export async function saveCachedMuteList(
  pubkey: string,
  state: {
    pubkeys: string[]
    words: string[]
    hashtags: string[]
    eventId: string | null
    updatedAt: number
  },
): Promise<void> {
  await dbRun(
    `
      INSERT INTO mute_lists_cache
        (pubkey, event_id, pubkeys_json, words_json, hashtags_json,
         updated_at, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(pubkey) DO UPDATE SET
        event_id      = excluded.event_id,
        pubkeys_json  = excluded.pubkeys_json,
        words_json    = excluded.words_json,
        hashtags_json = excluded.hashtags_json,
        updated_at    = excluded.updated_at,
        saved_at      = excluded.saved_at
    `,
    [
      pubkey,
      state.eventId,
      JSON.stringify(state.pubkeys),
      JSON.stringify(state.words),
      JSON.stringify(state.hashtags),
      state.updatedAt,
    ],
  )
}

// ── Feed Cursors ──────────────────────────────────────────────────────────

export interface FeedCursor {
  scopeKey: string
  sinceTs: number
  lastEventId: string | null
  signature: string | null
  updatedAt: number
}

interface FeedCursorRow {
  scope_key: string
  since_ts: number
  last_event_id: string | null
  signature: string | null
  updated_at: number
}

export async function getFeedCursor(scopeKey: string): Promise<FeedCursor | null> {
  const rows = await dbQuery<FeedCursorRow>(
    `
      SELECT scope_key, since_ts, last_event_id, signature, updated_at
      FROM feed_cursors
      WHERE scope_key = ?
      LIMIT 1
    `,
    [scopeKey],
  )
  const row = rows[0]
  if (!row) return null
  return {
    scopeKey: row.scope_key,
    sinceTs: row.since_ts,
    lastEventId: row.last_event_id,
    signature: row.signature,
    updatedAt: row.updated_at,
  }
}

export async function setFeedCursor(input: {
  scopeKey: string
  sinceTs: number
  lastEventId?: string | null
  signature?: string | null
}): Promise<void> {
  await dbRun(
    `
      INSERT INTO feed_cursors (scope_key, since_ts, last_event_id, signature, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(scope_key) DO UPDATE SET
        since_ts      = MAX(feed_cursors.since_ts, excluded.since_ts),
        last_event_id = excluded.last_event_id,
        signature     = excluded.signature,
        updated_at    = excluded.updated_at
    `,
    [
      input.scopeKey,
      input.sinceTs,
      input.lastEventId ?? null,
      input.signature ?? null,
    ],
  )
}

// ── Profile Repair Log ────────────────────────────────────────────────────

export type ProfileRepairKind = 'metadata-fields' | 'banner-recover' | string

export async function hasAttemptedProfileRepair(
  pubkey: string,
  eventId: string,
  repairKind: ProfileRepairKind,
): Promise<boolean> {
  const rows = await dbQuery<{ attempted_at: number }>(
    `
      SELECT attempted_at
      FROM profile_repair_log
      WHERE pubkey = ? AND event_id = ? AND repair_kind = ?
      LIMIT 1
    `,
    [pubkey, eventId, repairKind],
  )
  return rows.length > 0
}

export async function recordProfileRepairAttempt(
  pubkey: string,
  eventId: string,
  repairKind: ProfileRepairKind,
): Promise<void> {
  await dbRun(
    `
      INSERT OR IGNORE INTO profile_repair_log (pubkey, event_id, repair_kind)
      VALUES (?, ?, ?)
    `,
    [pubkey, eventId, repairKind],
  )
}
