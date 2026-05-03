import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INTERNAL_SYSTEM_KEYWORD_REASON,
  matchesInternalSystemKeywordPolicy,
  normalizeModerationReason,
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
