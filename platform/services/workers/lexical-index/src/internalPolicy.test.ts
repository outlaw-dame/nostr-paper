import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesInternalSystemKeywordPolicy } from '@nostr-paper/content-policy';

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
