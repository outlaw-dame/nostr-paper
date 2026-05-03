import WebSocket, { WebSocketServer } from 'ws';
import { Pool } from 'pg';
import pino from 'pino';
import { embedText, warmupEmbedder } from 'semantic-embedder';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const db = new Pool({
  connectionString: process.env.POSTGRES_URL
});

const PORT = Number(process.env.PORT || 3001);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const LOG_RELAY_REQS = process.env.LOG_RELAY_REQS === 'true';
const MODERATION_OPS_TOKEN = typeof process.env.MODERATION_OPS_TOKEN === 'string'
  ? process.env.MODERATION_OPS_TOKEN.trim()
  : '';

interface RuntimeFeatureFlags {
  phase1FactCheckContext: boolean;
  phase2BlindspotPanel: boolean;
  phase3SourceLensBadges: boolean;
  phase4MediaDietTracking: boolean;
}

const DEFAULT_RUNTIME_FEATURE_FLAGS: RuntimeFeatureFlags = {
  phase1FactCheckContext: true,
  phase2BlindspotPanel: true,
  phase3SourceLensBadges: true,
  phase4MediaDietTracking: true,
};

function parseBooleanLike(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return fallback;
}

function loadInitialRuntimeFeatureFlags(): RuntimeFeatureFlags {
  const fromEnv = process.env.RUNTIME_FEATURE_FLAGS_JSON ?? process.env.FEATURE_FLAGS_JSON ?? '';
  if (!fromEnv.trim()) {
    return {
      ...DEFAULT_RUNTIME_FEATURE_FLAGS,
      phase1FactCheckContext: parseBooleanLike(process.env.FEATURE_PHASE1_FACTCHECK, DEFAULT_RUNTIME_FEATURE_FLAGS.phase1FactCheckContext),
      phase2BlindspotPanel: parseBooleanLike(process.env.FEATURE_PHASE2_BLINDSPOT, DEFAULT_RUNTIME_FEATURE_FLAGS.phase2BlindspotPanel),
      phase3SourceLensBadges: parseBooleanLike(process.env.FEATURE_PHASE3_SOURCE_LENS, DEFAULT_RUNTIME_FEATURE_FLAGS.phase3SourceLensBadges),
      phase4MediaDietTracking: parseBooleanLike(process.env.FEATURE_PHASE4_MEDIA_DIET, DEFAULT_RUNTIME_FEATURE_FLAGS.phase4MediaDietTracking),
    };
  }

  try {
    const parsed = JSON.parse(fromEnv) as Partial<RuntimeFeatureFlags>;
    return {
      phase1FactCheckContext: parseBooleanLike(parsed.phase1FactCheckContext, DEFAULT_RUNTIME_FEATURE_FLAGS.phase1FactCheckContext),
      phase2BlindspotPanel: parseBooleanLike(parsed.phase2BlindspotPanel, DEFAULT_RUNTIME_FEATURE_FLAGS.phase2BlindspotPanel),
      phase3SourceLensBadges: parseBooleanLike(parsed.phase3SourceLensBadges, DEFAULT_RUNTIME_FEATURE_FLAGS.phase3SourceLensBadges),
      phase4MediaDietTracking: parseBooleanLike(parsed.phase4MediaDietTracking, DEFAULT_RUNTIME_FEATURE_FLAGS.phase4MediaDietTracking),
    };
  } catch (error) {
    log.warn({ err: error }, 'invalid runtime feature flags JSON; using defaults');
    return { ...DEFAULT_RUNTIME_FEATURE_FLAGS };
  }
}

let runtimeFeatureFlags: RuntimeFeatureFlags = loadInitialRuntimeFeatureFlags();
let runtimeFeatureFlagsUpdatedAt = new Date().toISOString();

function sanitizeLimit(rawLimit: unknown): number {
  const parsed = safeNumber(rawLimit);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }
  const normalized = Math.trunc(parsed as number);
  return Math.max(1, Math.min(normalized, MAX_LIMIT));
}

/**
 * Sanitizers (strict)
 */
function safeArray<T>(val: any): T[] | undefined {
  return Array.isArray(val) ? val : undefined;
}

function safeNumber(val: any): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function safeString(val: any): string | undefined {
  return typeof val === 'string' ? val : undefined;
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

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
}

function isOpsAuthorized(req: IncomingMessage): boolean {
  if (!MODERATION_OPS_TOKEN) return true;
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== 'string') return false;

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  return token === MODERATION_OPS_TOKEN;
}

