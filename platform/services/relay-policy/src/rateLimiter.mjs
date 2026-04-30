import crypto from 'node:crypto';

const DEFAULTS = {
  mode: 'enforce',
  pubkeyPointsPerMinute: 120,
  sourcePointsPerMinute: 600,
  globalPointsPerSecond: 250,
  burstMultiplier: 2,
  duplicateTtlMs: 10 * 60 * 1000,
  penaltyTtlMs: 15 * 60 * 1000,
  hellthreadTagLimit: 80,
  maxTags: 2000,
  pruneIntervalMs: 60 * 1000,
};

const REPLACEABLE_KINDS = new Set([0, 3, 10002, 10050, 10063]);
const SOCIAL_LIGHT_KINDS = new Set([6, 7, 16, 9735]);
const MEDIA_KINDS = new Set([21, 22, 1063, 34235, 34236]);
const MODERATION_KINDS = new Set([1984, 1985]);

class TokenBucket {
  constructor(ratePerMs, capacity, now) {
    this.ratePerMs = ratePerMs;
    this.capacity = capacity;
    this.tokens = capacity;
    this.updatedAt = now;
    this.lastSeenAt = now;
  }

  refill(now) {
    const elapsed = Math.max(0, now - this.updatedAt);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.ratePerMs);
    this.updatedAt = now;
    this.lastSeenAt = now;
  }

  tryTake(cost, now) {
    this.refill(now);
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return { ok: true, retryMs: 0 };
    }

    const deficit = cost - this.tokens;
    const retryMs = this.ratePerMs > 0 ? Math.ceil(deficit / this.ratePerMs) : 60_000;
    return { ok: false, retryMs };
  }
}

