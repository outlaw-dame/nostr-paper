import Redis from 'ioredis';
import { Client } from 'pg';
import pino from 'pino';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const redis = new Redis(process.env.REDIS_URL!);
const pg = new Client({ connectionString: process.env.POSTGRES_URL });

const STREAM = process.env.REDIS_STREAM || 'events.ingest';
const GROUP = 'lexical-index';
const CONSUMER = `worker-${Math.random().toString(36).slice(2)}`;

function extractHashtags(tags: string[][]): string[] {
  return tags.filter(t => t[0] === 't' && t[1]).map(t => t[1]!);
}

function buildSearchText(content: string, hashtags: string[]): string {
  return [content, ...hashtags.map(h => `#${h}`)].join(' ');
}

async function ensureGroup() {
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
  } catch (err: any) {
    if (!err.message.includes('BUSYGROUP')) throw err;
  }
}

async function processMessage(msgId: string, payload: any) {
  const event = JSON.parse(payload);

  if (event.kind !== 1) {
    return;
  }

  const hashtags = extractHashtags(event.tags || []);
  const searchText = buildSearchText(event.content || '', hashtags);

  await pg.query('BEGIN');

  try {
    await pg.query(
      `INSERT INTO events_raw (id, pubkey, kind, created_at, content, tags, raw, source_type)
       VALUES ($1,$2,$3,to_timestamp($4),$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [event.event_id, event.pubkey, event.kind, event.created_at, event.content, event.tags, event.raw, event.source?.source_type || 'unknown']
    );

    await pg.query(
      `INSERT INTO search_docs (event_id, search_text, fts, author_pubkey, kind, created_at, hashtags)
       VALUES ($1,$2,to_tsvector('simple',$2),$3,$4,to_timestamp($5),$6)
       ON CONFLICT (event_id) DO UPDATE
       SET search_text = EXCLUDED.search_text,
           fts = EXCLUDED.fts`,
      [event.event_id, searchText, event.pubkey, event.kind, event.created_at, hashtags]
    );

    await pg.query('COMMIT');
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
      'BLOCK', 5000,
      'COUNT', 50,
      'STREAMS', STREAM, '>'
    );

    if (!res) continue;

    for (const [, messages] of res) {
      for (const [id, fields] of messages) {
        const payload = fields[1];
        try {
          await processMessage(id, payload);
          await redis.xack(STREAM, GROUP, id);
        } catch (err) {
          log.error({ err }, 'failed processing message');
        }
      }
    }
  }
}

run().catch(err => {
  log.fatal(err);
  process.exit(1);
});