function setReadCorsHeaders(res: ServerResponse, origin: string | undefined): void {
  res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
}

async function handleFeatureFlagsRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = parseUrl(req);
  if (url.pathname !== '/feature-flags' && url.pathname !== '/v1/feature-flags') {
    return false;
  }

  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  setReadCorsHeaders(res, origin);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return true;
  }

  sendJson(res, 200, {
    flags: runtimeFeatureFlags,
    updatedAt: runtimeFeatureFlagsUpdatedAt,
  });
  return true;
}

async function handleFeatureFlagsOpsRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = parseUrl(req);
  if (!url.pathname.startsWith('/ops/feature-flags')) {
    return false;
  }

  if (!isOpsAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  setReadCorsHeaders(res, origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (req.method === 'GET') {
    sendJson(res, 200, {
      flags: runtimeFeatureFlags,
      updatedAt: runtimeFeatureFlagsUpdatedAt,
    });
    return true;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return true;
  }

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    if (error instanceof Error && error.message === 'payload_too_large') {
      sendJson(res, 413, { error: 'payload_too_large' });
      return true;
    }
    sendJson(res, 400, { error: 'invalid_json' });
    return true;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return true;
  }

  const payload = body as { flags?: Partial<RuntimeFeatureFlags> };
  const flags = payload.flags && typeof payload.flags === 'object' ? payload.flags : {};

  runtimeFeatureFlags = {
    phase1FactCheckContext: parseBooleanLike(flags.phase1FactCheckContext, runtimeFeatureFlags.phase1FactCheckContext),
    phase2BlindspotPanel: parseBooleanLike(flags.phase2BlindspotPanel, runtimeFeatureFlags.phase2BlindspotPanel),
    phase3SourceLensBadges: parseBooleanLike(flags.phase3SourceLensBadges, runtimeFeatureFlags.phase3SourceLensBadges),
    phase4MediaDietTracking: parseBooleanLike(flags.phase4MediaDietTracking, runtimeFeatureFlags.phase4MediaDietTracking),
  };
  runtimeFeatureFlagsUpdatedAt = new Date().toISOString();

  log.info({ flags: runtimeFeatureFlags }, 'runtime feature flags updated');
  sendJson(res, 200, {
    ok: true,
    flags: runtimeFeatureFlags,
    updatedAt: runtimeFeatureFlagsUpdatedAt,
  });
  return true;
}

async function queryModerationStats() {
  const docsResult = await db.query<{ moderation_state: string; count: string }>(`
    SELECT moderation_state, COUNT(*)::text AS count
    FROM search_docs
    GROUP BY moderation_state
  `);

  const tagrResult = await db.query<{ reason: string; policy_version: string; count: string }>(`
    SELECT reason, policy_version, COUNT(*)::text AS count
    FROM tagr_blocks
    GROUP BY reason, policy_version
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `);

  const keywordResult = await db.query<{ reason: string; policy_version: string; count: string }>(`
    SELECT reason, policy_version, COUNT(*)::text AS count
    FROM keyword_blocks
    GROUP BY reason, policy_version
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `);

  return {
    byState: docsResult.rows.map((row) => ({ state: row.moderation_state, count: Number(row.count) })),
    tagrTopReasons: tagrResult.rows.map((row) => ({
      reason: row.reason,
      policyVersion: row.policy_version,
      count: Number(row.count),
    })),
    keywordTopReasons: keywordResult.rows.map((row) => ({
      reason: row.reason,
      policyVersion: row.policy_version,
      count: Number(row.count),
    })),
  };
}

