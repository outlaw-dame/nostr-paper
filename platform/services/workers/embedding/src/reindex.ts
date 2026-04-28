import Redis from 'ioredis';
import { Client } from 'pg';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const redis = new Redis(process.env.REDIS_URL!);
const pg = new Client({ connectionString: process.env.POSTGRES_URL });

const STREAM = process.env.EMBED_STREAM || 'events.embed';
const MODEL_VERSION = Number(process.env.EMBEDDING_VERSION || 1);
const BATCH_SIZE = Math.max(1, Math.min(Number(process.env.REINDEX_BATCH_SIZE || 500), 2000));
const MAX_RETRIES = Number(process.env.REINDEX_MAX_RETRIES || 5);

type ReindexRow = {
  event_id: string;
  search_text: string;
};

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

async function enqueue(payload: object) {
  await withRetry('xadd', () => redis.xadd(STREAM, '*', 'payload', JSON.stringify(payload)));
}

async function run() {
  await withRetry('pg.connect', () => pg.connect());

  let cursorEventId: string | null = null;
  let total = 0;

  while (true) {
    const res = await withRetry('reindexQuery', () => pg.query<ReindexRow>(
      `
      SELECT sd.event_id, sd.search_text
      FROM search_docs sd
      WHERE
        sd.is_searchable = true
        AND (
          sd.embedding IS NULL
          OR sd.embedding_version < $1
        )
        AND ($2::text IS NULL OR sd.event_id > $2::text)
      ORDER BY sd.event_id ASC
      LIMIT $3
      `,
      [MODEL_VERSION, cursorEventId, BATCH_SIZE]
    ));

    if (res.rows.length === 0) {
      break;
    }

    for (const row of res.rows) {
      if (!row.search_text?.trim()) {
        continue;
      }
      await enqueue({
        event_id: row.event_id,
        text: row.search_text
      });
      total += 1;
    }

    const lastRow = res.rows[res.rows.length - 1];
    cursorEventId = lastRow.event_id;
    log.info({ total, cursorEventId }, 'enqueued reindex batch');
  }

  await pg.end();
  await redis.quit();
  log.info({ total }, 'reindex enqueue complete');
}

run().catch((err) => {
  log.fatal({ err }, 'reindex enqueue failed');
  process.exit(1);
});
