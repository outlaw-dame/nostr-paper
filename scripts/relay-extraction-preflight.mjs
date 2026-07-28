#!/usr/bin/env node

import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const INCLUDED_PATHS = Object.freeze([
  'platform/infra',
  'platform/packages',
  'platform/services/ingestion-bridge',
  'platform/services/relay-policy',
  'platform/services/search-api',
  'platform/services/workers',
  'platform/docs',
])

export const EXCLUDED_PATHS = Object.freeze([
  'platform/services/blossom-edge',
])

const FORBIDDEN_DESTINATION = 'outlaw-dame/nostr-paper-platform'

export function parseArguments(argv) {
  const options = { treeOnly: false, destination: null }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--tree-only') {
      options.treeOnly = true
      continue
    }
    if (argument === '--destination') {
      const destination = argv[index + 1]
      if (!destination || destination.startsWith('--')) {
        throw new Error('--destination requires a repository URL or owner/name value')
      }
      options.destination = destination
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (!options.treeOnly && !options.destination) {
    throw new Error('Full preflight requires --destination <repository>')
  }

  return options
}

export function normalizeDestination(destination) {
  return destination
    .trim()
    .replace(/^git@github\.com:/i, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

export function assertSafeDestination(destination) {
  const normalized = normalizeDestination(destination)
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(normalized)) {
    throw new Error('Destination must identify one GitHub repository as owner/name or a GitHub URL')
  }
  if (normalized === FORBIDDEN_DESTINATION) {
    throw new Error('The unrelated outlaw-dame/nostr-paper-platform repository must not be used')
  }
  if (normalized === 'outlaw-dame/nostr-paper') {
    throw new Error('The source repository cannot be used as the extraction destination')
  }
  return normalized
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error) {
    throw new Error(`${command} could not be executed: ${result.error.message}`)
  }
  if (!allowFailure && result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`)
  }
  return result
}

async function assertPathExists(path) {
  try {
    await access(path, constants.F_OK)
  } catch {
    throw new Error(`Required extraction path is missing: ${path}`)
  }
}

export async function validateExtractionTree() {
  for (const path of [...INCLUDED_PATHS, ...EXCLUDED_PATHS]) {
    await assertPathExists(path)
  }

  const overlap = INCLUDED_PATHS.filter((included) =>
    EXCLUDED_PATHS.some(
      (excluded) => included === excluded || included.startsWith(`${excluded}/`),
    ),
  )
  if (overlap.length > 0) {
    throw new Error(`Extraction scope includes excluded paths: ${overlap.join(', ')}`)
  }
}

function assertCleanRepository() {
  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=all']).stdout.trim()
  if (status) {
    throw new Error('Working tree is not clean; commit, stash, or remove changes before extraction')
  }
}

function assertMainCheckedOut() {
  const branch = run('git', ['branch', '--show-current']).stdout.trim()
  if (branch !== 'main') {
    throw new Error(`Extraction must start from main; current branch is ${branch || '(detached)'}`)
  }
}

function assertFilterRepoAvailable() {
  const result = run('git', ['filter-repo', '--version'], { allowFailure: true })
  if (result.status !== 0) {
    throw new Error('git-filter-repo is required and was not found')
  }
}

function assertDestinationEmpty(destination) {
  const result = run('git', ['ls-remote', '--heads', '--tags', destination])
  if (result.stdout.trim()) {
    throw new Error('Destination repository is not empty; extraction requires a repository with no refs')
  }
}

export async function runPreflight(options) {
  await validateExtractionTree()
  const sourceSha = run('git', ['rev-parse', 'HEAD']).stdout.trim()

  if (options.treeOnly) {
    return { sourceSha, destination: null, mode: 'tree-only' }
  }

  const destination = assertSafeDestination(options.destination)
  assertCleanRepository()
  assertMainCheckedOut()
  assertFilterRepoAvailable()
  assertDestinationEmpty(options.destination)

  return { sourceSha, destination, mode: 'full' }
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2))
    const result = await runPreflight(options)
    console.log(`Relay extraction preflight passed (${result.mode}).`)
    console.log(`Source commit: ${result.sourceSha}`)
    if (result.destination) console.log(`Empty destination: ${result.destination}`)
  } catch (error) {
    console.error(`Relay extraction preflight failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
