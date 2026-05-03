import Redis from 'ioredis';
import { Pool } from 'pg';
import pino from 'pino';
import { buildEventSearchText, mergeEventUrls } from './mediaIndex.js';
import { scoreInternalModerationRisk } from '@nostr-paper/content-policy';
import {
  applyTrustedModerationSignals,
  ensureModerationStateSchema,
  evaluateKeywordBlock,
  normalizeTagrReason,
  reconcileSearchDocModerationStateForEvents,
  resolveTrustedModerationFeed,
  upsertKeywordBlock,
  upsertShadowModerationScore,
} from './moderationState.js';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const redis = new Redis(process.env.REDIS_URL!);
const pg = new Pool({ connectionString: process.env.POSTGRES_URL });

const INGEST_STREAM = process.env.REDIS_STREAM || 'events.ingest';
const EMBED_STREAM = process.env.EMBED_STREAM || 'events.embed';
const DLQ_STREAM = process.env.LEXICAL_DLQ_STREAM || 'events.ingest.dlq';
const GROUP = 'lexical-index';
const CONSUMER = `worker-${Math.random().toString(36).slice(2)}`;
const SHADOW_MODEL_SCORING_ENABLED = process.env.SHADOW_MODEL_SCORING_ENABLED !== 'false';
const SHADOW_MODEL_NAME = process.env.SHADOW_MODEL_NAME || 'internal-shadow-v1';
const SHADOW_MODEL_VERSION = process.env.SHADOW_MODEL_VERSION || 'v1';
const SHADOW_MODEL_ENDPOINT = process.env.SHADOW_MODEL_ENDPOINT || '';
const MAX_RETRIES = Number(process.env.LEXICAL_MAX_RETRIES || 5);
const METRICS_LOG_INTERVAL_MS = Number(process.env.METRICS_LOG_INTERVAL_MS || 60000);

let processedMessages = 0;
let failedMessages = 0;
let dlqRoutedMessages = 0;
let lastMetricsAt = Date.now();

function maybeLogMetrics(force = false) {
  const now = Date.now();
  if (!force && now - lastMetricsAt < METRICS_LOG_INTERVAL_MS) {
    return;
  }

  log.info(
    {
      processedMessages,
      failedMessages,
      dlqRoutedMessages,
      consumer: CONSUMER,
      group: GROUP,
    },
    'lexical worker metrics',
  );

  processedMessages = 0;
  failedMessages = 0;
  dlqRoutedMessages = 0;
  lastMetricsAt = now;
}

function backoff(attempt: number) {
  const base = Math.min(1000 * 2 ** attempt, 30000);
  return base + Math.floor(Math.random() * 250);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(opName: string, fn: () => Promise<T>, maxRetries = MAX_RETRIES): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const delay = backoff(attempt++);
      log.warn({ err, opName, attempt, delay }, 'operation failed, retrying');
      await sleep(delay);
    }
  }
}

function extractHashtags(tags: string[][]): string[] {
  return tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]!);
}

function extractMentions(tags: string[][]): string[] {
  return tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]!);
}

async function ensureGroup() {
  try {
    await redis.xgroup('CREATE', INGEST_STREAM, GROUP, '0', 'MKSTREAM');
  } catch (err: any) {
    if (!String(err?.message).includes('BUSYGROUP')) throw err;
  }
}

async function enqueueEmbeddingJob(eventId: string, text: string) {
  await withRetry('enqueueEmbeddingJob', () => redis.xadd(
    EMBED_STREAM,
    '*',
    'payload',
    JSON.stringify({
      event_id: eventId,
      text
    })
  ));
}

async function sendToDlq(id: string, payload: string, err: unknown) {
  await withRetry('sendLexicalToDlq', () => redis.xadd(
    DLQ_STREAM,
    '*',
    'source_stream',
    INGEST_STREAM,
    'source_group',
    GROUP,
    'source_id',
    id,
    'error',
    err instanceof Error ? err.message : String(err),
    'payload',
    payload,
  ));
}

