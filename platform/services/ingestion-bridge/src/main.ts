import WebSocket from 'ws';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createRedis, publishEvent, setDedupe, getState, setState } from './redis.js';
import { parseKind10002RelayList, validateAndVerifyEvent } from './nostr.js';
import { nextDelay } from './backoff.js';

const config = loadConfig();
const logger = createLogger(config);
const redis = createRedis(config);

const STATE_KEY = `ingestion-bridge:${config.BRIDGE_NAME}:last_ts`;
const TAGR_STATE_KEY = `ingestion-bridge:${config.BRIDGE_NAME}:tagr:last_ts`;
const DEDUPE_PREFIX = `ingestion-bridge:${config.BRIDGE_NAME}:dedupe:`;
const TAGR_KINDS = [1984, 1985];

let ws: WebSocket | null = null;
const activeSockets = new Set<WebSocket>();
let stopped = false;
const lastPersistedTsByStateKey = new Map<string, number | null>();
let droppedByBackpressure = 0;
let acceptedEvents = 0;
let validationRejected = 0;
let maxQueuedMessages = 0;
let lastMetricsAt = Date.now();

function maybeLogMetrics(force = false) {
  const now = Date.now();
  if (!force && now - lastMetricsAt < config.METRICS_LOG_INTERVAL_MS) {
    return;
  }

  logger.info(
    {
      acceptedEvents,
      validationRejected,
      droppedByBackpressure,
      maxQueuedMessages,
      queueLimit: config.MAX_MESSAGE_QUEUE,
    },
    'ingestion bridge metrics',
  );

  acceptedEvents = 0;
  validationRejected = 0;
  droppedByBackpressure = 0;
  maxQueuedMessages = 0;
  lastMetricsAt = now;
}

function buildSince(nowSec: number, lastTs: number | null) {
  if (lastTs == null) {
    return nowSec - config.BOOTSTRAP_SINCE_SEC;
  }
  return Math.max(0, lastTs - config.REPLAY_WINDOW_SEC);
}

function makeSubId() {
  return `bridge-${config.BRIDGE_NAME}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

type RelaySource = {
  name: string;
  relayUrl: string;
  sourceType: string;
  stateKey: string;
  buildReq: (subId: string, since: number) => unknown[];
  acceptEvent?: (event: { pubkey: string; kind: number }) => boolean;
};

async function handleEvent(raw: any, source: RelaySource) {
  const v = validateAndVerifyEvent(raw, { maxBytes: config.MAX_EVENT_BYTES, maxTags: config.MAX_TAGS });
  if (!v.ok) {
    validationRejected += 1;
    logger.warn({ source: source.name, reason: v.reason }, 'event rejected by validation');
    return;
  }

  const e = v.event;
  if (source.acceptEvent && !source.acceptEvent(e)) {
    return;
  }

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
      source_type: source.sourceType,
      relay_url: source.relayUrl,
      received_at: new Date().toISOString()
    },
    pipeline: {
      schema_version: 1,
      ingest_trace_id: `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
    },
    ...(e.kind === 10002 ? { outbox: parseKind10002RelayList(e.tags) } : {}),
  };

  await publishEvent(redis, config.REDIS_STREAM, envelope);
  acceptedEvents += 1;

  // Keep redis state monotonic and avoid redundant writes under event bursts.
  const lastPersistedTs = lastPersistedTsByStateKey.get(source.stateKey) ?? null;
  if (lastPersistedTs == null || e.created_at > lastPersistedTs) {
    await setState(redis, source.stateKey, e.created_at);
    lastPersistedTsByStateKey.set(source.stateKey, e.created_at);
  }
}

