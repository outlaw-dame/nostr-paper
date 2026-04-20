import Redis from 'ioredis';
import { Client } from 'pg';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const redis = new Redis(process.env.REDIS_URL!);
const pg = new Client({ connectionString: process.env.POSTGRES_URL });

const STREAM = process.env.EMBED_STREAM || 'events.embed';
const MODEL_VERSION = Number(process.env.EMBEDDING_VERSION || 1);
const BATCH_SIZE = Number(process.env.REINDEX_BATCH_SIZE || 500);

async function enqueue(payload: object) {
  await redis.xadd(STREAM, '*', 'payload', JSON.stringify(payload));
}

async function run() {
  await pg.connect();
  let offset = 0;
  let total = 0;

  while (true) {
    const res = await pg.query(
      `
      SELECT sd.event_id, sd.search_text
      FROM search_docs sd
      WHERE
        sd.is_searchable = true
        AND (
          sd.embedding IS NULL
          OR sd.embedding_version < $1
        )
      ORDER BY sd.created_at ASC
      OFFSET $2
      LIMIT $3
      `,
      [MODEL_VERSION, offset, BATCH_SIZE]
    );

    if (res.rows.length === 0) {
      break;
    }

    for (const row of res.rows) {
      await enqueue({
        event_id: row.event_id,
        text: row.search_text
      });
      total += 1;
    }

    offset += res.rows.length;
    log.info({ total, offset }, 'enqueued reindex batch');
  }

  await pg.end();
  await redis.quit();
  log.info({ total }, 'reindex enqueue complete');
}

run().catch((err) => {
  log.fatal({ err }, 'reindex enqueue failed');
  process.exit(1);
});
