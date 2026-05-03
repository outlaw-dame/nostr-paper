import type { Pool } from 'pg';
import {
  INTERNAL_SYSTEM_KEYWORD_REASON,
  INTERNAL_SYSTEM_POLICY_VERSION,
  matchesInternalSystemKeywordPolicy,
  normalizeModerationReason,
  type InternalPolicyMatchInput,
} from '@nostr-paper/content-policy';

export const TAGR_POLICY_VERSION = process.env.TAGR_POLICY_VERSION || 'tagr-v1';

interface RawNostrEventLike {
  created_at?: number;
  content?: string;
  tags?: string[][];
}

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

export function evaluateKeywordBlock(event: RawNostrEventLike): { reason: string; policyVersion: string; blockedAtIso: string } | null {
  const input = buildKeywordPolicyInput(event);
  if (!matchesInternalSystemKeywordPolicy(input)) return null;

  const createdAtMs = typeof event.created_at === 'number' && Number.isFinite(event.created_at)
    ? event.created_at * 1000
    : Date.now();

  return {
    reason: normalizeModerationReason(INTERNAL_SYSTEM_KEYWORD_REASON, 'keyword'),
    policyVersion: INTERNAL_SYSTEM_POLICY_VERSION,
    blockedAtIso: new Date(createdAtMs).toISOString(),
  };
}

export function normalizeTagrReason(reason: string): string {
  return normalizeModerationReason(reason, 'tagr');
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

export async function upsertTagrBlocks(
  pg: Pool,
  input: {
    targetEventIds: string[];
    reason: string;
    sourceEventId: string;
    sourcePubkey: string;
    blockedAtIso: string;
  },
): Promise<void> {
  await pg.query(
    `
    INSERT INTO tagr_blocks (event_id, reason, source_event_id, source_pubkey, blocked_at, policy_version)
    SELECT
      target_id,
      $2,
      $3,
      $4,
      $5::timestamptz,
      $6
    FROM unnest($1::text[]) AS target_id
    ON CONFLICT (event_id) DO UPDATE
    SET
      reason = EXCLUDED.reason,
      source_event_id = EXCLUDED.source_event_id,
      source_pubkey = EXCLUDED.source_pubkey,
      blocked_at = GREATEST(tagr_blocks.blocked_at, EXCLUDED.blocked_at),
      policy_version = EXCLUDED.policy_version,
      updated_at = now()
    `,
    [input.targetEventIds, input.reason, input.sourceEventId, input.sourcePubkey, input.blockedAtIso, TAGR_POLICY_VERSION],
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