import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelayRateLimiter, parsePolicyConfig } from './rateLimiter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corpusPath = resolve(__dirname, 'abuseReplay.corpus.json');

/** @typedef {{
 *  id: string,
 *  pubkey: string,
 *  kind: number,
 *  created_at: number,
 *  content: string,
 *  tags: string[][],
 *  expectedAction: 'accept' | 'reject',
 *  expectedMessageIncludes?: string
 * }} ReplayEvent
 */

/** @typedef {{
 *  name: string,
 *  config?: Record<string, string>,
 *  events: ReplayEvent[]
 * }} ReplayScenario
 */

function loadCorpus() {
  const raw = readFileSync(corpusPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.scenarios)) {
    throw new Error('abuse replay corpus is invalid');
  }
  return parsed;
}

function toMessage(event) {
  return {
    event: {
      ...event,
      sig: 'f'.repeat(128),
    },
    sourceInfo: {
      ip: '203.0.113.44',
    },
  };
}

test('abuse replay corpus is structurally valid', () => {
  const corpus = loadCorpus();
  assert.equal(corpus.schemaVersion, 1);
  assert.ok(corpus.scenarios.length > 0);

  for (const scenario of corpus.scenarios) {
    assert.equal(typeof scenario.name, 'string');
    assert.ok(Array.isArray(scenario.events));
    assert.ok(scenario.events.length > 0);
  }
});

test('relay policy decisions match replay corpus expectations', () => {
  const corpus = loadCorpus();
  /** @type {ReplayScenario[]} */
  const scenarios = corpus.scenarios;

  for (const scenario of scenarios) {
    const cfg = parsePolicyConfig({ ...(scenario.config || {}) });
    const limiter = createRelayRateLimiter(cfg);

    for (const replayEvent of scenario.events) {
      const now = replayEvent.created_at * 1000;
      const decision = limiter.evaluate(toMessage(replayEvent), now);

      assert.equal(
        decision.action,
        replayEvent.expectedAction,
        `[${scenario.name}] ${replayEvent.id} action mismatch`,
      );

      if (replayEvent.expectedMessageIncludes) {
        assert.match(
          decision.msg,
          new RegExp(replayEvent.expectedMessageIncludes, 'i'),
          `[${scenario.name}] ${replayEvent.id} message mismatch`,
        );
      }
    }
  }
});
