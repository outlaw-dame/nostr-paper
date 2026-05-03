/**
 * Relay-side fact-check filter.
 *
 * Extracts hostnames from event content and maintains an in-memory cache of
 * hostnames that have been flagged by the Google Fact Check Tools API.  API
 * calls are made in the background so relay evaluation is never blocked.
 *
 * Config env vars (all optional; filter is a no-op when RELAY_FACT_CHECK_ENABLED
 * is not set to 'true'):
 *   RELAY_FACT_CHECK_ENABLED              'true' | 'false'  (default: 'false')
 *   RELAY_FACT_CHECK_API_KEY              Google API key
 *   RELAY_FACT_CHECK_FLAG_COST_MULTIPLIER number            (default: 3)
 *   RELAY_FACT_CHECK_CACHE_TTL_MS         number            (default: 3600000)
 *   RELAY_FACT_CHECK_REFRESH_INTERVAL_MS  number            (default: 300000)
 *   RELAY_FACT_CHECK_MAX_QUEUE            number            (default: 500)
 */

import { createHash } from 'node:crypto';

const FACT_CHECK_API =
  'https://factchecktools.googleapis.com/v1alpha1/claims:search';

// Ratings that indicate a claim is false/misleading.
const FALSE_RATINGS = new Set([
  'false',
  'mostly false',
  'pants on fire',
  'incorrect',
  'inaccurate',
  'misleading',
  'debunked',
  'fiction',
  'fabricated',
]);

// Detect http/https URLs, capturing the hostname.
const URL_RE =
  /https?:\/\/(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)/gi;

/** Extract up to `limit` distinct hostnames from an event content string. */
export function extractHostnames(content, limit = 5) {
  if (!content || typeof content !== 'string') return [];
  const seen = new Set();
  let match;
  while ((match = URL_RE.exec(content)) !== null && seen.size < limit) {
    seen.add(match[1].toLowerCase());
  }
  // Reset lastIndex (global flag retains state between calls).
  URL_RE.lastIndex = 0;
  return [...seen];
}

/**
 * Parse fact-check related config fields from an env-style object.
 * Returns null when the filter is disabled or no API key is present.
 */
export function parseFactCheckConfig(env = process.env) {
  if (env.RELAY_FACT_CHECK_ENABLED !== 'true') return null;
  const apiKey =
    typeof env.RELAY_FACT_CHECK_API_KEY === 'string' &&
    env.RELAY_FACT_CHECK_API_KEY.trim().length > 0
      ? env.RELAY_FACT_CHECK_API_KEY.trim()
      : null;
  if (!apiKey) return null;

  const num = (name, fallback) => {
    const n = Number(env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  return {
    apiKey,
    flagCostMultiplier: num('RELAY_FACT_CHECK_FLAG_COST_MULTIPLIER', 3),
    cacheTtlMs: num('RELAY_FACT_CHECK_CACHE_TTL_MS', 60 * 60 * 1000),
    refreshIntervalMs: num('RELAY_FACT_CHECK_REFRESH_INTERVAL_MS', 5 * 60 * 1000),
    maxQueue: num('RELAY_FACT_CHECK_MAX_QUEUE', 500),
  };
}

/**
 * Create a fact-check filter instance.
 *
 * @param {ReturnType<typeof parseFactCheckConfig>} config
 *   Pass null to create a no-op filter (disabled when fact check is off).
 * @param {{ flaggedHostnames?: Set<string> }} [overrides]
 *   Test-only: pre-seed the flagged hostname set.
 */
export function createFactCheckFilter(config, overrides = {}) {
  if (!config) {
    return {
      isHostnameFlagged: () => false,
      extractHostnames,
      queueForCheck: () => {},
      flagCostMultiplier: 1,
      shutdown: () => {},
    };
  }

  /** @type {Map<string, { flaggedAt: number }>} */
  const flaggedHostnames = new Map(
    [...(overrides.flaggedHostnames ?? [])].map((h) => [h, { flaggedAt: Date.now() }]),
  );
  /** @type {Map<string, number>} already-checked hostnames → checkedAt */
  const checkedHostnames = new Map();
  /** @type {Set<string>} pending hostnames waiting for API lookup */
  const pendingQueue = new Set();

  let refreshTimer = null;

  function isHostnameFlagged(hostname) {
    const entry = flaggedHostnames.get(hostname.toLowerCase());
    if (!entry) return false;
    if (Date.now() - entry.flaggedAt > config.cacheTtlMs) {
      flaggedHostnames.delete(hostname.toLowerCase());
      return false;
    }
    return true;
  }

  function queueForCheck(hostname) {
    const h = hostname.toLowerCase();
    if (flaggedHostnames.has(h)) return;
    const checked = checkedHostnames.get(h);
    if (checked && Date.now() - checked < config.cacheTtlMs) return;
    if (pendingQueue.size >= config.maxQueue) return;
    pendingQueue.add(h);
    scheduleFlush();
  }

  let flushScheduled = false;
  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    // Drain next tick so we batch within a single event loop turn.
    setImmediate(flushQueue);
  }

  async function flushQueue() {
    flushScheduled = false;
    if (pendingQueue.size === 0) return;

    const batch = [...pendingQueue].slice(0, 20);
    batch.forEach((h) => pendingQueue.delete(h));

    await Promise.allSettled(batch.map(checkHostname));
  }

  async function checkHostname(hostname) {
    const now = Date.now();
    checkedHostnames.set(hostname, now);

    const url = new URL(FACT_CHECK_API);
    url.searchParams.set('query', hostname);
    url.searchParams.set('key', config.apiKey);
    url.searchParams.set('pageSize', '5');
    url.searchParams.set('languageCode', 'en');

    let data;
    try {
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        process.stderr.write(
          `[relay-policy/fact-check] API error ${res.status} for ${hostname}\n`,
        );
        return;
      }
      data = await res.json();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[relay-policy/fact-check] fetch failed for ${hostname}: ${reason}\n`,
      );
      return;
    }

    if (!data || !Array.isArray(data.claims)) return;

    const isFlagged = data.claims.some((claim) =>
      Array.isArray(claim?.claimReview) &&
      claim.claimReview.some((review) => {
        const rating = (review?.textualRating ?? '').toLowerCase().trim();
        return FALSE_RATINGS.has(rating);
      }),
    );

    if (isFlagged) {
      flaggedHostnames.set(hostname, { flaggedAt: now });
      process.stderr.write(
        `[relay-policy/fact-check] flagged hostname: ${hostname}\n`,
      );
    }
  }

  // Periodically re-check hostnames whose cache entry is near expiry.
  refreshTimer = setInterval(() => {
    const now = Date.now();
    for (const [hostname, { flaggedAt }] of flaggedHostnames.entries()) {
      if (now - flaggedAt > config.cacheTtlMs * 0.9) {
        checkedHostnames.delete(hostname);
        pendingQueue.add(hostname);
      }
    }
    if (pendingQueue.size > 0) flushQueue().catch(() => {});
  }, config.refreshIntervalMs).unref();

  function shutdown() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  return {
    isHostnameFlagged,
    extractHostnames,
    queueForCheck,
    flagCostMultiplier: config.flagCostMultiplier,
    shutdown,
  };
}
