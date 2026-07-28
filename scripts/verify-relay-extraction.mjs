#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import process from 'node:process'

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

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function verifyTree(root = '.') {
  const missing = []
  const forbidden = []

  for (const path of REQUIRED_PATHS) {
    if (!(await exists(`${root}/${path}`))) missing.push(path)
  }
  for (const path of FORBIDDEN_PATHS) {
    if (await exists(`${root}/${path}`)) forbidden.push(path)
  }

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
  const raw = await readFile(path, 'utf8')
  const manifest = JSON.parse(raw)
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported extraction manifest schemaVersion')
  if (!/^[0-9a-f]{40}$/i.test(manifest.sourceSha ?? '')) throw new Error('Manifest sourceSha must be a full Git SHA')
  if (expectedSourceSha && manifest.sourceSha.toLowerCase() !== expectedSourceSha.toLowerCase()) {
    throw new Error('Manifest sourceSha does not match the expected source commit')
  }
  if (manifest.sourceRepository !== 'outlaw-dame/nostr-paper') throw new Error('Manifest sourceRepository is invalid')
  if (!Array.isArray(manifest.includedPaths) || !Array.isArray(manifest.excludedPaths)) {
    throw new Error('Manifest path lists are required')
  }
  for (const path of REQUIRED_PATHS) {
    if (!manifest.includedPaths.includes(`platform/${path}`)) throw new Error(`Manifest omits included path: platform/${path}`)
  }
  if (!manifest.excludedPaths.includes('platform/services/blossom-edge')) {
    throw new Error('Manifest must explicitly exclude Blossom')
  }
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