// Kinds the lexical index ingests:
//   1     = NIP-01 short note
//   6     = NIP-18 repost
//   7     = NIP-25 reaction
//   11    = NIP-7D thread root
//   21    = video event
//   22    = short video event
//   1063  = NIP-94 file metadata
//   1111  = NIP-22 comment
//   9735  = NIP-57 zap receipt
//   10063 = Blossom BUD-03 media server list
//   30023 = NIP-23 long-form article
//   30024 = NIP-23 long-form draft
//   34235 = addressable video
//   34236 = addressable short video
const SUPPORTED_KINDS = new Set([1, 6, 7, 11, 21, 22, 1063, 1111, 9735, 10063, 30023, 30024, 34235, 34236]);
const SOCIAL_KINDS = new Set([6, 7, 9735]);
const TAGR_KINDS = new Set([1984, 1985]);

function isValidHex64(value: string | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function isTrustedModerationEvent(event: { pubkey: string; kind: number; tags?: string[][]; source?: { relay_url?: string | null } | null }): boolean {
  const trustedFeed = resolveTrustedModerationFeed(event);
  if (!trustedFeed) return false;
  if (!TAGR_KINDS.has(event.kind)) return false;
  const tags = event.tags || [];
  return tags.some((tag) => tag[0] === 'e' && isValidHex64(tag[1]));
}

function parseTagrReason(event: { kind: number; tags?: string[][] }): string {
  const tags = event.tags || [];
  for (const tag of tags) {
    if (tag[0] !== 'l' || !tag[1]) continue;
    if (tag[1].startsWith('MOD>')) {
      const code = tag[1].slice(4).trim();
      if (code) return normalizeTagrReason(code);
    }
  }

  const typedReason = tags
    .filter((tag) => tag[0] === 'e' || tag[0] === 'p' || tag[0] === 'x')
    .map((tag) => (tag[2] || '').trim().toLowerCase())
    .find((value) => value.length > 0);

  if (typedReason) return normalizeTagrReason(typedReason);
  return normalizeTagrReason(event.kind === 1984 ? 'report' : 'label');
}

function extractTagrTargetEventIds(tags: string[][]): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    if (tag[0] !== 'e' || !isValidHex64(tag[1])) continue;
    out.add(tag[1].toLowerCase());
  }
  return [...out];
}

async function applyTrustedModerationBlocks(event: {
  event_id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags?: string[][];
  source?: { relay_url?: string | null } | null;
}) {
  const trustedFeed = resolveTrustedModerationFeed(event);
  if (!trustedFeed) return;

  const targetEventIds = extractTagrTargetEventIds(event.tags || []);
  if (targetEventIds.length === 0) return;

  const reason = parseTagrReason(event);
  const blockedAtIso = new Date(event.created_at * 1000).toISOString();

  await applyTrustedModerationSignals(pg, {
    targetEventIds,
    reason,
    sourceEventId: event.event_id,
    sourcePubkey: event.pubkey,
    sourceRelayUrl: event.source?.relay_url || null,
    blockedAtIso,
    feed: trustedFeed,
  });

  await reconcileSearchDocModerationStateForEvents(pg, targetEventIds);
}

function shadowFallbackModel(input: { content: string; title: string | null; summary: string | null; alt: string | null; hashtags: string[] }) {
  const risk = scoreInternalModerationRisk(input);
  return {
    modelName: SHADOW_MODEL_NAME,
    modelVersion: SHADOW_MODEL_VERSION,
    score: risk.score,
    recommendedAction: risk.score >= risk.threshold ? 'block' : 'allow',
    reasons: [...risk.flags, ...risk.matchedTerms, ...risk.matchedDomains].slice(0, 20),
    meta: {
      normalizedText: risk.normalizedText.slice(0, 400),
      threshold: risk.threshold,
    },
  } as const;
}

