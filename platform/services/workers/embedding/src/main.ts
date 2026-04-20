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
const MAX_RETRIES = Number(process.env.EMBED_MAX_RETRIES || 5);

let running = true;

redis.on('error', (err) => {
  log.error({ err }, 'redis client error');
});

pg.on('error', (err) => {
  log.error({ err }, 'postgres client error');
  if (running) {
    running = false;
    setImmediate(() => process.exit(1));
  }
});

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
      log.warn({ err, opName, delay, attempt }, 'operation failed, retrying');
      await sleep(delay);
    }
  }
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
  if (parsed.text.length > 20000) {
    throw new Error('Text too large');
  }
  return parsed;
}

function toPgVector(values: number[]): string {
  if (values.length === 0) {
    throw new Error('Embedding cannot be empty');
  }
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error('Embedding contains non-finite value');
    }
  }
  return `[${values.join(',')}]`;
}

async function processMessage(payload: string) {
  const job = parseJob(payload);
  const embedding = await withRetry('embedText', () => embedText(job.text));
  const pgVector = toPgVector(embedding);
  await withRetry('updateEmbedding', async () => {
    await pg.query(
      `
      UPDATE search_docs
      SET
        embedding = $1::vector,
        embedding_model = $2,
        embedding_version = $3
      WHERE event_id = $4
      `,
      [pgVector, MODEL_ID, MODEL_VERSION, job.event_id]
    );
  });
}

function setupShutdownHandlers() {
  const shutdown = async (signal: string) => {
    if (!running) return;
    running = false;
    log.info({ signal }, 'shutting down embedding worker');
    try {
      await redis.quit();
    } catch (err) {
      log.warn({ err }, 'failed to close redis cleanly');
    }
    try {
      await pg.end();
    } catch (err) {
      log.warn({ err }, 'failed to close postgres cleanly');
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

async function run() {
  setupShutdownHandlers();
  await pg.connect();
  await ensureGroup();
  log.info({ model: MODEL_ID, version: MODEL_VERSION }, 'warming embedding model');
  await withRetry('warmupEmbedder', () => warmupEmbedder());
  log.info('embedding model ready');
  let attempt = 0;
  while (running) {
    try {
      const res = await redis.xreadgroup(
        'GROUP', GROUP, CONSUMER,
        'COUNT', 20,
        'BLOCK', 5000,
        'STREAMS', STREAM, '>'
      ) as [string, [string, string[]][]][] | null;
      if (!res) continue;
      for (const [, messages] of res) {
        for (const [id, fields] of messages) {
          const payloadIndex = fields.findIndex((value) => value === 'payload');
          const payload =
            payloadIndex >= 0 && fields[payloadIndex + 1]
              ? fields[payloadIndex + 1]
              : fields[1];
          if (typeof payload !== 'string') {
            log.warn({ id }, 'invalid payload type');
            await redis.xack(STREAM, GROUP, id);
            continue;
          }
          try {
            await processMessage(payload);
            await withRetry('xack', () => redis.xack(STREAM, GROUP, id));
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
