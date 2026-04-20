import Redis from 'ioredis';
import { Client } from 'pg';
import pino from 'pino';
import { embedText, warmupEmbedder } from 'semantic-embedder';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const redis = new Redis(process.env.REDIS_URL!);
const pg = new Client({ connectionString: process.env.POSTGRES_URL });

const STREAM = process.env.EMBED_STREAM || 'events.embed';
const GROUP = 'embedding';
const CONSUMER = `embed-${Math.random().toString(36).slice(2)}`;
const MODEL_ID = process.env.EMBEDDING_MODEL_ID || 'Xenova/all-MiniLM-L6-v2';
const MODEL_VERSION = Number(process.env.EMBEDDING_VERSION || 1);

function backoff(attempt: number) {
  const base = Math.min(1000 * 2 ** attempt, 30000);
  return base + Math.floor(Math.random() * 250);
}

async function ensureGroup() {
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
  } catch (err: any) {
    if (!String(err?.message).includes('BUSYGROUP')) throw err;
  }
}

type EmbedJob = {
  event_id: string;
  text: string;
};

function parseJob(payload: string): EmbedJob {
  const parsed = JSON.parse(payload);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid embed job payload');
  }
  if (typeof parsed.event_id !== 'string' || !parsed.event_id) {
    throw new Error('Missing event_id');
  }
  if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
    throw new Error('Missing text');
  }
  return parsed;
}

async function processMessage(payload: string) {
  const job = parseJob(payload);
  const embedding = await embedText(job.text);
  await pg.query(
    `
    UPDATE search_docs
    SET
      embedding = $1,
      embedding_model = $2,
      embedding_version = $3
    WHERE event_id = $4
    `,
    [embedding, MODEL_ID, MODEL_VERSION, job.event_id]
  );
}

async function run() {
  await pg.connect();
  await ensureGroup();
  log.info({ model: MODEL_ID, version: MODEL_VERSION }, 'warming embedding model');
  await warmupEmbedder();
  log.info('embedding model ready');
  let attempt = 0;
  while (true) {
    try {
      const res = await redis.xreadgroup(
        'GROUP', GROUP, CONSUMER,
        'BLOCK', 5000,
        'COUNT', 20,
        'STREAMS', STREAM, '>'
      );
      if (!res) continue;
      for (const [, messages] of res) {
        for (const [id, fields] of messages) {
          const payloadIndex = fields.findIndex((value) => value === 'payload');
          const payload =
            payloadIndex >= 0 && fields[payloadIndex + 1]
              ? fields[payloadIndex + 1]
              : fields[1];
          try {
            await processMessage(payload);
            await redis.xack(STREAM, GROUP, id);
          } catch (err) {
            log.error({ err, id }, 'embedding failed');
          }
        }
      }
      attempt = 0;
    } catch (err) {
      const delay = backoff(attempt++);
      log.error({ err, delay }, 'embedding worker failure, retrying');
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

run().catch((err) => {
  log.fatal({ err }, 'embedding worker crashed');
  process.exit(1);
});