async function scoreWithRemoteModel(input: {
  content: string;
  title: string | null;
  summary: string | null;
  alt: string | null;
  hashtags: string[];
}) {
  if (!SHADOW_MODEL_ENDPOINT) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(SHADOW_MODEL_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const parsed = await response.json() as {
      score?: number;
      recommendedAction?: string;
      reasons?: string[];
      modelName?: string;
      modelVersion?: string;
      meta?: Record<string, unknown>;
    };

    if (!Number.isFinite(parsed.score ?? Number.NaN)) return null;

    return {
      modelName: parsed.modelName || SHADOW_MODEL_NAME,
      modelVersion: parsed.modelVersion || SHADOW_MODEL_VERSION,
      score: Math.max(0, Math.min(1, Number(parsed.score))),
      recommendedAction: parsed.recommendedAction === 'block' ? 'block' : 'allow',
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 20) : [],
      meta: parsed.meta || {},
    } as const;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function runShadowModerationScore(event: {
  event_id: string;
  content?: string;
  tags?: string[][];
}, context: {
  title: string | null;
  summary: string | null;
  alt: string | null;
  hashtags: string[];
  policyAction: 'allow' | 'block';
}) {
  if (!SHADOW_MODEL_SCORING_ENABLED) return;

  const payload = {
    content: event.content || '',
    title: context.title,
    summary: context.summary,
    alt: context.alt,
    hashtags: context.hashtags,
  };

  void (async () => {
    const remote = await scoreWithRemoteModel(payload);
    const modelResult = remote || shadowFallbackModel(payload);

    await upsertShadowModerationScore(pg, {
      eventId: event.event_id,
      modelName: modelResult.modelName,
      modelVersion: modelResult.modelVersion,
      score: modelResult.score,
      recommendedAction: modelResult.recommendedAction,
      policyAction: context.policyAction,
      reasons: modelResult.reasons,
      meta: modelResult.meta,
    });
  })().catch((err) => {
    log.warn({ err, eventId: event.event_id }, 'shadow moderation scoring failed');
  });
}

interface ThreadRefs {
  rootId: string | null;
  rootAddress: string | null;
  replyToId: string | null;
  rootKind: string | null;
  isReply: boolean;
}

/**
 * NIP-10: extract thread references from marked (or legacy positional) e-tags.
 * Used for kind-1 short notes and kind-11 threads.
 */
function extractNip10Refs(tags: string[][]): ThreadRefs {
  const eTags = tags.filter(t => t[0] === 'e');
  if (eTags.length === 0) {
    return { rootId: null, rootAddress: null, replyToId: null, rootKind: null, isReply: false };
  }

  const rootTag  = eTags.find(t => t[3] === 'root');
  const replyTag = eTags.find(t => t[3] === 'reply');

  if (rootTag) {
    const rootId    = rootTag[1]  ?? null;
    const replyToId = replyTag ? (replyTag[1] ?? null) : rootId;
    return { rootId, rootAddress: null, replyToId, rootKind: null, isReply: true };
  }

  // Legacy positional: first e-tag = root, last e-tag = direct parent.
  const rootId    = eTags[0][1]                    ?? null;
  const replyToId = eTags[eTags.length - 1][1]     ?? null;
  return { rootId, rootAddress: null, replyToId, rootKind: null, isReply: true };
}

/**
 * NIP-22: extract thread references from uppercase (root scope) and
 * lowercase (parent scope) tags on kind-1111 comments.
 *   E / A / K  = root event id / root address / root kind
 *   e          = parent event id
 */
function extractNip22Refs(tags: string[][]): ThreadRefs {
  const rootEventTag   = tags.find(t => t[0] === 'E');
  const rootAddrTag    = tags.find(t => t[0] === 'A');
  const rootKindTag    = tags.find(t => t[0] === 'K');
  const parentEventTag = tags.find(t => t[0] === 'e');

  const rootId      = rootEventTag?.[1]   ?? null;
  const rootAddress = rootAddrTag?.[1]    ?? null;
  const rootKind    = rootKindTag?.[1]    ?? null;
  // Parent scope falls back to root if no intermediate comment exists yet.
  const replyToId   = parentEventTag?.[1] ?? rootId;

  return {
    rootId,
    rootAddress,
    replyToId,
    rootKind,
    isReply: rootId !== null || rootAddress !== null,
  };
}

/** Extract the `title` tag value (kind-11 threads, kind-30023/30024 articles). */
function extractTitle(tags: string[][]): string | null {
  const tag = tags.find(t => t[0] === 'title' && t[1]);
  return tag?.[1] ?? null;
}

function firstTagValue(tags: string[][], tagName: string): string | null {
  const tag = tags.find(t => t[0] === tagName && t[1]);
  return tag?.[1] ?? null;
}

function parseZapAmountMsats(tags: string[][]): number {
  const description = firstTagValue(tags, 'description');
  if (!description) return 0;

  try {
    const parsed = JSON.parse(description);
    const requestTags = Array.isArray(parsed?.tags) ? parsed.tags as unknown[] : [];
    const amountTag = requestTags.find((tag): tag is string[] => (
      Array.isArray(tag) && tag[0] === 'amount' && typeof tag[1] === 'string'
    ));
    const amount = amountTag ? Number.parseInt(amountTag[1], 10) : 0;
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  } catch {
    return 0;
  }
}

function socialTargetEventId(event: { kind: number; tags?: string[][] }): string | null {
  const tags = event.tags || [];
  if (event.kind === 6 || event.kind === 7 || event.kind === 9735) {
    return firstTagValue(tags, 'e');
  }
  return null;
}

async function upsertSocialMetrics(event: { kind: number; content?: string; created_at: number; tags?: string[][] }) {
  const targetEventId = socialTargetEventId(event);
  if (!targetEventId) return;

  const isLike = event.kind === 7 && (!event.content || event.content === '+');
  const isDislike = event.kind === 7 && event.content === '-';
  const zapAmountMsats = event.kind === 9735 ? parseZapAmountMsats(event.tags || []) : 0;

  await pg.query(
    `
    INSERT INTO event_social_metrics (
      event_id,
      reaction_count,
      like_count,
      dislike_count,
      repost_count,
      zap_count,
      zap_total_msats,
      last_activity_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8))
    ON CONFLICT (event_id) DO UPDATE
    SET
      reaction_count   = event_social_metrics.reaction_count + EXCLUDED.reaction_count,
      like_count       = event_social_metrics.like_count + EXCLUDED.like_count,
      dislike_count    = event_social_metrics.dislike_count + EXCLUDED.dislike_count,
      repost_count     = event_social_metrics.repost_count + EXCLUDED.repost_count,
      zap_count        = event_social_metrics.zap_count + EXCLUDED.zap_count,
      zap_total_msats  = event_social_metrics.zap_total_msats + EXCLUDED.zap_total_msats,
      last_activity_at = GREATEST(event_social_metrics.last_activity_at, EXCLUDED.last_activity_at)
    `,
    [
      targetEventId,
      event.kind === 7 ? 1 : 0,
      isLike ? 1 : 0,
      isDislike ? 1 : 0,
      event.kind === 6 ? 1 : 0,
      event.kind === 9735 ? 1 : 0,
      zapAmountMsats,
      event.created_at,
    ],
  );
}

async function processMessage(payload: string) {
  const event = JSON.parse(payload);
  const trustedModerationEvent = isTrustedModerationEvent(event);

  if (!SUPPORTED_KINDS.has(event.kind) && !trustedModerationEvent) {
    return;
  }

  const tags: string[][] = event.tags || [];
  const hashtags = extractHashtags(tags);
  const mentions  = extractMentions(tags);
  const urls      = mergeEventUrls(event.content || '', tags);
  const title     = extractTitle(tags);
  const summary   = firstTagValue(tags, 'summary');
  const alt       = firstTagValue(tags, 'alt');
  const refs: ThreadRefs =
    event.kind === 1111 ? extractNip22Refs(tags) : extractNip10Refs(tags);

  // Build search text: title first, then content, then hashtag tokens.
  const searchText = buildEventSearchText({
    title,
    content: event.content || '',
    hashtags,
    tags,
    kind: event.kind,
  });
  const keywordDecision = evaluateKeywordBlock({
    created_at: event.created_at,
    content: event.content || '',
    tags,
  });
  const keywordBlocked = keywordDecision !== null;

  await pg.query('BEGIN');

  try {
    const inserted = await pg.query(
      `
      INSERT INTO events_raw (
        id, pubkey, kind, created_at, content, tags, raw, source_relay, source_type,
        reply_to_id, root_id, root_address, root_kind, is_reply
      )
      VALUES ($1, $2, $3, to_timestamp($4), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO NOTHING
      `,
      [
        event.event_id,
        event.pubkey,
        event.kind,
        event.created_at,
        event.content,
        event.tags,
        event.raw,
        event.source?.relay_url ?? null,
        event.source?.source_type ?? 'unknown',
        refs.replyToId,
        refs.rootId,
        refs.rootAddress,
        refs.rootKind,
        refs.isReply,
      ]
    );

    if (inserted.rowCount && SOCIAL_KINDS.has(event.kind)) {
      await upsertSocialMetrics(event);
    }

    if (keywordDecision) {
      await upsertKeywordBlock(pg, event.event_id, keywordDecision);
    }

    if (!SOCIAL_KINDS.has(event.kind) && !trustedModerationEvent) {
      await pg.query(
        `
        INSERT INTO search_docs (
          event_id,
          search_text,
          fts,
          title_text,
          author_pubkey,
          kind,
          created_at,
          hashtags,
          mentions,
          urls,
          moderation_state,
          is_searchable,
          reply_to_id,
          root_id,
          root_address,
          root_kind,
          is_reply
        )
        VALUES (
          $1,
          $2,
          to_tsvector('simple', $2),
          $3,
          $4,
          $5,
          to_timestamp($6),
          $7,
          $8,
          $9,
          CASE
            WHEN EXISTS (SELECT 1 FROM keyword_blocks kb WHERE kb.event_id = $1)
              THEN 'blocked'
            WHEN EXISTS (SELECT 1 FROM tagr_blocks tb WHERE tb.event_id = $1)
              THEN 'blocked'
            ELSE 'allowed'
          END,
          true,
          $10,
          $11,
          $12,
          $13,
          $14
        )
        ON CONFLICT (event_id) DO UPDATE
        SET
          search_text  = EXCLUDED.search_text,
          fts          = EXCLUDED.fts,
          title_text   = EXCLUDED.title_text,
          hashtags     = EXCLUDED.hashtags,
          mentions     = EXCLUDED.mentions,
          urls         = EXCLUDED.urls,
          moderation_state = CASE
            WHEN EXISTS (SELECT 1 FROM keyword_blocks kb WHERE kb.event_id = EXCLUDED.event_id)
              THEN 'blocked'
            WHEN EXISTS (SELECT 1 FROM tagr_blocks tb WHERE tb.event_id = EXCLUDED.event_id)
              THEN 'blocked'
            ELSE EXCLUDED.moderation_state
          END,
          reply_to_id  = EXCLUDED.reply_to_id,
          root_id      = EXCLUDED.root_id,
          root_address = EXCLUDED.root_address,
          root_kind    = EXCLUDED.root_kind,
          is_reply     = EXCLUDED.is_reply
        `,
        [
          event.event_id,
          searchText,
          title,
          event.pubkey,
          event.kind,
          event.created_at,
          hashtags,
          mentions,
          urls,
          refs.replyToId,
          refs.rootId,
          refs.rootAddress,
          refs.rootKind,
          refs.isReply,
        ]
      );
    }

    if (trustedModerationEvent) {
      await applyTrustedModerationBlocks(event);
    }

    await pg.query(
      `
      INSERT INTO pubkey_usage (
        pubkey,
        event_count,
        searchable_event_count,
        approx_storage_bytes,
        last_active_at
      )
      VALUES ($1, 1, $2, $3, to_timestamp($4))
      ON CONFLICT (pubkey) DO UPDATE
      SET
        event_count            = pubkey_usage.event_count + 1,
        searchable_event_count = pubkey_usage.searchable_event_count + EXCLUDED.searchable_event_count,
        approx_storage_bytes   = pubkey_usage.approx_storage_bytes + EXCLUDED.approx_storage_bytes,
        last_active_at         = GREATEST(pubkey_usage.last_active_at, EXCLUDED.last_active_at)
      `,
      [
        event.pubkey,
        SOCIAL_KINDS.has(event.kind) || trustedModerationEvent ? 0 : 1,
        Buffer.byteLength(JSON.stringify(event.raw ?? event), 'utf8'),
        event.created_at,
      ]
    );

    await pg.query('COMMIT');

    if (!SOCIAL_KINDS.has(event.kind) && !trustedModerationEvent) {
      runShadowModerationScore(event, {
        title,
        summary,
        alt,
        hashtags,
        policyAction: keywordBlocked ? 'block' : 'allow',
      });
    }

    if (!SOCIAL_KINDS.has(event.kind) && !trustedModerationEvent && !keywordBlocked && searchText.trim()) {
      await enqueueEmbeddingJob(event.event_id, searchText);
    }
  } catch (err) {
    await pg.query('ROLLBACK');
    throw err;
  }
}

async function run() {
  await pg.query('SELECT 1');
  await ensureModerationStateSchema(pg);
  await ensureGroup();

  while (true) {
    let res: [string, [string, string[]][]][] | null;
    try {
      res = await redis.xreadgroup(
        'GROUP', GROUP, CONSUMER,
        'COUNT', 50,
        'BLOCK', 5000,
        'STREAMS', INGEST_STREAM, '>'
      ) as [string, [string, string[]][]][] | null;
    } catch (err) {
      if (String((err as { message?: string })?.message || '').includes('NOGROUP')) {
        log.warn({ err }, 'redis group missing, recreating group');
        await ensureGroup();
        continue;
      }
      throw err;
    }

    if (!res) continue;

    for (const [, messages] of res) {
      for (const [id, fields] of messages) {
        const payloadIndex = fields.findIndex((value: string) => value === 'payload');
        const payload =
          payloadIndex >= 0 && fields[payloadIndex + 1]
            ? fields[payloadIndex + 1]
            : fields[1];
        if (typeof payload !== 'string') {
          log.warn({ id }, 'invalid payload type');
          await redis.xack(INGEST_STREAM, GROUP, id);
          continue;
        }
        try {
          await processMessage(payload);
          await redis.xack(INGEST_STREAM, GROUP, id);
          processedMessages += 1;
          maybeLogMetrics();
        } catch (err) {
          failedMessages += 1;
          log.error({ err, id }, 'failed processing lexical message');
          try {
            await sendToDlq(id, payload, err);
            await redis.xack(INGEST_STREAM, GROUP, id);
            dlqRoutedMessages += 1;
            maybeLogMetrics();
          } catch (dlqErr) {
            log.error({ err: dlqErr, id }, 'failed routing lexical message to dlq');
          }
        }
      }
    }
  }
}

run().catch((err) => {
  maybeLogMetrics(true);
  log.fatal({ err }, 'lexical worker crashed');
  process.exit(1);
});
