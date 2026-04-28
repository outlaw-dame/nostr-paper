import Redis from 'ioredis';
import { Pool } from 'pg';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const redis = new Redis(process.env.REDIS_URL!);
const pg = new Pool({ connectionString: process.env.POSTGRES_URL });

const INGEST_STREAM = process.env.REDIS_STREAM || 'events.ingest';
const EMBED_STREAM = process.env.EMBED_STREAM || 'events.embed';
const DLQ_STREAM = process.env.LEXICAL_DLQ_STREAM || 'events.ingest.dlq';
const GROUP = 'lexical-index';
const CONSUMER = `worker-${Math.random().toString(36).slice(2)}`;
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

function extractUrls(content: string): string[] {
  const matches = content.match(/https?:\/\/[^\s]+/g);
  return matches ?? [];
}

function buildSearchText(content: string, hashtags: string[]): string {
  return [content, ...hashtags.map((h) => `#${h}`)].join(' ').trim();
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
    payload
  ));
}

// Kinds the lexical index ingests:
//   1     = NIP-01 short note
//   11    = NIP-7D thread root
//   1111  = NIP-22 comment
//   30023 = NIP-23 long-form article
//   30024 = NIP-23 long-form draft
const SUPPORTED_KINDS = new Set([1, 11, 1111, 30023, 30024]);

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

async function processMessage(payload: string) {
  const event = JSON.parse(payload);

  if (!SUPPORTED_KINDS.has(event.kind)) {
    return;
  }

  const tags: string[][] = event.tags || [];
  const hashtags = extractHashtags(tags);
  const mentions  = extractMentions(tags);
  const urls      = extractUrls(event.content || '');
  const title     = extractTitle(tags);
  const refs: ThreadRefs =
    event.kind === 1111 ? extractNip22Refs(tags) : extractNip10Refs(tags);

  // Build search text: title first, then content, then hashtag tokens.
  const textParts: string[] = [];
  if (title) textParts.push(title);
  if (event.content) textParts.push(event.content);
  hashtags.forEach(h => textParts.push(`#${h}`));
  const searchText = textParts.join(' ').trim();

  await pg.query('BEGIN');

  try {
    await pg.query(
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
        'allowed',
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

    await pg.query(
      `
      INSERT INTO pubkey_usage (
        pubkey,
        event_count,
        searchable_event_count,
        approx_storage_bytes,
        last_active_at
      )
      VALUES ($1, 1, 1, $2, to_timestamp($3))
      ON CONFLICT (pubkey) DO UPDATE
      SET
        event_count            = pubkey_usage.event_count + 1,
        searchable_event_count = pubkey_usage.searchable_event_count + 1,
        approx_storage_bytes   = pubkey_usage.approx_storage_bytes + EXCLUDED.approx_storage_bytes,
        last_active_at         = GREATEST(pubkey_usage.last_active_at, EXCLUDED.last_active_at)
      `,
      [
        event.pubkey,
        Buffer.byteLength(JSON.stringify(event.raw ?? event), 'utf8'),
        event.created_at,
      ]
    );

    await pg.query('COMMIT');

    if (searchText.trim()) {
      await enqueueEmbeddingJob(event.event_id, searchText);
    }
  } catch (err) {
    await pg.query('ROLLBACK');
    throw err;
  }
}

async function run() {
  await pg.query('SELECT 1');
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
