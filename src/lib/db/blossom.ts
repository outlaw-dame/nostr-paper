/**
 * DB Layer — Blossom Servers & Blob Cache
 *
 * Persistent local storage for:
 * - User-configured Blossom media servers (BUD-03)
 * - Cached blob metadata (sha256, URL, MIME, size, upload servers)
 *
 * All priority re-ordering is done by deleting and re-inserting rows
 * so the DB always reflects the authoritative ordered list.
 */

import { dbQuery, dbRun, dbTransaction } from '@/lib/db/client'
import { normaliseBlossomUrl } from '@/lib/blossom/validate'
import { normalizeNip94FromObject } from '@/lib/nostr/fileMetadata'
import type { BlossomServer, BlossomBlob, DBBlossomServer, DBBlossomBlob, Nip94Tags } from '@/types'

// ── Servers ──────────────────────────────────────────────────

/** Fetch all configured servers ordered by priority (0 = highest). */
export async function getBlossomServers(): Promise<BlossomServer[]> {
  const rows = await dbQuery<DBBlossomServer>(
    'SELECT url, priority, added_at FROM blossom_servers ORDER BY priority ASC'
  )
  const stored = rows.map(r => ({
    url:      r.url,
    priority: r.priority,
    addedAt:  r.added_at,
  }))

  const defaults = getDefaultBlossomServersFromEnv()
  if (stored.length === 0) return defaults

  const seen = new Set(stored.map(server => server.url))
  const missingDefaults = defaults
    .filter(server => !seen.has(server.url))
    .map((server, index) => ({
      ...server,
      priority: stored.length + index,
    }))

  return [...stored, ...missingDefaults]
}

function getDefaultBlossomServersFromEnv(): BlossomServer[] {
  const raw = import.meta.env.VITE_DEFAULT_BLOSSOM_SERVERS
  if (!raw) return []

  const now = Math.floor(Date.now() / 1000)
  const seen = new Set<string>()
  const urls: string[] = []

  for (const candidate of raw.split(',')) {
    const normalized = normaliseBlossomUrl(candidate.trim())
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    urls.push(normalized)
  }

  return urls.map((url, index) => ({
    url,
    priority: index,
    addedAt: now,
  }))
}

/** Add a server at the lowest priority if not already present. */
export async function addBlossomServer(url: string): Promise<void> {
  const existing = await getBlossomServers()
  const priority = existing.length
  await dbRun(
    `INSERT OR IGNORE INTO blossom_servers (url, priority, added_at)
     VALUES (?, ?, unixepoch())`,
    [url, priority],
  )
}

/** Remove a server and compact the priority sequence. */
export async function removeBlossomServer(url: string): Promise<void> {
  await dbRun('DELETE FROM blossom_servers WHERE url = ?', [url])
  // Re-compact priorities
  const remaining = await getBlossomServers()
  await _writeServerList(remaining)
}

/**
 * Atomically replace the full server list with a new ordered list.
 * Index 0 gets priority 0 (highest).
 */
export async function setBlossomServers(servers: BlossomServer[]): Promise<void> {
  await _writeServerList(servers)
}

/** Reorder servers by providing the desired URL ordering. */
export async function reorderBlossomServers(orderedUrls: string[]): Promise<void> {
  const existing = await getBlossomServers()
  const map      = new Map(existing.map(s => [s.url, s]))
  const reordered = orderedUrls
    .map(url => map.get(url))
    .filter((s): s is BlossomServer => s !== undefined)
  await _writeServerList(reordered)
}

/** Internal: atomically replace server table rows. */
async function _writeServerList(servers: BlossomServer[]): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await dbTransaction([
    { sql: 'DELETE FROM blossom_servers' },
    ...servers.map((s, i) => ({
      sql:  'INSERT INTO blossom_servers (url, priority, added_at) VALUES (?, ?, ?)',
      bind: [s.url, i, s.addedAt ?? now],
    })),
  ])
}

// ── Blob Cache ───────────────────────────────────────────────

/** Look up a cached blob by SHA-256. Returns null if not found. */
export async function getCachedBlob(sha256: string): Promise<BlossomBlob | null> {
  const rows = await dbQuery<DBBlossomBlob>(
    `SELECT sha256, url, mime_type, size, uploaded_at, servers, nip94_json, metadata_event_id
     FROM blossom_blobs WHERE sha256 = ?`,
    [sha256],
  )
  if (rows.length === 0) return null
  return _rowToBlob(rows[0]!)
}

/** Store blob metadata in the local cache. Replaces any existing entry. */
export async function cacheBlob(blob: BlossomBlob, servers: string[]): Promise<void> {
  await dbRun(
    `INSERT OR REPLACE INTO blossom_blobs
       (sha256, url, mime_type, size, uploaded_at, servers, nip94_json, metadata_event_id)
     VALUES (?, ?, ?, ?, unixepoch(), ?, ?, ?)`,
    [
      blob.sha256,
      blob.url,
      blob.type,
      blob.size,
      JSON.stringify(servers),
      blob.nip94 ? JSON.stringify(blob.nip94) : null,
      blob.metadataEventId ?? null,
    ],
  )
}

/** Update the server list for an existing cached blob (e.g., after mirroring). */
export async function updateBlobServers(sha256: string, servers: string[]): Promise<void> {
  await dbRun(
    `UPDATE blossom_blobs SET servers = ? WHERE sha256 = ?`,
    [JSON.stringify(servers), sha256],
  )
}

/** Update cached blob metadata after a later metadata republish. */
export async function updateCachedBlobMetadata(
  sha256: string,
  metadata: Nip94Tags,
  metadataEventId?: string,
): Promise<void> {
  await dbRun(
    `UPDATE blossom_blobs
        SET nip94_json = ?,
            metadata_event_id = COALESCE(?, metadata_event_id)
      WHERE sha256 = ?`,
    [
      JSON.stringify(metadata),
      metadataEventId ?? null,
      sha256,
    ],
  )
}

/** List all cached blobs ordered by upload time (newest first). */
export async function listCachedBlobs(limit = 100): Promise<BlossomBlob[]> {
  const rows = await dbQuery<DBBlossomBlob>(
    `SELECT sha256, url, mime_type, size, uploaded_at, servers, nip94_json, metadata_event_id
     FROM blossom_blobs
     ORDER BY uploaded_at DESC
     LIMIT ?`,
    [limit],
  )
  return rows.map(_rowToBlob)
}

/** Remove a blob from the local cache. Does not delete from servers. */
export async function removeCachedBlob(sha256: string): Promise<void> {
  await dbRun('DELETE FROM blossom_blobs WHERE sha256 = ?', [sha256])
}

function _rowToBlob(row: DBBlossomBlob): BlossomBlob {
  let nip94
  if (row.nip94_json) {
    try {
      nip94 = normalizeNip94FromObject(JSON.parse(row.nip94_json), {
        url: row.url,
        mimeType: row.mime_type,
        fileHash: row.sha256,
      })
    } catch {
      nip94 = undefined
    }
  }

  return {
    sha256:   row.sha256,
    url:      row.url,
    type:     row.mime_type,
    size:     row.size,
    uploaded: row.uploaded_at,
    ...(nip94 ? { nip94 } : {}),
    ...(row.metadata_event_id ? { metadataEventId: row.metadata_event_id } : {}),
  }
}
