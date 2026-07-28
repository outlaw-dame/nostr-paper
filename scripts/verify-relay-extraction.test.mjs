import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import {
  APPROVED_EXCLUDED_PATHS,
  APPROVED_INCLUDED_PATHS,
  REQUIRED_PATHS,
  verifyManifest,
  verifyTree,
} from './verify-relay-extraction.mjs'

const execFileAsync = promisify(execFile)

async function git(root, ...args) {
  await execFileAsync('git', ['-C', root, ...args], { encoding: 'utf8' })
}

async function commitTree(root) {
  await git(root, 'add', '.')
  await git(root, '-c', 'user.name=Verifier Test', '-c', 'user.email=verifier@example.invalid', 'commit', '-m', 'fixture')
}

async function makeTree() {
  const root = await mkdtemp(join(tmpdir(), 'relay-extraction-'))
  await git(root, 'init', '-q')
  for (const path of REQUIRED_PATHS) {
    const file = join(root, path, '.keep')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'tracked\n')
  }
  await commitTree(root)
  return root
}

function manifest(sourceSha = 'a'.repeat(40)) {
  return {
    schemaVersion: 1,
    sourceRepository: 'outlaw-dame/nostr-paper',
    sourceSha,
    includedPaths: [...APPROVED_INCLUDED_PATHS],
    excludedPaths: [...APPROVED_EXCLUDED_PATHS],
  }
}

async function writeManifest(root, value) {
  const path = join(root, 'extraction-manifest.json')
  await writeFile(path, JSON.stringify(value))
  return path
}

test('accepts an extracted committed relay tree without platform or Blossom', async () => {
  const root = await makeTree()
  assert.deepEqual(await verifyTree(root), { required: REQUIRED_PATHS.length, forbidden: 0 })
})

test('fails closed when a required service is absent from the committed tree', async () => {
  const root = await makeTree()
  await rm(join(root, 'services/search-api'), { recursive: true })
  await commitTree(root)
  await assert.rejects(() => verifyTree(root), /missing required paths: services\/search-api/)
})

test('ignores untracked placeholders for missing required paths', async () => {
  const root = await makeTree()
  await rm(join(root, 'services/search-api'), { recursive: true })
  await commitTree(root)
  await mkdir(join(root, 'services/search-api'), { recursive: true })
  await writeFile(join(root, 'services/search-api', 'untracked.txt'), 'not committed\n')
  await assert.rejects(() => verifyTree(root), /missing required paths: services\/search-api/)
})

test('rejects committed Blossom or an unstripped platform prefix', async () => {
  const root = await makeTree()
  for (const path of ['services/blossom-edge', 'platform']) {
    await mkdir(join(root, path), { recursive: true })
    await writeFile(join(root, path, '.keep'), 'tracked\n')
  }
  await commitTree(root)
  await assert.rejects(() => verifyTree(root), /forbidden paths present: platform, services\/blossom-edge/)
})

test('validates the extraction source commit and exact boundary manifest', async () => {
  const root = await makeTree()
  const sourceSha = 'b'.repeat(40)
  const path = await writeManifest(root, manifest(sourceSha))
  const result = await verifyManifest(path, sourceSha)
  assert.equal(result.sourceSha, sourceSha)
})

test('requires an independently supplied full source SHA', async () => {
  const root = await makeTree()
  const path = await writeManifest(root, manifest())
  await assert.rejects(() => verifyManifest(path), /Expected source SHA argument must be a full Git SHA/)
  await assert.rejects(() => verifyManifest(path, ''), /Expected source SHA argument must be a full Git SHA/)
})

test('rejects unexpected included paths even when all required entries are present', async () => {
  const root = await makeTree()
  const value = manifest()
  value.includedPaths.push('platform/secrets')
  const path = await writeManifest(root, value)
  await assert.rejects(() => verifyManifest(path, value.sourceSha), /includedPaths does not match the approved set.*unexpected: platform\/secrets/)
})

test('rejects missing or unexpected excluded paths', async () => {
  const root = await makeTree()
  const missing = manifest()
  missing.excludedPaths = []
  const missingPath = await writeManifest(root, missing)
  await assert.rejects(() => verifyManifest(missingPath, missing.sourceSha), /excludedPaths does not match the approved set.*missing: platform\/services\/blossom-edge/)

  const unexpected = manifest()
  unexpected.excludedPaths.push('platform/secrets')
  const unexpectedPath = await writeManifest(root, unexpected)
  await assert.rejects(() => verifyManifest(unexpectedPath, unexpected.sourceSha), /excludedPaths does not match the approved set.*unexpected: platform\/secrets/)
})
