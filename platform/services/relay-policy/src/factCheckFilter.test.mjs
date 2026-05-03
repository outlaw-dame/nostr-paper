import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractHostnames,
  parseFactCheckConfig,
  createFactCheckFilter,
} from './factCheckFilter.mjs';

// ---------------------------------------------------------------------------
// extractHostnames
// ---------------------------------------------------------------------------

test('extractHostnames returns empty array for empty content', () => {
  assert.deepEqual(extractHostnames(''), []);
  assert.deepEqual(extractHostnames(null), []);
});

test('extractHostnames extracts single hostname', () => {
  const hosts = extractHostnames('Check out https://example.com/article/1');
  assert.deepEqual(hosts, ['example.com']);
});

test('extractHostnames strips www prefix', () => {
  const hosts = extractHostnames('See https://www.bbc.co.uk/news/story-1');
  assert.deepEqual(hosts, ['bbc.co.uk']);
});

test('extractHostnames deduplicates repeated hostname', () => {
  const hosts = extractHostnames(
    'https://example.com/a and https://example.com/b and https://example.com/c',
  );
  assert.deepEqual(hosts, ['example.com']);
});

test('extractHostnames returns up to 5 unique hostnames', () => {
  const content = [1, 2, 3, 4, 5, 6]
    .map((n) => `https://site${n}.example.org/page`)
    .join(' ');
  const hosts = extractHostnames(content);
  assert.equal(hosts.length, 5);
});

test('extractHostnames is case-insensitive on hostname', () => {
  const hosts = extractHostnames('https://Example.COM/path');
  assert.deepEqual(hosts, ['example.com']);
});

// ---------------------------------------------------------------------------
// parseFactCheckConfig
// ---------------------------------------------------------------------------

test('parseFactCheckConfig returns null when disabled', () => {
  assert.equal(parseFactCheckConfig({}), null);
  assert.equal(
    parseFactCheckConfig({ RELAY_FACT_CHECK_ENABLED: 'false', RELAY_FACT_CHECK_API_KEY: 'k' }),
    null,
  );
});

test('parseFactCheckConfig returns null when enabled but no API key', () => {
  assert.equal(
    parseFactCheckConfig({ RELAY_FACT_CHECK_ENABLED: 'true' }),
    null,
  );
  assert.equal(
    parseFactCheckConfig({ RELAY_FACT_CHECK_ENABLED: 'true', RELAY_FACT_CHECK_API_KEY: '   ' }),
    null,
  );
});

test('parseFactCheckConfig returns config with defaults when enabled', () => {
  const cfg = parseFactCheckConfig({
    RELAY_FACT_CHECK_ENABLED: 'true',
    RELAY_FACT_CHECK_API_KEY: 'test-key',
  });
  assert.ok(cfg !== null);
  assert.equal(cfg.apiKey, 'test-key');
  assert.equal(cfg.flagCostMultiplier, 3);
  assert.equal(cfg.cacheTtlMs, 60 * 60 * 1000);
});

test('parseFactCheckConfig respects custom multiplier', () => {
  const cfg = parseFactCheckConfig({
    RELAY_FACT_CHECK_ENABLED: 'true',
    RELAY_FACT_CHECK_API_KEY: 'key',
    RELAY_FACT_CHECK_FLAG_COST_MULTIPLIER: '5',
  });
  assert.equal(cfg.flagCostMultiplier, 5);
});

// ---------------------------------------------------------------------------
// createFactCheckFilter (no-op)
// ---------------------------------------------------------------------------

test('createFactCheckFilter is a no-op when config is null', () => {
  const filter = createFactCheckFilter(null);
  assert.equal(filter.isHostnameFlagged('misinformation.example.com'), false);
  assert.equal(filter.flagCostMultiplier, 1);
  // queueForCheck must not throw
  filter.queueForCheck('example.com');
  filter.shutdown();
});

