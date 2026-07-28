import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { REQUIRED_PATHS, verifyManifest, verifyTree } from './verify-relay-extraction.mjs'

async function makeTree() {
  const root = await mkdtemp(join(tmpdir(), 'relay-extraction-'))
  for (const path of REQUIRED_PATHS) await mkdir(join(root, path), { recursive: true })
  return root
}

function manifest(sourceSha = 'a'.repeat(40)) {
  return {
    schemaVersion: 1,
    sourceRepository: 'outlaw-dame/nostr-paper',
    sourceSha,
    includedPaths: REQUIRED_PATHS.map((path) => `platform/${path}`),
    excludedPaths: ['platform/services/blossom-edge'],
  }
}

test('accepts an extracted relay tree without platform or Blossom', async () => {
  const root = await makeTree()
  assert.deepEqual(await verifyTree(root), { required: REQUIRED_PATHS.length, forbidden: 0 })
})

test('fails closed when a required service is missing', async () => {
  const root = await makeTree()
  await import('node:fs/promises').then(({ rm }) => rm(join(root, 'services/search-api'), { recursive: true }))
  await assert.rejects(() => verifyTree(root), /missing required paths: services\/search-api/)
})

test('rejects Blossom or an unstripped platform prefix', async () => {
  const root = await makeTree()
  await mkdir(join(root, 'services/blossom-edge'), { recursive: true })
  await mkdir(join(root, 'platform'), { recursive: true })
  await assert.rejects(() => verifyTree(root), /forbidden paths present: platform, services\/blossom-edge/)
})

test('validates the extraction source commit and boundary manifest', async () => {
  const root = await makeTree()
  const path = join(root, 'extraction-manifest.json')
  const sourceSha = 'b'.repeat(40)
  await writeFile(path, JSON.stringify(manifest(sourceSha)))
  const result = await verifyManifest(path, sourceSha)
  assert.equal(result.sourceSha, sourceSha)
})

test('rejects a manifest that omits the Blossom exclusion', async () => {
  const root = await makeTree()
  const path = join(root, 'extraction-manifest.json')
  const value = manifest()
  value.excludedPaths = []
  await writeFile(path, JSON.stringify(value))
  await assert.rejects(() => verifyManifest(path), /explicitly exclude Blossom/)
})
