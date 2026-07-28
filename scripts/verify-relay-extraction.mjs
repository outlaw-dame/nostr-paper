#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const REQUIRED_PATHS = Object.freeze([
  'infra',
  'packages',
  'services/ingestion-bridge',
  'services/relay-policy',
  'services/search-api',
  'services/workers',
  'docs',
])

export const FORBIDDEN_PATHS = Object.freeze([
  'platform',
  'services/blossom-edge',
])

export const APPROVED_INCLUDED_PATHS = Object.freeze(
  REQUIRED_PATHS.map((path) => `platform/${path}`),
)

export const APPROVED_EXCLUDED_PATHS = Object.freeze([
  'platform/services/blossom-edge',
])

function containsPath(paths, expected) {
  return paths.some((path) => path === expected || path.startsWith(`${expected}/`))
}

function assertExactPathSet(actual, expected, label) {
  if (!Array.isArray(actual)) throw new Error(`Manifest ${label} must be an array`)
  if (actual.some((path) => typeof path !== 'string')) {
    throw new Error(`Manifest ${label} must contain only strings`)
  }

  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  if (actualSet.size !== actual.length) throw new Error(`Manifest ${label} contains duplicate paths`)

  const missing = expected.filter((path) => !actualSet.has(path))
  const unexpected = actual.filter((path) => !expectedSet.has(path))
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `missing: ${missing.join(', ')}` : null,
      unexpected.length ? `unexpected: ${unexpected.join(', ')}` : null,
    ].filter(Boolean)
    throw new Error(`Manifest ${label} does not match the approved set (${details.join('; ')})`)
  }
}

async function trackedPaths(root, treeish = 'HEAD') {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', root, 'ls-tree', '-r', '--name-only', treeish],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
    return stdout.split('\n').map((path) => path.trim()).filter(Boolean)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to inspect committed Git tree: ${detail}`)
  }
}

export async function verifyTree(root = '.', treeish = 'HEAD') {
  const paths = await trackedPaths(root, treeish)
  const missing = REQUIRED_PATHS.filter((path) => !containsPath(paths, path))
  const forbidden = FORBIDDEN_PATHS.filter((path) => containsPath(paths, path))

  if (missing.length || forbidden.length) {
    const details = [
      missing.length ? `missing required paths: ${missing.join(', ')}` : null,
      forbidden.length ? `forbidden paths present: ${forbidden.join(', ')}` : null,
    ].filter(Boolean)
    throw new Error(details.join('; '))
  }

  return { required: REQUIRED_PATHS.length, forbidden: 0 }
}

export async function verifyManifest(path, expectedSourceSha) {
  if (!/^[0-9a-f]{40}$/i.test(expectedSourceSha ?? '')) {
    throw new Error('Expected source SHA argument must be a full Git SHA')
  }

  const raw = await readFile(path, 'utf8')
  const manifest = JSON.parse(raw)
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported extraction manifest schemaVersion')
  if (!/^[0-9a-f]{40}$/i.test(manifest.sourceSha ?? '')) throw new Error('Manifest sourceSha must be a full Git SHA')
  if (manifest.sourceSha.toLowerCase() !== expectedSourceSha.toLowerCase()) {
    throw new Error('Manifest sourceSha does not match the expected source commit')
  }
  if (manifest.sourceRepository !== 'outlaw-dame/nostr-paper') throw new Error('Manifest sourceRepository is invalid')

  assertExactPathSet(manifest.includedPaths, APPROVED_INCLUDED_PATHS, 'includedPaths')
  assertExactPathSet(manifest.excludedPaths, APPROVED_EXCLUDED_PATHS, 'excludedPaths')

  return manifest
}

async function main() {
  try {
    const root = process.argv[2] ?? '.'
    const manifestPath = process.argv[3] ?? `${root}/extraction-manifest.json`
    const expectedSourceSha = process.argv[4]
    await verifyTree(root)
    const manifest = await verifyManifest(manifestPath, expectedSourceSha)
    console.log(`Relay extraction verified from ${manifest.sourceSha}.`)
  } catch (error) {
    console.error(`Relay extraction verification failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
