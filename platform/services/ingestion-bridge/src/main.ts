import WebSocket from 'ws';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createRedis, publishEvent, setDedupe, getState, setState } from './redis.js';
import { validateAndVerifyEvent } from './nostr.js';
import { nextDelay } from './backoff.js';

const config = loadConfig();
const logger = createLogger(config);
const redis = createRedis(config);

const STATE_KEY = `ingestion-bridge:${config.BRIDGE_NAME}:last_ts`;
const DEDUPE_PREFIX = `ingestion-bridge:${config.BRIDGE_NAME}:dedupe:`;

let ws: WebSocket | null = null;
let stopped = false;

function buildSince(nowSec: number, lastTs: number | null) {
  if (lastTs == null) {
    return nowSec - config.BOOTSTRAP_SINCE_SEC;
  }
  return Math.max(0, lastTs - config.REPLAY_WINDOW_SEC);
}

function makeSubId() {
  return `bridge-${config.BRIDGE_NAME}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function handleEvent(raw: any) {
  const v = validateAndVerifyEvent(raw, { maxBytes: config.MAX_EVENT_BYTES, maxTags: config.MAX_TAGS });
  if (!v.ok) {
    logger.warn({ reason: v.reason }, 'event rejected by validation');
    return;
  }

  const e = v.event;

  const dedupeKey = `${DEDUPE_PREFIX}${e.id}`;
  const first = await setDedupe(redis, dedupeKey, config.REDIS_DEDUPE_TTL_SEC);
  if (!first) {
    return;
  }

  const envelope = {
    event_id: e.id,
    pubkey: e.pubkey,
    kind: e.kind,
    created_at: e.created_at,
    content: e.content,
    tags: e.tags,
    raw: e,
    source: {
      source_type: 'strfry_ws',
      relay_url: config.STRFRY_URL,
      received_at: new Date().toISOString()
    },
    pipeline: {
      schema_version: 1,
      ingest_trace_id: `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    }
  };

  await publishEvent(redis, config.REDIS_STREAM, envelope);
  await setState(redis, STATE_KEY, e.created_at);
}

function connectLoop() {
  let attempt = 0;

  const run = async () => {
    while (!stopped) {
      const lastTs = await getState(redis, STATE_KEY);
      const nowSec = Math.floor(Date.now() / 1000);
      const since = buildSince(nowSec, lastTs);

      const subId = makeSubId();

      logger.info({ since }, 'connecting to strfry');

      ws = new WebSocket(config.STRFRY_URL, {
        handshakeTimeout: 15000,
        maxPayload: config.MAX_EVENT_BYTES * 2,
        perMessageDeflate: false
      });

      try {
        await new Promise<void>((resolve, reject) => {
          ws!.once('open', () => resolve());
          ws!.once('error', (err) => reject(err));
        });
      } catch (err) {
        const delay = nextDelay(attempt++);
        logger.error({ err, delay }, 'ws open failed, retrying');
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      attempt = 0;

      const req = ['REQ', subId, { since }];
      ws.send(JSON.stringify(req));

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          const [type, sid, payload] = msg;

          if (type === 'EVENT' && sid === subId) {
            await handleEvent(payload);
          }

          if (type === 'EOSE' && sid === subId) {
            logger.info('initial backfill complete (EOSE)');
          }

          if (type === 'NOTICE') {
            logger.warn({ notice: payload }, 'relay notice');
          }
        } catch (err) {
          logger.error({ err }, 'message handling error');
        }
      });

      await new Promise<void>((resolve) => {
        ws!.once('close', () => resolve());
        ws!.once('error', () => resolve());
      });

      if (stopped) break;

      const delay = nextDelay(attempt++);
      logger.warn({ delay }, 'ws closed, reconnecting');
      await new Promise(r => setTimeout(r, delay));
    }
  };

  run().catch((err) => {
    logger.fatal({ err }, 'fatal bridge error');
    process.exit(1);
  });
}

async function main() {
  logger.info('starting ingestion bridge');

  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    logger.info('shutting down');
    try { ws?.close(); } catch {}
    try { await redis.quit(); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  connectLoop();
}

main();
