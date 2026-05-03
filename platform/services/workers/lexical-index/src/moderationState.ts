import type { Pool } from 'pg';
import {
  INTERNAL_SYSTEM_KEYWORD_REASON,
  INTERNAL_SYSTEM_POLICY_VERSION,
  normalizeModerationReason,
  scoreInternalModerationRisk,
  type InternalPolicyMatchInput,
} from '@nostr-paper/content-policy';

export const TAGR_POLICY_VERSION = process.env.TAGR_POLICY_VERSION || 'tagr-v1';
export const TRUSTED_MODERATION_POLICY_VERSION = process.env.TRUSTED_MODERATION_POLICY_VERSION || 'trusted-moderation-v1';

const DEFAULT_TAGR_RELAY_URL = (process.env.TAGR_RELAY_URL || 'wss://relay.nos.social').trim();
const DEFAULT_TAGR_BOT_PUBKEY = (process.env.TAGR_BOT_PUBKEY || '56d4b3d6310fadb7294b7f041aab469c5ffc8991b1b1b331981b96a246f6ae65').toLowerCase();

const TRUSTED_SEVERE_REASONS = new Set(
  String(process.env.TRUSTED_MODERATION_SEVERE_REASONS || 'child_safety,illegal_content,violence,threat,identity_hate')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

const TRUSTED_SEVERE_MIN_SOURCES = Number(process.env.TRUSTED_MODERATION_SEVERE_MIN_SOURCES || 2);
const TRUSTED_SEVERE_MIN_WEIGHT = Number(process.env.TRUSTED_MODERATION_SEVERE_MIN_WEIGHT || 2);
const TRUSTED_STANDARD_MIN_WEIGHT = Number(process.env.TRUSTED_MODERATION_STANDARD_MIN_WEIGHT || 1);

interface RawNostrEventLike {
  created_at?: number;
  content?: string;
  tags?: string[][];
}

export interface TrustedModerationFeed {
  sourceId: string;
  relayUrl: string;
  pubkey: string;
  trustWeight: number;
  label: string;
}

export interface ShadowModerationScoreInput {
  eventId: string;
  modelName: string;
  modelVersion: string;
  score: number;
  recommendedAction: 'allow' | 'block';
  policyAction: 'allow' | 'block';
  reasons: string[];
  meta?: Record<string, unknown>;
}

function normalizeRelayUrl(url: string | null | undefined): string {
  const trimmed = String(url || '').trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function feedSourceId(relayUrl: string, pubkey: string): string {
  return `${normalizeRelayUrl(relayUrl) || '*'}|${pubkey.toLowerCase()}`;
}

function parseTrustedModerationFeeds(): TrustedModerationFeed[] {
  const feeds = new Map<string, TrustedModerationFeed>();

  const registerFeed = (relayUrl: string, pubkey: string, trustWeight: number, label: string) => {
    const normalizedPubkey = pubkey.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalizedPubkey)) return;

    const normalizedRelayUrl = normalizeRelayUrl(relayUrl);
    const sourceId = feedSourceId(normalizedRelayUrl, normalizedPubkey);

    feeds.set(sourceId, {
      sourceId,
      relayUrl: normalizedRelayUrl || '*',
      pubkey: normalizedPubkey,
      trustWeight: Number.isFinite(trustWeight) && trustWeight > 0 ? trustWeight : 1,
      label: label.trim() || sourceId,
    });
  };

  registerFeed(
    DEFAULT_TAGR_RELAY_URL,
    DEFAULT_TAGR_BOT_PUBKEY,
    Number(process.env.TAGR_TRUST_WEIGHT || 1),
    'tagr',
  );

  const fromEnv = String(process.env.TRUSTED_MODERATION_FEEDS || '').trim();
  if (fromEnv) {
    for (const entry of fromEnv.split(';').map((part) => part.trim()).filter(Boolean)) {
      const [relayUrl = '*', pubkey = '', weight = '1', label = 'trusted-feed'] = entry.split('|').map((value) => value.trim());
      registerFeed(relayUrl, pubkey, Number(weight), label);
    }
  }

  return [...feeds.values()];
}

export const TRUSTED_MODERATION_FEEDS = Object.freeze(parseTrustedModerationFeeds());

function firstTagValue(tags: string[][], tagName: string): string | null {
  const tag = tags.find((entry) => entry[0] === tagName && entry[1]);
  return tag?.[1] ?? null;
}

