import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertSafeDestination,
  normalizeDestination,
  parseArguments,
} from './relay-extraction-preflight.mjs'

test('normalizes supported GitHub destination formats', () => {
  assert.equal(
    normalizeDestination('git@github.com:outlaw-dame/nostr-paper-relay.git'),
    'outlaw-dame/nostr-paper-relay',
  )
  assert.equal(
    normalizeDestination('https://github.com/outlaw-dame/nostr-paper-relay/'),
    'outlaw-dame/nostr-paper-relay',
  )
})

test('rejects the unrelated platform repository', () => {
  assert.throws(
    () => assertSafeDestination('https://github.com/outlaw-dame/nostr-paper-platform.git'),
    /must not be used/,
  )
})

test('rejects the source repository as a destination', () => {
  assert.throws(
    () => assertSafeDestination('outlaw-dame/nostr-paper'),
    /source repository/,
  )
})

test('accepts a distinct GitHub repository', () => {
  assert.equal(
    assertSafeDestination('outlaw-dame/nostr-paper-relay'),
    'outlaw-dame/nostr-paper-relay',
  )
})

test('requires a destination for full preflight', () => {
  assert.throws(() => parseArguments([]), /requires --destination/)
  assert.deepEqual(parseArguments(['--tree-only']), {
    treeOnly: true,
    destination: null,
  })
})

test('rejects unknown and incomplete arguments', () => {
  assert.throws(() => parseArguments(['--destination']), /requires a repository/)
  assert.throws(() => parseArguments(['--unknown']), /Unknown argument/)
})
