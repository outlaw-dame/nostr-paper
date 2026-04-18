import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')
const sourceDir = join(repoRoot, 'node_modules', '@mediapipe', 'tasks-genai', 'wasm')
const targetDir = join(repoRoot, 'public', 'vendor', 'mediapipe', 'tasks-genai', 'wasm')

async function main() {
  await mkdir(targetDir, { recursive: true })
  const entries = await readdir(sourceDir, { withFileTypes: true })

  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => copyFile(join(sourceDir, entry.name), join(targetDir, entry.name))),
  )
}

main().catch((error) => {
  console.error('Failed to sync Gemma WASM assets:', error)
  process.exitCode = 1
})