export function parsePolicyConfig(env = process.env) {
  const numberFromEnv = (name, fallback) => {
    const parsed = Number(env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    mode: env.RELAY_POLICY_MODE === 'observe' ? 'observe' : DEFAULTS.mode,
    pubkeyPointsPerMinute: numberFromEnv('RELAY_POLICY_PUBKEY_POINTS_PER_MINUTE', DEFAULTS.pubkeyPointsPerMinute),
    sourcePointsPerMinute: numberFromEnv('RELAY_POLICY_SOURCE_POINTS_PER_MINUTE', DEFAULTS.sourcePointsPerMinute),
    globalPointsPerSecond: numberFromEnv('RELAY_POLICY_GLOBAL_POINTS_PER_SECOND', DEFAULTS.globalPointsPerSecond),
    burstMultiplier: numberFromEnv('RELAY_POLICY_BURST_MULTIPLIER', DEFAULTS.burstMultiplier),
    duplicateTtlMs: numberFromEnv('RELAY_POLICY_DUPLICATE_TTL_MS', DEFAULTS.duplicateTtlMs),
    penaltyTtlMs: numberFromEnv('RELAY_POLICY_PENALTY_TTL_MS', DEFAULTS.penaltyTtlMs),
    hellthreadTagLimit: numberFromEnv('RELAY_POLICY_HELLTHREAD_TAG_LIMIT', DEFAULTS.hellthreadTagLimit),
    maxTags: numberFromEnv('RELAY_POLICY_MAX_TAGS', DEFAULTS.maxTags),
    pruneIntervalMs: DEFAULTS.pruneIntervalMs,
    allowlistPubkeys: parseCsvSet(env.RELAY_POLICY_ALLOWLIST_PUBKEYS),
    allowlistSources: parseCsvSet(env.RELAY_POLICY_ALLOWLIST_SOURCES),
  };
}

export function createRelayRateLimiter(config = parsePolicyConfig()) {
  const state = {
    pubkeyBuckets: new Map(),
    sourceBuckets: new Map(),
    recentFingerprints: new Map(),
    penalties: new Map(),
    globalBucket: null,
    lastPrunedAt: 0,
  };

  return {
    evaluate(message, now = Date.now()) {
      const event = normalizeEvent(message?.event ?? message);
      const eventId = event?.id ?? message?.id ?? '';

      if (!event) {
        return allow(eventId, 'missing event payload');
      }

      if (config.allowlistPubkeys.has(event.pubkey)) {
        return allow(event.id, 'allowlisted pubkey');
      }

      const sourceKey = getSourceKey(message);
      if (sourceKey && config.allowlistSources.has(sourceKey)) {
        return allow(event.id, 'allowlisted source');
      }

      pruneState(state, config, now);

      const validation = validateShape(event, config);
      if (!validation.ok) {
        recordPenalty(state, `pubkey:${event.pubkey}`, now);
        recordPenalty(state, `source:${sourceKey}`, now);
        return blocked(config, event.id, 'reject', validation.reason);
      }

      const duplicate = checkDuplicate(state, event, config, now);
      if (!duplicate.ok) {
        recordPenalty(state, `pubkey:${event.pubkey}`, now);
        return blocked(config, event.id, 'reject', duplicate.reason);
      }

      const eventCost = weightedEventCost(event) * penaltyMultiplier(state, config, event.pubkey, sourceKey, now);
      const globalBucket = getGlobalBucket(state, config, now);
      const globalResult = globalBucket.tryTake(eventCost, now);
      if (!globalResult.ok) {
        return blocked(config, event.id, 'reject', retryReason('global', globalResult.retryMs));
      }

      const pubkeyBucket = getBucket(
        state.pubkeyBuckets,
        event.pubkey,
        config.pubkeyPointsPerMinute,
        config.burstMultiplier,
        now,
      );
      const pubkeyResult = pubkeyBucket.tryTake(eventCost, now);
      if (!pubkeyResult.ok) {
        recordPenalty(state, `pubkey:${event.pubkey}`, now);
        return blocked(config, event.id, 'reject', retryReason('pubkey', pubkeyResult.retryMs));
      }

      if (sourceKey) {
        const sourceBucket = getBucket(
          state.sourceBuckets,
          sourceKey,
          config.sourcePointsPerMinute,
          config.burstMultiplier,
          now,
        );
        const sourceResult = sourceBucket.tryTake(eventCost, now);
        if (!sourceResult.ok) {
          recordPenalty(state, `source:${sourceKey}`, now);
          return blocked(config, event.id, 'reject', retryReason('source', sourceResult.retryMs));
        }
      }

      rememberFingerprint(state, event, now);
      return allow(event.id, `cost=${eventCost.toFixed(2)}`);
    },
    snapshot() {
      return {
        pubkeyBuckets: state.pubkeyBuckets.size,
        sourceBuckets: state.sourceBuckets.size,
        recentFingerprints: state.recentFingerprints.size,
        penalties: state.penalties.size,
      };
    },
  };
}

export function strfryOutputForDecision(decision) {
  return {
    id: decision.id,
    action: decision.action,
    msg: decision.msg,
  };
}

function allow(id, msg = '') {
  return {
    id,
    action: 'accept',
    msg,
  };
}

function blocked(config, id, action, msg) {
  if (config.mode === 'observe') {
    return {
      id,
      action: 'accept',
      msg: `observe-only: ${msg}`,
    };
  }

  return {
    id,
    action,
    msg,
  };
}

function normalizeEvent(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.id !== 'string') return null;
  if (typeof value.pubkey !== 'string') return null;
  if (!Number.isInteger(value.kind)) return null;
  if (!Array.isArray(value.tags)) return null;
  return {
    id: value.id.toLowerCase(),
    pubkey: value.pubkey.toLowerCase(),
    kind: value.kind,
    created_at: value.created_at,
    content: typeof value.content === 'string' ? value.content : '',
    tags: value.tags.filter(Array.isArray),
  };
}

function validateShape(event, config) {
  if (!/^[0-9a-f]{64}$/.test(event.id)) {
    return { ok: false, reason: 'invalid: event id must be lowercase hex64' };
  }
  if (!/^[0-9a-f]{64}$/.test(event.pubkey)) {
    return { ok: false, reason: 'invalid: pubkey must be lowercase hex64' };
  }
  if (event.tags.length > config.maxTags) {
    return { ok: false, reason: `rate-limited: too many tags (${event.tags.length}/${config.maxTags})` };
  }

  const pTags = event.tags.filter((tag) => tag[0] === 'p').length;
  if (pTags > config.hellthreadTagLimit) {
    return { ok: false, reason: `rate-limited: excessive p-tag fanout (${pTags}/${config.hellthreadTagLimit})` };
  }

  return { ok: true };
}

function weightedEventCost(event) {
  const contentBytes = Buffer.byteLength(event.content, 'utf8');
  const tagCount = event.tags.length;
  const pTagCount = event.tags.filter((tag) => tag[0] === 'p').length;

  let cost = kindBaseCost(event.kind);
  cost += Math.ceil(contentBytes / 4096) * 0.5;
  cost += Math.max(0, tagCount - 20) / 20;
  cost += Math.max(0, pTagCount - 20) / 5;

  return Math.max(1, Number(cost.toFixed(2)));
}

