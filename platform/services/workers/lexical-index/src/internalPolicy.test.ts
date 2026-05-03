import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INTERNAL_SYSTEM_KEYWORD_REASON,
  matchesInternalSystemKeywordPolicy,
  normalizeModerationReason,
  scoreInternalModerationRisk,
} from '@nostr-paper/content-policy';

test('internal keyword policy matches plain text terms', () => {
  const blocked = matchesInternalSystemKeywordPolicy({
    content: 'this post says kys and should be blocked',
    hashtags: [],
  });

  assert.equal(blocked, true);
});

test('internal keyword policy matches hashtag terms', () => {
  const blocked = matchesInternalSystemKeywordPolicy({
    content: 'clean text',
    hashtags: ['kys'],
  });

  assert.equal(blocked, true);
});

test('internal keyword policy does not block clean content', () => {
  const blocked = matchesInternalSystemKeywordPolicy({
    content: 'hello world from nostr paper',
    hashtags: ['nostr'],
  });

  assert.equal(blocked, false);
});

test('normalizes keyword and Tagr reasons into one taxonomy', () => {
  assert.equal(normalizeModerationReason(INTERNAL_SYSTEM_KEYWORD_REASON, 'keyword'), 'keyword_extreme_harm');
  assert.equal(normalizeModerationReason('MOD>SP-sam', 'tagr'), 'spam');
  assert.equal(normalizeModerationReason('report', 'tagr'), 'community_report');
});

test('catches leetspeak and homoglyph evasion attempts', () => {
  const blocked = matchesInternalSystemKeywordPolicy({
    content: 'k1ll y0urs3lf right now',
    hashtags: [],
  });

  assert.equal(blocked, true);
});

test('flags risky domains in moderation scoring', () => {
  const score = scoreInternalModerationRisk({
    content: 'check this out https://grabify.link/track-me',
    hashtags: [],
  });

  assert.equal(score.flags.includes('domain_reputation_match'), true);
  assert.equal(score.score > 0, true);
});

test('fuzzy matching catches near-miss abusive terms', () => {
  const score = scoreInternalModerationRisk({
    content: 'that account is a pedophle ring operator',
    hashtags: [],
  });

  assert.equal(score.flags.includes('fuzzy_term_match') || score.flags.includes('exact_term_match'), true);
});