function extractHashtags(tags: string[][]): string[] {
  return tags
    .filter((entry) => entry[0] === 't' && typeof entry[1] === 'string' && entry[1].trim().length > 0)
    .map((entry) => entry[1].trim());
}

export function buildKeywordPolicyInput(event: RawNostrEventLike): InternalPolicyMatchInput {
  const tags = Array.isArray(event.tags) ? event.tags : [];

  return {
    content: event.content || '',
    title: firstTagValue(tags, 'title'),
    summary: firstTagValue(tags, 'summary'),
    alt: firstTagValue(tags, 'alt'),
    hashtags: extractHashtags(tags),
  };
}

export function evaluateKeywordBlock(event: RawNostrEventLike): { reason: string; policyVersion: string; blockedAtIso: string; score: number; reasons: string[] } | null {
  const input = buildKeywordPolicyInput(event);
  const risk = scoreInternalModerationRisk(input);
  if (risk.score < risk.threshold) return null;

  const createdAtMs = typeof event.created_at === 'number' && Number.isFinite(event.created_at)
    ? event.created_at * 1000
    : Date.now();

  return {
    reason: normalizeModerationReason(INTERNAL_SYSTEM_KEYWORD_REASON, 'keyword'),
    policyVersion: INTERNAL_SYSTEM_POLICY_VERSION,
    blockedAtIso: new Date(createdAtMs).toISOString(),
    score: risk.score,
    reasons: [
      ...(risk.topCategory ? [`category:${risk.topCategory}`] : []),
      ...risk.matchedTerms,
      ...risk.matchedDomains,
      ...risk.flags,
    ],
  };
}

export function normalizeTagrReason(reason: string): string {
  return normalizeModerationReason(reason, 'tagr');
}

export function reasonSeverity(reason: string): 'severe' | 'standard' {
  return TRUSTED_SEVERE_REASONS.has(reason) ? 'severe' : 'standard';
}

export function resolveTrustedModerationFeed(event: { pubkey: string; source?: { relay_url?: string | null } | null }): TrustedModerationFeed | null {
  const pubkey = (event.pubkey || '').toLowerCase();
  if (!pubkey) return null;

  const relayUrl = normalizeRelayUrl(event.source?.relay_url || '');

  for (const feed of TRUSTED_MODERATION_FEEDS) {
    if (feed.pubkey !== pubkey) continue;
    if (feed.relayUrl !== '*' && relayUrl && feed.relayUrl !== relayUrl) continue;
    return feed;
  }

  if (!relayUrl) {
    return TRUSTED_MODERATION_FEEDS.find((feed) => feed.pubkey === pubkey) || null;
  }

  return null;
}

export async function ensureModerationStateSchema(pg: Pool): Promise<void> {
  await pg.query(
    `
    CREATE TABLE IF NOT EXISTS tagr_blocks (
      event_id        text PRIMARY KEY,
      reason          text NOT NULL,
      source_event_id text NOT NULL,
      source_pubkey   text NOT NULL,
      blocked_at      timestamptz NOT NULL,
      updated_at      timestamptz NOT NULL DEFAULT now()
    )
    `,
  );

  await pg.query(`ALTER TABLE tagr_blocks ADD COLUMN IF NOT EXISTS policy_version text NOT NULL DEFAULT '${TAGR_POLICY_VERSION}'`);

  await pg.query(
    `
    CREATE INDEX IF NOT EXISTS idx_tagr_blocks_blocked_at
      ON tagr_blocks (blocked_at DESC)
    `,
  );

  await pg.query(
    `
    CREATE TABLE IF NOT EXISTS moderation_signals (
      id               bigserial PRIMARY KEY,
      target_event_id  text NOT NULL,
      reason           text NOT NULL,
      severity         text NOT NULL,
      source_id        text NOT NULL,
      source_label     text NOT NULL,
      source_event_id  text NOT NULL,
      source_pubkey    text NOT NULL,
      source_relay_url text,
      trust_weight     numeric NOT NULL,
      policy_version   text NOT NULL,
      blocked_at       timestamptz NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      UNIQUE (target_event_id, source_id, source_event_id)
    )
    `,
  );

  await pg.query(
    `
    CREATE INDEX IF NOT EXISTS idx_moderation_signals_target
      ON moderation_signals (target_event_id, blocked_at DESC)
    `,
  );

  await pg.query(
    `
    CREATE INDEX IF NOT EXISTS idx_moderation_signals_reason
      ON moderation_signals (reason, severity, blocked_at DESC)
    `,
  );

  await pg.query(
    `
    CREATE TABLE IF NOT EXISTS keyword_blocks (
      event_id        text PRIMARY KEY,
      reason          text NOT NULL,
      policy_version  text NOT NULL,
      blocked_at      timestamptz NOT NULL,
      updated_at      timestamptz NOT NULL DEFAULT now()
    )
    `,
  );

  await pg.query(
    `
    CREATE INDEX IF NOT EXISTS idx_keyword_blocks_policy_version
      ON keyword_blocks (policy_version, blocked_at DESC)
    `,
  );

  await pg.query(
    `
    CREATE TABLE IF NOT EXISTS moderation_shadow_scores (
      event_id           text NOT NULL,
      model_name         text NOT NULL,
      model_version      text NOT NULL,
      score              numeric NOT NULL,
      recommended_action text NOT NULL,
      policy_action      text NOT NULL,
      reasons            text[] NOT NULL DEFAULT '{}',
      agrees_with_policy boolean NOT NULL,
      meta               jsonb,
      scored_at          timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (event_id, model_name)
    )
    `,
  );
}

