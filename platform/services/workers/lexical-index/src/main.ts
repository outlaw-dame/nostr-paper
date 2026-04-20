import Redis from 'ioredis';
import { Client } from 'pg';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const redis = new Redis(process.env.REDIS_URL!);
const pg = new Client({ connectionString: process.env.POSTGRES_URL });

const INGEST_STREAM = process.env.REDIS_STREAM || 'events.ingest';
const EMBED_STREAM = process.env.EMBED_STREAM || 'events.embed';
const GROUP = 'lexical-index';
const CONSUMER = `worker-${Math.random().toString(36).slice(2)}`;
const MAX_RETRIES = Number(process.env.LEXICAL_MAX_RETRIES || 5);

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

async function processMessage(payload: string) {
  const event = JSON.parse(payload);

  if (event.kind !== 1) {
    return;
  }

  const hashtags = extractHashtags(event.tags || []);
  const mentions = extractMentions(event.tags || []);
  const urls = extractUrls(event.content || '');
  const searchText = buildSearchText(event.content || '', hashtags);

  await pg.query('BEGIN');

  try {
    await pg.query(
      `
      INSERT INTO events_raw (
        id, pubkey, kind, created_at, content, tags, raw, source_relay, source_type
      )
      VALUES ($1, $2, $3, to_timestamp($4), $5, $6, $7, $8, $9)
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
        event.source?.source_type ?? 'unknown'
      ]
    );

    await pg.query(
      `
      INSERT INTO search_docs (
        event_id,
        search_text,
        fts,
        author_pubkey,
        kind,
        created_at,
        hashtags,
        mentions,
        urls,
        moderation_state,
        is_searchable
      )
      VALUES (
        $1,
        $2,
        to_tsvector('simple', $2),
        $3,
        $4,
        to_timestamp($5),
        $6,
        $7,
        $8,
        'allowed',
        true
      )
      ON CONFLICT (event_id) DO UPDATE
      SET
        search_text = EXCLUDED.search_text,
        fts = EXCLUDED.fts,
        hashtags = EXCLUDED.hashtags,
        mentions = EXCLUDED.mentions,
        urls = EXCLUDED.urls
      `,
      [
        event.event_id,
        searchText,
        event.pubkey,
        event.kind,
        event.created_at,
        hashtags,
        mentions,
        urls
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
        event_count = pubkey_usage.event_count + 1,
        searchable_event_count = pubkey_usage.searchable_event_count + 1,
        approx_storage_bytes = pubkey_usage.approx_storage_bytes + EXCLUDED.approx_storage_bytes,
        last_active_at = GREATEST(pubkey_usage.last_active_at, EXCLUDED.last_active_at)
      `,
      [
        event.pubkey,
        Buffer.byteLength(JSON.stringify(event.raw ?? event), 'utf8'),
        event.created_at
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
  await pg.connect();
  await ensureGroup();

  while (true) {
    const res = await redis.xreadgroup(
      'GROUP', GROUP, CONSUMER,
      'COUNT', 50,
      'BLOCK', 5000,
      'STREAMS', INGEST_STREAM, '>'
    ) as [string, [string, string[]][]][] | null;

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
        } catch (err) {
          log.error({ err, id }, 'failed processing lexical message');
        }
      }
    }
  }
}

run().catch((err) => {
  log.fatal({ err }, 'lexical worker crashed');
  process.exit(1);
});