// ---------------------------------------------------------------------------
// createFactCheckFilter (pre-seeded flagged hostnames)
// ---------------------------------------------------------------------------

test('isHostnameFlagged returns true for pre-seeded hostname', () => {
  const cfg = {
    apiKey: 'test-key',
    flagCostMultiplier: 3,
    cacheTtlMs: 60 * 60 * 1000,
    refreshIntervalMs: 5 * 60 * 1000,
    maxQueue: 500,
  };
  const filter = createFactCheckFilter(cfg, {
    flaggedHostnames: new Set(['disinfo.example.org']),
  });
  assert.equal(filter.isHostnameFlagged('disinfo.example.org'), true);
  assert.equal(filter.isHostnameFlagged('clean.example.org'), false);
  filter.shutdown();
});

test('flagCostMultiplier is reflected from config', () => {
  const cfg = {
    apiKey: 'key',
    flagCostMultiplier: 4,
    cacheTtlMs: 60 * 60 * 1000,
    refreshIntervalMs: 5 * 60 * 1000,
    maxQueue: 500,
  };
  const filter = createFactCheckFilter(cfg, {});
  assert.equal(filter.flagCostMultiplier, 4);
  filter.shutdown();
});

test('queueForCheck does not re-queue already-flagged hostname', () => {
  const cfg = {
    apiKey: 'key',
    flagCostMultiplier: 3,
    cacheTtlMs: 60 * 60 * 1000,
    refreshIntervalMs: 5 * 60 * 1000,
    maxQueue: 500,
  };
  const filter = createFactCheckFilter(cfg, {
    flaggedHostnames: new Set(['disinfo.example.org']),
  });
  // Should not throw even when called repeatedly for a flagged hostname.
  filter.queueForCheck('disinfo.example.org');
  filter.queueForCheck('disinfo.example.org');
  assert.equal(filter.isHostnameFlagged('disinfo.example.org'), true);
  filter.shutdown();
});

// ---------------------------------------------------------------------------
// Integration: rateLimiter + fact-check filter cost multiplier
// ---------------------------------------------------------------------------

import { createRelayRateLimiter, parsePolicyConfig } from './rateLimiter.mjs';

test('fact-check flagged hostname inflates event cost and causes bucket exhaustion', () => {
  const factCheckCfg = {
    apiKey: 'key',
    flagCostMultiplier: 10,
    cacheTtlMs: 60 * 60 * 1000,
    refreshIntervalMs: 5 * 60 * 1000,
    maxQueue: 500,
  };
  const factCheckFilter = createFactCheckFilter(factCheckCfg, {
    flaggedHostnames: new Set(['disinfo.example.org']),
  });

  const cfg = parsePolicyConfig({
    RELAY_POLICY_MODE: 'enforce',
    RELAY_POLICY_PUBKEY_POINTS_PER_MINUTE: '2',
    RELAY_POLICY_BURST_MULTIPLIER: '1',
    RELAY_POLICY_GLOBAL_POINTS_PER_SECOND: '1000',
    RELAY_POLICY_SOURCE_POINTS_PER_MINUTE: '1000',
  });
  const limiter = createRelayRateLimiter(cfg, { factCheckFilter });

  const now = 1700001000 * 1000;
  const baseEvent = {
    id: '0000000000000000000000000000000000000000000000000000000000000f01',
    pubkey: 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0',
    kind: 1,
    created_at: 1700001000,
    content: 'did you see this claim? https://disinfo.example.org/fake-story',
    tags: [],
  };

  const decision = limiter.evaluate({ event: { ...baseEvent, sig: 'f'.repeat(128) }, sourceInfo: { ip: '1.2.3.4' } }, now);
  // With 10x multiplier on a pubkey bucket of 2 points, the inflated cost
  // should exhaust the bucket immediately.
  assert.equal(decision.action, 'reject', 'flagged hostname should exhaust pubkey bucket');

  factCheckFilter.shutdown();
});