export async function upsertKeywordBlock(
  pg: Pool,
  eventId: string,
  decision: { reason: string; policyVersion: string; blockedAtIso: string },
): Promise<void> {
  await pg.query(
    `
    INSERT INTO keyword_blocks (event_id, reason, policy_version, blocked_at)
    VALUES ($1, $2, $3, $4::timestamptz)
    ON CONFLICT (event_id) DO UPDATE
    SET
      reason = EXCLUDED.reason,
      policy_version = EXCLUDED.policy_version,
      blocked_at = EXCLUDED.blocked_at,
      updated_at = now()
    `,
    [eventId, decision.reason, decision.policyVersion, decision.blockedAtIso],
  );
}

function shouldBlockByQuorum(severity: 'severe' | 'standard', sourceCount: number, trustWeight: number): boolean {
  if (severity === 'severe') {
    return sourceCount >= TRUSTED_SEVERE_MIN_SOURCES && trustWeight >= TRUSTED_SEVERE_MIN_WEIGHT;
  }

  return trustWeight >= TRUSTED_STANDARD_MIN_WEIGHT;
}

async function recomputeTrustedBlockForTarget(pg: Pool, targetEventId: string): Promise<void> {
  const aggregation = await pg.query<{
    reason: string;
    severity: 'severe' | 'standard';
    source_count: number;
    trust_weight: number;
    blocked_at: string;
  }>(
    `
    SELECT
      reason,
      severity,
      COUNT(DISTINCT source_id)::int AS source_count,
      COALESCE(SUM(trust_weight), 0)::float8 AS trust_weight,
      MAX(blocked_at)::text AS blocked_at
    FROM moderation_signals
    WHERE target_event_id = $1
    GROUP BY reason, severity
    `,
    [targetEventId],
  );

  const winningCandidate = aggregation.rows
    .map((row) => ({
      ...row,
      shouldBlock: shouldBlockByQuorum(row.severity, row.source_count, row.trust_weight),
    }))
    .filter((row) => row.shouldBlock)
    .sort((a, b) => {
      if (b.trust_weight !== a.trust_weight) return b.trust_weight - a.trust_weight;
      if (b.source_count !== a.source_count) return b.source_count - a.source_count;
      return Date.parse(b.blocked_at) - Date.parse(a.blocked_at);
    })[0];

  if (!winningCandidate) {
    await pg.query(`DELETE FROM tagr_blocks WHERE event_id = $1`, [targetEventId]);
    return;
  }

  const source = await pg.query<{
    source_event_id: string;
    source_pubkey: string;
    blocked_at: string;
  }>(
    `
    SELECT source_event_id, source_pubkey, blocked_at::text
    FROM moderation_signals
    WHERE target_event_id = $1 AND reason = $2
    ORDER BY blocked_at DESC
    LIMIT 1
    `,
    [targetEventId, winningCandidate.reason],
  );

  const latestSource = source.rows[0];
  if (!latestSource) {
    await pg.query(`DELETE FROM tagr_blocks WHERE event_id = $1`, [targetEventId]);
    return;
  }

  await pg.query(
    `
    INSERT INTO tagr_blocks (event_id, reason, source_event_id, source_pubkey, blocked_at, policy_version)
    VALUES ($1, $2, $3, $4, $5::timestamptz, $6)
    ON CONFLICT (event_id) DO UPDATE
    SET
      reason = EXCLUDED.reason,
      source_event_id = EXCLUDED.source_event_id,
      source_pubkey = EXCLUDED.source_pubkey,
      blocked_at = EXCLUDED.blocked_at,
      policy_version = EXCLUDED.policy_version,
      updated_at = now()
    `,
    [
      targetEventId,
      winningCandidate.reason,
      latestSource.source_event_id,
      latestSource.source_pubkey,
      latestSource.blocked_at,
      TRUSTED_MODERATION_POLICY_VERSION,
    ],
  );
}

