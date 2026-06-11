#!/usr/bin/env node

/**
 * Repository security drift audit.
 *
 * This intentionally checks for patterns that have caused security/privacy drift
 * in this repo before: committed local agent state, absolute developer paths,
 * helper scripts that read .env.local directly, and browser-delivered AI API-key
 * names. Keep this lightweight and dependency-free so it can run in CI before
 * build artifacts are produced.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-ssr',
  'build',
  'out',
  'coverage',
  'test-results',
  'playwright-report',
  '.vite',
  '.cache',
  '.turbo',
])

const SKIP_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])

const TEXT_EXTENSIONS = new Set([
  '.cjs', '.css', '.env', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.sh',
  '.ts', '.tsx', '.txt', '.webmanifest', '.yaml', '.yml', '.code-workspace',
])

const FILE_RULES = [
  {
    id: 'local-agent-settings',
    test: (path) => /(^|\/)\.claude\/settings\.local\.json$/.test(path),
    message: 'local Claude/agent settings must not be committed',
  },
]

const CONTENT_RULES = [
  {
    id: 'absolute-user-path',
    pattern: /(?:\/Users\/[^\s'"`]+|C:\\Users\\[^\s'"`]+)/,
    message: 'absolute developer home paths must not be committed',
  },
  {
    id: 'env-local-reader',
    pattern: /readFileSync\([^\n]{0,200}\.env\.local/,
    message: 'scripts must not read .env.local directly',
  },
  {
    id: 'browser-ai-api-key-env',
    pattern: /VITE_(?:GEMINI|GOOGLE|OPENAI|DEEPL|ANTHROPIC|CLOUDFLARE)[A-Z0-9_]*(?:API_)?KEY/,
    message: 'AI/provider API keys must not be exposed through VITE_* browser env names',
  },
  {
    id: 'local-auto-approve',
    pattern: /chat\.tools\.terminal\.autoApprove/,
    message: 'local tool auto-approval settings must not be committed',
  },
  {
    id: 'github-token-literal',
    pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/,
    message: 'GitHub token-like literals must not be committed',
  },
]

function extensionOf(path) {
  const index = path.lastIndexOf('.')
  return index >= 0 ? path.slice(index) : ''
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relPath = relative(ROOT, fullPath).split(sep).join('/')
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) files.push(...await walk(fullPath))
      continue
    }
    if (!entry.isFile()) continue
    if (SKIP_FILES.has(entry.name)) continue
    if (TEXT_EXTENSIONS.has(extensionOf(entry.name)) || entry.name.startsWith('.env')) {
      files.push({ fullPath, relPath })
    }
  }
  return files
}

const findings = []
const files = await walk(ROOT)
for (const file of files) {
  for (const rule of FILE_RULES) {
    if (rule.test(file.relPath)) {
      findings.push(`${file.relPath}: ${rule.id}: ${rule.message}`)
    }
  }

  let content = ''
  try {
    content = await readFile(file.fullPath, 'utf8')
  } catch {
    continue
  }

  for (const rule of CONTENT_RULES) {
    if (rule.pattern.test(content)) {
      findings.push(`${file.relPath}: ${rule.id}: ${rule.message}`)
    }
  }
}

if (findings.length > 0) {
  console.error('Repository security drift audit failed:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log(`Repository security drift audit passed for ${files.length} text files.`)