async function queryBlockedEvents(opts: { source: 'all' | 'tagr' | 'keyword'; reason?: string; limit: number }) {
  if (opts.source === 'tagr') {
    const result = await db.query<{
      event_id: string;
      reason: string;
      policy_version: string;
      blocked_at: string;
      kind: number | null;
      author_pubkey: string | null;
    }>(
      `
      SELECT
        tb.event_id,
        tb.reason,
        tb.policy_version,
        tb.blocked_at::text,
        sd.kind,
        sd.author_pubkey
      FROM tagr_blocks tb
      LEFT JOIN search_docs sd ON sd.event_id = tb.event_id
      WHERE ($1::text IS NULL OR tb.reason = $1)
      ORDER BY tb.blocked_at DESC
      LIMIT $2
      `,
      [opts.reason ?? null, opts.limit],
    );

    return result.rows.map((row) => ({
      eventId: row.event_id,
      source: 'tagr',
      reason: row.reason,
      policyVersion: row.policy_version,
      blockedAt: row.blocked_at,
      kind: row.kind,
      authorPubkey: row.author_pubkey,
    }));
  }

  if (opts.source === 'keyword') {
    const result = await db.query<{
      event_id: string;
      reason: string;
      policy_version: string;
      blocked_at: string;
      kind: number | null;
      author_pubkey: string | null;
    }>(
      `
      SELECT
        kb.event_id,
        kb.reason,
        kb.policy_version,
        kb.blocked_at::text,
        sd.kind,
        sd.author_pubkey
      FROM keyword_blocks kb
      LEFT JOIN search_docs sd ON sd.event_id = kb.event_id
      WHERE ($1::text IS NULL OR kb.reason = $1)
      ORDER BY kb.blocked_at DESC
      LIMIT $2
      `,
      [opts.reason ?? null, opts.limit],
    );

    return result.rows.map((row) => ({
      eventId: row.event_id,
      source: 'keyword',
      reason: row.reason,
      policyVersion: row.policy_version,
      blockedAt: row.blocked_at,
      kind: row.kind,
      authorPubkey: row.author_pubkey,
    }));
  }

  const result = await db.query<{
    source: 'tagr' | 'keyword';
    event_id: string;
    reason: string;
    policy_version: string;
    blocked_at: string;
    kind: number | null;
    author_pubkey: string | null;
  }>(
    `
    SELECT
      merged.source,
      merged.event_id,
      merged.reason,
      merged.policy_version,
      merged.blocked_at::text,
      sd.kind,
      sd.author_pubkey
    FROM (
      SELECT 'tagr'::text AS source, event_id, reason, policy_version, blocked_at
      FROM tagr_blocks
      UNION ALL
      SELECT 'keyword'::text AS source, event_id, reason, policy_version, blocked_at
      FROM keyword_blocks
    ) merged
    LEFT JOIN search_docs sd ON sd.event_id = merged.event_id
    WHERE ($1::text IS NULL OR merged.reason = $1)
    ORDER BY merged.blocked_at DESC
    LIMIT $2
    `,
    [opts.reason ?? null, opts.limit],
  );

  return result.rows.map((row) => ({
    eventId: row.event_id,
    source: row.source,
    reason: row.reason,
    policyVersion: row.policy_version,
    blockedAt: row.blocked_at,
    kind: row.kind,
    authorPubkey: row.author_pubkey,
  }));
}

async function reconcileModerationState() {
  const result = await db.query(`
    UPDATE search_docs sd
    SET moderation_state = CASE
      WHEN EXISTS (SELECT 1 FROM keyword_blocks kb WHERE kb.event_id = sd.event_id) THEN 'blocked'
      WHEN EXISTS (SELECT 1 FROM tagr_blocks tb WHERE tb.event_id = sd.event_id) THEN 'blocked'
      ELSE 'allowed'
    END
  `);

  return { updatedRows: result.rowCount ?? 0 };
}

async function handleOpsRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = parseUrl(req);

  if (!url.pathname.startsWith('/ops/moderation')) {
    return false;
  }

  if (!isOpsAuthorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/ops/moderation/stats') {
      const stats = await queryModerationStats();
      sendJson(res, 200, stats);
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/ops/moderation/blocked') {
      const sourceRaw = url.searchParams.get('source') || 'all';
      const source = sourceRaw === 'tagr' || sourceRaw === 'keyword' ? sourceRaw : 'all';
      const reason = url.searchParams.get('reason') || undefined;
      const limit = sanitizeLimit(Number(url.searchParams.get('limit') || DEFAULT_LIMIT));
      const rows = await queryBlockedEvents({ source, reason, limit });
      sendJson(res, 200, { source, limit, rows });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/ops/moderation/reconcile') {
      const outcome = await reconcileModerationState();
      sendJson(res, 200, {
        ok: true,
        ...outcome,
        reconciledAt: new Date().toISOString(),
      });
      return true;
    }

    sendJson(res, 404, { error: 'not_found' });
    return true;
  } catch (error) {
    log.error({ err: error }, 'moderation ops request failed');
    sendJson(res, 500, { error: 'moderation_ops_failed' });
    return true;
  }
}