export async function applyTrustedModerationSignals(
  pg: Pool,
  input: {
    targetEventIds: string[];
    reason: string;
    sourceEventId: string;
    sourcePubkey: string;
    sourceRelayUrl: string | null;
    blockedAtIso: string;
    feed: TrustedModerationFeed;
  },
): Promise<void> {
  const severity = reasonSeverity(input.reason);

  await pg.query(
    `
    INSERT INTO moderation_signals (
      target_event_id,
      reason,
      severity,
      source_id,
      source_label,
      source_event_id,
      source_pubkey,
      source_relay_url,
      trust_weight,
      policy_version,
      blocked_at
    )
    SELECT
      target_id,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11::timestamptz
    FROM unnest($1::text[]) AS target_id
    ON CONFLICT (target_event_id, source_id, source_event_id) DO UPDATE
    SET
      reason = EXCLUDED.reason,
      severity = EXCLUDED.severity,
      source_label = EXCLUDED.source_label,
      source_pubkey = EXCLUDED.source_pubkey,
      source_relay_url = EXCLUDED.source_relay_url,
      trust_weight = EXCLUDED.trust_weight,
      policy_version = EXCLUDED.policy_version,
      blocked_at = GREATEST(moderation_signals.blocked_at, EXCLUDED.blocked_at),
      updated_at = now()
    `,
    [
      input.targetEventIds,
      input.reason,
      severity,
      input.feed.sourceId,
      input.feed.label,
      input.sourceEventId,
      input.sourcePubkey,
      normalizeRelayUrl(input.sourceRelayUrl),
      input.feed.trustWeight,
      TRUSTED_MODERATION_POLICY_VERSION,
      input.blockedAtIso,
    ],
  );

  for (const targetEventId of input.targetEventIds) {
    await recomputeTrustedBlockForTarget(pg, targetEventId);
  }
}

export async function upsertShadowModerationScore(pg: Pool, input: ShadowModerationScoreInput): Promise<void> {
  await pg.query(
    `
    INSERT INTO moderation_shadow_scores (
      event_id,
      model_name,
      model_version,
      score,
      recommended_action,
      policy_action,
      reasons,
      agrees_with_policy,
      meta
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9::jsonb)
    ON CONFLICT (event_id, model_name) DO UPDATE
    SET
      model_version = EXCLUDED.model_version,
      score = EXCLUDED.score,
      recommended_action = EXCLUDED.recommended_action,
      policy_action = EXCLUDED.policy_action,
      reasons = EXCLUDED.reasons,
      agrees_with_policy = EXCLUDED.agrees_with_policy,
      meta = EXCLUDED.meta,
      scored_at = now()
    `,
    [
      input.eventId,
      input.modelName,
      input.modelVersion,
      input.score,
      input.recommendedAction,
      input.policyAction,
      input.reasons,
      input.recommendedAction === input.policyAction,
      JSON.stringify(input.meta || {}),
    ],
  );
}

export async function reconcileSearchDocModerationState(pg: Pool): Promise<void> {
  await pg.query(
    `
    UPDATE search_docs sd
    SET moderation_state = CASE
      WHEN EXISTS (SELECT 1 FROM keyword_blocks kb WHERE kb.event_id = sd.event_id) THEN 'blocked'
      WHEN EXISTS (SELECT 1 FROM tagr_blocks tb WHERE tb.event_id = sd.event_id) THEN 'blocked'
      ELSE 'allowed'
    END
    `,
  );
}

export async function reconcileSearchDocModerationStateForEvents(pg: Pool, eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;

  await pg.query(
    `
    UPDATE search_docs sd
    SET moderation_state = CASE
      WHEN EXISTS (SELECT 1 FROM keyword_blocks kb WHERE kb.event_id = sd.event_id) THEN 'blocked'
      WHEN EXISTS (SELECT 1 FROM tagr_blocks tb WHERE tb.event_id = sd.event_id) THEN 'blocked'
      ELSE 'allowed'
    END
    WHERE sd.event_id = ANY($1::text[])
    `,
    [eventIds],
  );
}
