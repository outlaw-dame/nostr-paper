import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEventSearchText,
  extractMediaText,
  extractTaggedUrls,
  MEDIA_KINDS,
  mergeEventUrls,
  normalizeIndexText,
} from './mediaIndex.js';

test('MEDIA_KINDS includes expected event kinds', () => {
  const expected = [21, 22, 1063, 34235, 34236];
  for (const kind of expected) {
    assert.equal(MEDIA_KINDS.has(kind), true);
  }
});

test('normalizeIndexText removes control chars and collapses whitespace', () => {
  const input = '  hello\u0000\n   world\t\u007f  ';
  assert.equal(normalizeIndexText(input), 'hello world');
});

test('extractTaggedUrls reads url/r tags and imeta urls and deduplicates', () => {
  const tags = [
    ['url', 'https://cdn.example.com/video.mp4'],
    ['r', 'https://relay.example.com/ref'],
    ['imeta', 'url https://cdn.example.com/video.mp4', 'thumb https://cdn.example.com/thumb.jpg', 'image https://cdn.example.com/poster.jpg'],
    ['imeta', 'url ftp://invalid.example.com/file'],
  ];

  const urls = extractTaggedUrls(tags);

  assert.deepEqual(urls.sort(), [
    'https://cdn.example.com/poster.jpg',
    'https://cdn.example.com/thumb.jpg',
    'https://cdn.example.com/video.mp4',
    'https://relay.example.com/ref',
  ]);
});

test('extractMediaText pulls title/alt/summary and imeta values', () => {
  const tags = [
    ['title', '  Main   clip  '],
    ['alt', 'A short description'],
    ['summary', '  summary with\nspaces '],
    ['imeta', 'alt camera pan', 'summary quick overview', 'm video/mp4'],
  ];

  const text = extractMediaText(tags);

  assert.deepEqual(text.sort(), [
    'A short description',
    'Main clip',
    'camera pan',
    'quick overview',
    'summary with spaces',
    'video/mp4',
  ]);
});

test('mergeEventUrls merges content URLs with tagged URLs and deduplicates', () => {
  const content = 'watch https://cdn.example.com/video.mp4 and https://example.com/page';
  const tags = [
    ['url', 'https://cdn.example.com/video.mp4'],
    ['imeta', 'thumb https://cdn.example.com/thumb.jpg'],
  ];

  const urls = mergeEventUrls(content, tags);

  assert.deepEqual(urls.sort(), [
    'https://cdn.example.com/thumb.jpg',
    'https://cdn.example.com/video.mp4',
    'https://example.com/page',
  ]);
});

test('buildEventSearchText includes media metadata only for media kinds', () => {
  const tags = [
    ['title', 'Clip Title'],
    ['imeta', 'alt vivid scene', 'summary high energy edit'],
  ];

  const mediaText = buildEventSearchText({
    title: 'Clip Title',
    content: 'watch now',
    hashtags: ['nostr'],
    tags,
    kind: 21,
  });

  const nonMediaText = buildEventSearchText({
    title: 'Clip Title',
    content: 'watch now',
    hashtags: ['nostr'],
    tags,
    kind: 1,
  });

  assert.equal(mediaText.includes('vivid scene'), true);
  assert.equal(mediaText.includes('high energy edit'), true);
  assert.equal(nonMediaText.includes('vivid scene'), false);
  assert.equal(nonMediaText.includes('high energy edit'), false);
});