function connectLoop(source: RelaySource) {
  let attempt = 0;

  const run = async () => {
    while (!stopped) {
      const lastTs = await getState(redis, source.stateKey);
      lastPersistedTsByStateKey.set(source.stateKey, lastTs);
      const nowSec = Math.floor(Date.now() / 1000);
      const since = buildSince(nowSec, lastTs);

      const subId = makeSubId();

      logger.info({ source: source.name, relayUrl: source.relayUrl, since }, 'connecting relay source');

      ws = new WebSocket(source.relayUrl, {
        handshakeTimeout: 15000,
        maxPayload: config.MAX_EVENT_BYTES * 2,
        perMessageDeflate: false
      });
      activeSockets.add(ws);

      try {
        await new Promise<void>((resolve, reject) => {
          ws!.once('open', () => resolve());
          ws!.once('error', (err) => reject(err));
        });
      } catch (err) {
        const delay = nextDelay(attempt++);
        logger.error({ err, source: source.name, delay }, 'ws open failed, retrying');
        activeSockets.delete(ws);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      attempt = 0;

      const req = source.buildReq(subId, since);
      ws.send(JSON.stringify(req));

      let messageQueue = Promise.resolve();
      let queuedMessages = 0;
      ws.on('message', (data) => {
        if (queuedMessages >= config.MAX_MESSAGE_QUEUE) {
          droppedByBackpressure += 1;
          maybeLogMetrics();
          logger.warn({ maxQueue: config.MAX_MESSAGE_QUEUE }, 'dropping message due to queue backpressure');
          return;
        }
        queuedMessages += 1;
        maxQueuedMessages = Math.max(maxQueuedMessages, queuedMessages);
        messageQueue = messageQueue
          .then(async () => {
            try {
              const msg = JSON.parse(data.toString());
              const [type, sid, payload] = msg;

              if (type === 'EVENT' && sid === subId) {
                await handleEvent(payload, source);
              }

              if (type === 'EOSE' && sid === subId) {
                logger.info({ source: source.name }, 'initial backfill complete (EOSE)');
              }

              if (type === 'NOTICE') {
                logger.warn({ notice: payload }, 'relay notice');
              }
            } catch (err) {
              logger.error({ err }, 'message handling error');
            }
          })
          .finally(() => {
            queuedMessages = Math.max(0, queuedMessages - 1);
          })
          .catch((err) => {
            logger.error({ err }, 'message queue error');
          });
      });

      await new Promise<void>((resolve) => {
        ws!.once('close', () => resolve());
        ws!.once('error', () => resolve());
      });
      activeSockets.delete(ws);

      if (stopped) break;

      maybeLogMetrics();

      const delay = nextDelay(attempt++);
      logger.warn({ source: source.name, delay }, 'ws closed, reconnecting');
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

  const sources: RelaySource[] = [
    {
      name: 'primary',
      relayUrl: config.STRFRY_URL,
      sourceType: 'strfry_ws',
      stateKey: STATE_KEY,
      buildReq: (_subId, since) => ['REQ', _subId, { since }],
    },
  ];

  if (config.TAGR_RELAY_URL) {
    const expectedTagrPubkey = config.TAGR_BOT_PUBKEY.toLowerCase();
    sources.push({
      name: 'tagr',
      relayUrl: config.TAGR_RELAY_URL,
      sourceType: 'tagr_ws',
      stateKey: TAGR_STATE_KEY,
      buildReq: (_subId, since) => [
        'REQ',
        _subId,
        {
          since,
          authors: [expectedTagrPubkey],
          kinds: TAGR_KINDS,
          limit: 500,
        },
      ],
      acceptEvent: (event) => (
        event.pubkey.toLowerCase() === expectedTagrPubkey && TAGR_KINDS.includes(event.kind)
      ),
    });
    logger.info({ relayUrl: config.TAGR_RELAY_URL, pubkey: expectedTagrPubkey }, 'tagr source enabled');
  }

  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    maybeLogMetrics(true);
    logger.info('shutting down');
    for (const socket of activeSockets) {
      try { socket.close(); } catch {}
    }
    try { ws?.close(); } catch {}
    try { await redis.quit(); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  for (const source of sources) {
    connectLoop(source);
  }
}

main();