const FACT_CHECK_API_KEY = (
  process.env.GOOGLE_FACT_CHECK_API_KEY ??
  process.env.GEMINI_API_KEY ??
  process.env.VITE_GEMINI_API_KEY ??
  process.env.GOOGLE_API_KEY ??
  ''
).trim();
const FACT_CHECK_ENDPOINT = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';
const FACT_CHECK_MAX_QUERY = 500;
const FACT_CHECK_TIMEOUT_MS = 8_000;
const FACT_CHECK_MAX_RETRIES = 2;
const FACT_CHECK_BACKOFF_BASE_MS = 250;
const FACT_CHECK_BACKOFF_MAX_MS = 2_000;
const FACT_CHECK_ALLOWED_LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
const factCheckCache = new Map<string, { payload: unknown; expiresAt: number; staleUntil: number }>();
const FACT_CHECK_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const FACT_CHECK_STALE_MS = 24 * 60 * 60 * 1000; // 24h

function setCorsHeaders(res: ServerResponse, origin: string | undefined): void {
  res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
}

async function readBody(req: IncomingMessage, maxBytes = 8 * 1024): Promise<string> {
  return await new Promise((resolve, reject) => {
    let length = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > maxBytes) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalizeFactCheckQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, FACT_CHECK_MAX_QUERY);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'TimeoutError' || error.name === 'AbortError';
  }
  return error instanceof TypeError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  const exp = Math.min(FACT_CHECK_BACKOFF_MAX_MS, FACT_CHECK_BACKOFF_BASE_MS * (2 ** attempt));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exp / 3)));
  return Math.min(FACT_CHECK_BACKOFF_MAX_MS, exp + jitter);
}