function kindBaseCost(kind) {
  if (SOCIAL_LIGHT_KINDS.has(kind)) return 0.75;
  if (REPLACEABLE_KINDS.has(kind)) return 1.25;
  if (MEDIA_KINDS.has(kind)) return 2;
  if (MODERATION_KINDS.has(kind)) return 3;
  if (kind >= 30000 && kind < 40000) return 2.5;
  if (kind === 1 || kind === 1111) return 1;
  return 2;
}

function checkDuplicate(state, event, config, now) {
  const fingerprint = eventFingerprint(event);
  const prior = state.recentFingerprints.get(fingerprint);
  if (!prior) return { ok: true };

  if (now - prior.firstSeenAt <= config.duplicateTtlMs) {
    return {
      ok: false,
      reason: 'rate-limited: duplicate event body recently published',
    };
  }

  return { ok: true };
}

function rememberFingerprint(state, event, now) {
  state.recentFingerprints.set(eventFingerprint(event), {
    firstSeenAt: now,
    eventId: event.id,
  });
}

function eventFingerprint(event) {
  const interestingTags = event.tags
    .filter((tag) => ['a', 'd', 'e', 'p', 't', 'url', 'x'].includes(tag[0]))
    .map((tag) => tag.slice(0, 3).join('\u001f'))
    .sort();
  return crypto
    .createHash('sha256')
    .update(`${event.pubkey}\n${event.kind}\n${event.content.trim()}\n${interestingTags.join('\n')}`)
    .digest('hex');
}

function getBucket(map, key, pointsPerMinute, burstMultiplier, now) {
  const capacity = pointsPerMinute * burstMultiplier;
  const ratePerMs = pointsPerMinute / 60_000;
  const existing = map.get(key);
  if (existing) return existing;

  const bucket = new TokenBucket(ratePerMs, capacity, now);
  map.set(key, bucket);
  return bucket;
}

function getGlobalBucket(state, config, now) {
  if (!state.globalBucket) {
    state.globalBucket = new TokenBucket(
      config.globalPointsPerSecond / 1000,
      config.globalPointsPerSecond * config.burstMultiplier,
      now,
    );
  }
  return state.globalBucket;
}

function getSourceKey(message) {
  const source = message?.sourceInfo ?? message?.source ?? {};
  if (typeof source === 'string') return source;

  const value = source.remoteAddress
    ?? source.remoteAddr
    ?? source.clientAddress
    ?? source.ip
    ?? source.addr
    ?? source.relay_url
    ?? null;

  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
}

function recordPenalty(state, key, now) {
  const current = state.penalties.get(key);
  state.penalties.set(key, {
    count: (current?.count ?? 0) + 1,
    lastSeenAt: now,
  });
}

function penaltyMultiplier(state, config, pubkey, sourceKey, now) {
  const pubkeyPenalty = activePenaltyCount(state, config, `pubkey:${pubkey}`, now);
  const sourcePenalty = activePenaltyCount(state, config, `source:${sourceKey}`, now);
  return 1 + Math.min(4, (pubkeyPenalty + sourcePenalty) * 0.25);
}

function activePenaltyCount(state, config, key, now) {
  const penalty = state.penalties.get(key);
  if (!penalty) return 0;
  if (now - penalty.lastSeenAt > config.penaltyTtlMs) {
    state.penalties.delete(key);
    return 0;
  }
  return penalty.count;
}

function retryReason(bucketName, retryMs) {
  const seconds = Math.max(1, Math.ceil(retryMs / 1000));
  return `rate-limited: ${bucketName} bucket exhausted; retry in ${seconds}s`;
}

function pruneState(state, config, now) {
  if (now - state.lastPrunedAt < config.pruneIntervalMs) return;
  state.lastPrunedAt = now;

  pruneBuckets(state.pubkeyBuckets, now, config.penaltyTtlMs);
  pruneBuckets(state.sourceBuckets, now, config.penaltyTtlMs);
  pruneTimedMap(state.penalties, now, config.penaltyTtlMs, (value) => value.lastSeenAt);
  pruneTimedMap(state.recentFingerprints, now, config.duplicateTtlMs, (value) => value.firstSeenAt);
}

function pruneBuckets(map, now, ttlMs) {
  for (const [key, bucket] of map.entries()) {
    if (now - bucket.lastSeenAt > ttlMs) map.delete(key);
  }
}

function pruneTimedMap(map, now, ttlMs, getTimestamp) {
  for (const [key, value] of map.entries()) {
    if (now - getTimestamp(value) > ttlMs) map.delete(key);
  }
}

function parseCsvSet(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}
