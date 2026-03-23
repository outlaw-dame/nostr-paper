import { readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import * as zlib from 'node:zlib'

const DIST_DIR = new URL('../dist/', import.meta.url)
const MIN_BYTES = 1024
const COMPRESSIBLE_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.svg',
  '.txt',
  '.wasm',
  '.webmanifest',
  '.xml',
])

const enableZstd = process.argv.includes('--zstd')
const hasZstdSupport = typeof zlib.zstdCompressSync === 'function'

async function collectFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryUrl))
      continue
    }

    if (entry.isFile()) {
      files.push(entryUrl)
    }
  }

  return files
}

function shouldCompress(filePath) {
  return COMPRESSIBLE_EXTENSIONS.has(extname(filePath))
}

async function writeCompressedVariant(fileUrl, suffix, compressedBuffer, originalStats) {
  const outputUrl = new URL(`${fileUrl.pathname.split('/').pop() ?? ''}${suffix}`, fileUrl)

  if (compressedBuffer.byteLength >= originalStats.size) {
    await rm(outputUrl, { force: true })
    return false
  }

  await writeFile(outputUrl, compressedBuffer)
  await utimes(outputUrl, originalStats.atime, originalStats.mtime)
  return true
}

async function compressFile(fileUrl) {
  const filePath = fileUrl.pathname
  if (!shouldCompress(filePath)) return { gzip: false, zstd: false }

  const originalStats = await stat(fileUrl)
  if (originalStats.size < MIN_BYTES) return { gzip: false, zstd: false }

  const source = await readFile(fileUrl)
  const gzipBuffer = zlib.gzipSync(source, {
    level: zlib.constants.Z_BEST_COMPRESSION,
  })

  const wroteGzip = await writeCompressedVariant(
    fileUrl,
    '.gz',
    gzipBuffer,
    originalStats,
  )

  let wroteZstd = false
  if (enableZstd && hasZstdSupport) {
    const zstdBuffer = zlib.zstdCompressSync(source, {
      params: {
        [zlib.constants.ZSTD_c_compressionLevel]: 10,
        [zlib.constants.ZSTD_c_checksumFlag]: 1,
      },
    })

    wroteZstd = await writeCompressedVariant(
      fileUrl,
      '.zst',
      zstdBuffer,
      originalStats,
    )
  }

  return { gzip: wroteGzip, zstd: wroteZstd }
}

async function main() {
  const files = await collectFiles(DIST_DIR)
  let gzipCount = 0
  let zstdCount = 0

  for (const fileUrl of files) {
    const result = await compressFile(fileUrl)
    if (result.gzip) gzipCount += 1
    if (result.zstd) zstdCount += 1
  }

  console.log(
    `[precompress] wrote ${gzipCount} gzip asset${gzipCount === 1 ? '' : 's'}` +
    (
      enableZstd
        ? hasZstdSupport
          ? ` and ${zstdCount} zstd asset${zstdCount === 1 ? '' : 's'}`
          : ' and skipped zstd (Node runtime lacks zstd support)'
        : ''
    ),
  )
}

main().catch((error) => {
  console.error('[precompress] failed', error)
  process.exitCode = 1
})