async function fetchFactCheckUpstream(params: URLSearchParams, attempt = 0): Promise<Response | null> {
  try {
    const response = await fetch(`${FACT_CHECK_ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FACT_CHECK_TIMEOUT_MS),
    });

    if (!response.ok && attempt < FACT_CHECK_MAX_RETRIES && isRetryableStatus(response.status)) {
      await sleep(backoffDelay(attempt));
      return fetchFactCheckUpstream(params, attempt + 1);
    }

    return response;
  } catch (error) {
    if (attempt < FACT_CHECK_MAX_RETRIES && isRetryableError(error)) {
      await sleep(backoffDelay(attempt));
      return fetchFactCheckUpstream(params, attempt + 1);
    }
    return null;
  }
}

async function handleFactCheckRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  setCorsHeaders(res, origin);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!FACT_CHECK_API_KEY) {
    sendJson(res, 503, { error: 'fact_check_disabled' });
    return;
  }

  let body: unknown;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    if (error instanceof Error && error.message === 'payload_too_large') {
      sendJson(res, 413, { error: 'payload_too_large' });
      return;
    }
    sendJson(res, 400, { error: 'invalid_json' });
    return;
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  const record = body as Record<string, unknown>;
  const query = typeof record.query === 'string' ? normalizeFactCheckQuery(record.query) : '';
  const languageCodeRaw = typeof record.languageCode === 'string' ? record.languageCode.trim() : '';
  const languageCode = languageCodeRaw && FACT_CHECK_ALLOWED_LANG.test(languageCodeRaw)
    ? languageCodeRaw
    : '';

  if (!query) {
    sendJson(res, 400, { error: 'missing_query' });
    return;
  }
  if (query.length > FACT_CHECK_MAX_QUERY) {
    sendJson(res, 413, { error: 'query_too_long' });
    return;
  }

  const cacheKey = `${languageCode}|${query.toLowerCase()}`;
  const now = Date.now();
  const cached = factCheckCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    sendJson(res, 200, cached.payload);
    return;
  }

  const params = new URLSearchParams({ key: FACT_CHECK_API_KEY, query, pageSize: '5' });
  if (languageCode) params.set('languageCode', languageCode);

  try {
    const upstream = await fetchFactCheckUpstream(params);
    if (!upstream) {
      if (cached && cached.staleUntil > now) {
        sendJson(res, 200, cached.payload);
        return;
      }
      sendJson(res, 502, { error: 'fact_check_upstream_failed' });
      return;
    }

    if (!upstream.ok) {
      if (cached && cached.staleUntil > now) {
        sendJson(res, 200, cached.payload);
        return;
      }
      sendJson(res, isRetryableStatus(upstream.status) ? 502 : 400, { error: 'fact_check_upstream_failed' });
      return;
    }

    const payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    factCheckCache.set(cacheKey, {
      payload,
      expiresAt: now + FACT_CHECK_TTL_MS,
      staleUntil: now + FACT_CHECK_STALE_MS,
    });
    if (factCheckCache.size > 1000) {
      const oldestKey = factCheckCache.keys().next().value;
      if (oldestKey !== undefined) factCheckCache.delete(oldestKey);
    }
    sendJson(res, 200, payload);
  } catch (error) {
    if (cached && cached.staleUntil > now) {
      sendJson(res, 200, cached.payload);
      return;
    }
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    log.warn({ err: error }, 'fact check upstream error');
    sendJson(res, isTimeout ? 504 : 502, {
      error: isTimeout ? 'fact_check_timeout' : 'fact_check_failed',
    });
  }
}

function setupWebSocketServer() {
  const server = createServer((req, res) => {
    const url = parseUrl(req);

    if (url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (
      (url.pathname === '/fact-check/search' || url.pathname === '/v1/fact-check') &&
      (req.method === 'POST' || req.method === 'OPTIONS')
    ) {
      void handleFactCheckRequest(req, res);
      return;
    }

    void handleFeatureFlagsRequest(req, res).then((handledFeatureFlags) => {
      if (handledFeatureFlags) return;

      void handleFeatureFlagsOpsRequest(req, res).then((handledFeatureFlagOps) => {
        if (handledFeatureFlagOps) return;

        void handleOpsRequest(req, res).then((handled) => {
          if (!handled) {
            sendJson(res, 404, { error: 'not_found' });
          }
        });
      });
    });
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!Array.isArray(msg)) return;

      if (msg[0] === 'REQ') {
        const subId = msg[1];
        const filters = msg.slice(2);

        if (LOG_RELAY_REQS) {
          log.info({ subId, filterCount: filters.length }, 'relay REQ received');
        }

        for (const filter of filters) {
          if (!filter || typeof filter !== 'object') continue;

          const search = safeString(filter.search);
          if (!search) continue;

          // ── Thread fetch ──────────────────────────────────────────────────
          // thread_id:      fetch all events whose root_id = <event-id> (NIP-10 / NIP-22 by event id)
          // thread_address: fetch all NIP-22 comments whose root_address = <naddr> (addressable roots)
          const threadId      = safeString(filter.thread_id);
          const threadAddress = safeString(filter.thread_address);

          if (threadId || threadAddress) {
            const limit = sanitizeLimit(filter.limit);
            const kinds = safeArray<number>(filter.kinds);

            let threadRows: { event_id: string; raw: unknown }[];

            if (threadId) {
              // Include the root event itself (er.id = $1) plus all descendants
              // (sd.root_id = $1). Results ordered oldest-first for tree rendering.
              const res = await db.query(
                `
                SELECT er.id AS event_id, er.raw, sd.created_at
                FROM search_docs sd
                JOIN events_raw er ON er.id = sd.event_id
                WHERE
                  sd.is_searchable = true
                  AND sd.moderation_state = 'allowed'
                  AND er.deleted_at IS NULL
                  AND (sd.root_id = $1 OR er.id = $1)
                  AND ($2::int[] IS NULL OR sd.kind = ANY($2))
                ORDER BY sd.created_at ASC
                LIMIT $3
                `,
                [threadId, kinds ?? null, limit],
              );
              threadRows = res.rows;
            } else {
              // Addressable root (e.g. NIP-23 article): fetch all NIP-22 comments.
              const res = await db.query(
                `
                SELECT er.id AS event_id, er.raw, sd.created_at
                FROM search_docs sd
                JOIN events_raw er ON er.id = sd.event_id
                WHERE
                  sd.is_searchable = true
                  AND sd.moderation_state = 'allowed'
                  AND er.deleted_at IS NULL
                  AND sd.root_address = $1
                  AND ($2::int[] IS NULL OR sd.kind = ANY($2))
                ORDER BY sd.created_at ASC
                LIMIT $3
                `,
                [threadAddress, kinds ?? null, limit],
              );
              threadRows = res.rows;
            }

            for (const row of threadRows) {
              ws.send(JSON.stringify(['EVENT', subId, row.raw]));
            }
            ws.send(JSON.stringify(['EOSE', subId]));
            continue;
          }
          // ─────────────────────────────────────────────────────────────────


          const limit = sanitizeLimit(filter.limit);

          const kinds = safeArray<number>(filter.kinds);
          const authors = safeArray<string>(filter.authors);
          const since = safeNumber(filter.since);
          const until = safeNumber(filter.until);

          // Cursor (option B)
          const cursorScore = safeNumber(filter.cursor_score);
          const cursorTs = safeNumber(filter.cursor_ts);
          const cursorId = safeString(filter.cursor_id);

          if (LOG_RELAY_REQS) {
            log.info(
              {
                subId,
                search,
                limit,
                kindsCount: kinds?.length ?? 0,
                authorsCount: authors?.length ?? 0,
                since,
                until,
                hasCursor: cursorScore !== undefined && cursorTs !== undefined,
                cursorId: cursorId ?? null,
              },
              'relay search request',
            );
          }

          const embedding = await embedText(search);
          const pgVector = toPgVector(embedding);

          const res = await db.query(
            `
            WITH
              q AS (
                SELECT websearch_to_tsquery('simple', $1) AS query
              ),
              ranked AS (
                SELECT
                  er.id AS event_id,
                  er.raw,
                  sd.created_at,
                  ts_rank_cd(sd.fts, q.query) AS lexical_score,
                  (1 - (sd.embedding <=> $6::vector)) AS semantic_score,
                  (
                    1.0 / (60 + ROW_NUMBER() OVER (
                      ORDER BY ts_rank_cd(sd.fts, q.query) DESC
                    ))
                    +
                    1.0 / (60 + ROW_NUMBER() OVER (
                      ORDER BY (1 - (sd.embedding <=> $6::vector)) DESC
                    ))
                  ) AS rrf_score
                FROM search_docs sd
                JOIN events_raw er ON er.id = sd.event_id
                JOIN q ON true
                WHERE
                  sd.is_searchable = true
                  AND sd.moderation_state = 'allowed'
                  AND er.deleted_at IS NULL
                  AND ($2::int[] IS NULL OR sd.kind = ANY($2))
                  AND ($3::text[] IS NULL OR sd.author_pubkey = ANY($3))
                  AND ($4::double precision IS NULL OR sd.created_at >= to_timestamp($4))
                  AND ($5::double precision IS NULL OR sd.created_at <= to_timestamp($5))
                  AND (
                    sd.fts @@ q.query
                    OR sd.embedding IS NOT NULL
                  )
              )
            SELECT event_id, raw, rrf_score, created_at
            FROM ranked
            WHERE
              ($7::double precision IS NULL OR $8::double precision IS NULL)
              OR (
                $9::text IS NULL
                AND (rrf_score, created_at) < ($7, to_timestamp($8))
              )
              OR (
                $9::text IS NOT NULL
                AND (rrf_score, created_at, event_id) < ($7, to_timestamp($8), $9)
              )
            ORDER BY rrf_score DESC, created_at DESC, event_id DESC
            LIMIT $10
            `,
            [
              search,
              kinds ?? null,
              authors ?? null,
              since ?? null,
              until ?? null,
              pgVector,
              cursorScore ?? null,
              cursorTs ?? null,
              cursorId ?? null,
              limit
            ]
          );

          let lastScore: number | null = null;
          let lastTs: number | null = null;
          let lastId: string | null = null;

          for (const row of res.rows) {
            ws.send(JSON.stringify(['EVENT', subId, row.raw]));
            const score = Number(row.rrf_score);
            lastScore = Number.isFinite(score) ? score : null;
            lastTs = new Date(row.created_at).getTime() / 1000;
            lastId = safeString(row.event_id) ?? null;
          }

          if (lastScore !== null && lastTs !== null && lastId !== null) {
            ws.send(JSON.stringify([
              'NOTICE',
              JSON.stringify({
                type: 'cursor',
                cursor_score: lastScore,
                cursor_ts: lastTs,
                cursor_id: lastId
              })
            ]));
          }

          if (LOG_RELAY_REQS) {
            log.info(
              {
                subId,
                search,
                resultCount: res.rows.length,
                nextCursor: lastId !== null
                  ? { cursor_score: lastScore, cursor_ts: lastTs, cursor_id: lastId }
                  : null,
              },
              'relay search response',
            );
          }
        }

        ws.send(JSON.stringify(['EOSE', subId]));
      }

      if (msg[0] === 'CLOSE') {
        return;
      }
    } catch (err) {
      log.error({ err }, 'search relay error');
      try {
        ws.send(JSON.stringify(['NOTICE', 'invalid request']));
      } catch {}
    }
    });

    ws.on('error', (err) => {
      log.error({ err }, 'ws error');
    });
  });

  server.listen(PORT);

  return wss;
}

async function main() {
  await db.query('SELECT 1');
  log.info('warming semantic embedder');
  await warmupEmbedder();
  setupWebSocketServer();
  log.info(`search relay (hybrid + RRF + pagination) running on :${PORT}`);
}

main().catch((err) => {
  log.fatal({ err }, 'search relay crashed');
  process.exit(1);
});
