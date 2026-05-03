import assert from 'node:assert/strict';
import test from 'node:test';
import { createRelayRateLimiter, parsePolicyConfig, strfryOutputForDecision } from './rateLimiter.mjs';

const pubkey = 'a'.repeat(64);
const eventId = 'b'.repeat(64);

function event(overrides = {}) {
  return {
    id: overrides.id ?? eventId,
    pubkey: overrides.pubkey ?? pubkey,
    kind: overrides.kind ?? 1,
    created_at: 1_700_000_000,
    content: overrides.content ?? `hello ${overrides.id ?? eventId}`,
    tags: overrides.tags ?? [],
    sig: 'c'.repeat(128),
  };
}

function config(overrides = {}) {
  return {
    ...parsePolicyConfig({}),
    ...overrides,
  };
}

test('accepts normal writes and returns strfry-compatible output', () => {
  const limiter = createRelayRateLimiter(config());
  const decision = limiter.evaluate({ event: event(), sourceInfo: { ip: '203.0.113.10' } }, 1_000);

  assert.equal(decision.action, 'accept');
  assert.equal(strfryOutputForDecision(decision).id, eventId);
});

test('parses policy version from environment for rollout tracking', () => {
  const parsed = parsePolicyConfig({ RELAY_POLICY_VERSION: 'relay-policy-v2' });
  assert.equal(parsed.policyVersion, 'relay-policy-v2');
});

test('rejects pubkeys that exhaust their weighted token bucket', () => {
  const limiter = createRelayRateLimiter(config({
    pubkeyPointsPerMinute: 2,
    sourcePointsPerMinute: 100,
    globalPointsPerSecond: 100,
    burstMultiplier: 1,
  }));

  const first = limiter.evaluate({ event: event({ id: '1'.repeat(64), content: 'first' }) }, 1_000);
  const second = limiter.evaluate({ event: event({ id: '2'.repeat(64), content: 'second' }) }, 1_001);

  assert.equal(first.action, 'accept');
  assert.equal(second.action, 'reject');
  assert.match(second.msg, /relay-policy-v1/);
  assert.match(second.msg, /pubkey bucket exhausted/);
});

test('rejects excessive p-tag fanout before storing the event', () => {
  const limiter = createRelayRateLimiter(config({ hellthreadTagLimit: 3 }));
  const decision = limiter.evaluate({
    event: event({
      tags: [
        ['p', '1'.repeat(64)],
        ['p', '2'.repeat(64)],
        ['p', '3'.repeat(64)],
        ['p', '4'.repeat(64)],
      ],
    }),
  }, 1_000);

  assert.equal(decision.action, 'reject');
  assert.match(decision.msg, /excessive p-tag fanout/);
});

test('rejects duplicate event bodies inside the duplicate window', () => {
  const limiter = createRelayRateLimiter(config());
  const first = limiter.evaluate({ event: event({ id: '3'.repeat(64), content: 'same body' }) }, 1_000);
  const second = limiter.evaluate({ event: event({ id: '4'.repeat(64), content: 'same body' }) }, 2_000);

  assert.equal(first.action, 'accept');
  assert.equal(second.action, 'reject');
  assert.match(second.msg, /duplicate event body/);
});

test('allowlisted pubkeys bypass rate limits', () => {
  const limiter = createRelayRateLimiter(config({
    pubkeyPointsPerMinute: 1,
    burstMultiplier: 1,
    allowlistPubkeys: new Set([pubkey]),
  }));

  for (let i = 0; i < 5; i += 1) {
    const decision = limiter.evaluate({ event: event({ id: String(i).repeat(64), content: `msg ${i}` }) }, 1_000 + i);
    assert.equal(decision.action, 'accept');
  }
});
