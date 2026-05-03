/**
 * avatarCache
 *
 * Opportunistic IndexedDB blob cache for profile avatars.
 *
 * Strategy: best-effort, never blocks the UI.
 *   - On `getCachedAvatarBlobUrl(url)`: returns a `blob:` URL if the avatar
 *     was previously cached (and not stale). Returns `null` on miss.
 *   - On `primeAvatarCache(url)`: kicked off after the natural <img> load
 *     succeeded. Performs a CORS-mode `fetch` and stores the blob in IDB.
 *     Failures (CORS rejection, network error, opaque response) are silent
 *     — the cache simply stays empty for that URL and the browser HTTP
 *     cache continues to serve subsequent loads in the same session.
 *
 * Across browser sessions / HTTP-cache evictions, hosts that opt in to CORS
 * get persistent durable caching while non-CORS hosts gracefully degrade
 * to ordinary browser caching with no extra round-trips.
 */

const DB_NAME = 'nostr-paper-media'
const STORE_NAME = 'avatars'
const DB_VERSION = 1

const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const SOFT_CAP_BYTES = 50 * 1024 * 1024 // 50 MB
const MAX_BLOB_BYTES = 512 * 1024       // 512 KB per avatar — anything larger isn't really a thumbnail
const PRUNE_PROBABILITY = 0.05          // 5% of writes trigger an opportunistic prune

interface AvatarRecord {
  url: string
  blob: Blob
  size: number
  storedAt: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null
const objectUrlByUrl = new Map<string, string>()
const inFlightPrimes = new Set<string>()

function isAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && typeof Blob !== 'undefined'
}

function openDB(): Promise<IDBDatabase | null> {
  if (!isAvailable()) return Promise.resolve(null)
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' })
          store.createIndex('storedAt', 'storedAt', { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T | null> {
  return openDB().then((db) => {
    if (!db) return null
    return new Promise<T | null>((resolve) => {
      let tx: IDBTransaction
      try {
        tx = db.transaction(STORE_NAME, mode)
      } catch {
        resolve(null)
        return
      }
      const store = tx.objectStore(STORE_NAME)
      let result: T | null = null
      try {
        const ret = fn(store)
        if (ret && typeof (ret as IDBRequest<T>).onsuccess !== 'undefined') {
          ;(ret as IDBRequest<T>).onsuccess = () => {
            result = (ret as IDBRequest<T>).result
          }
        } else if (ret && typeof (ret as Promise<T>).then === 'function') {
          ;(ret as Promise<T>).then((value) => { result = value })
        }
      } catch {
        resolve(null)
        return
      }
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    })
  })
}

function isFreshRecord(record: AvatarRecord | null | undefined): record is AvatarRecord {
  if (!record) return false
  return Date.now() - record.storedAt < TTL_MS
}

/**
 * Returns a `blob:` URL for a previously cached avatar, or `null` if the
 * URL has never been cached or the cached entry is stale. Never throws.
 */
export async function getCachedAvatarBlobUrl(url: string | null | undefined): Promise<string | null> {
  if (!url || !isAvailable()) return null
  const cached = objectUrlByUrl.get(url)
  if (cached) return cached

  const record = await withStore<AvatarRecord>('readonly', (store) => store.get(url) as IDBRequest<AvatarRecord>)
  if (!isFreshRecord(record)) return null

  try {
    const blobUrl = URL.createObjectURL(record.blob)
    objectUrlByUrl.set(url, blobUrl)
    return blobUrl
  } catch {
    return null
  }
}

/**
 * Best-effort: fetch the URL and store the blob. Safe to call repeatedly —
 * de-duplicated and silent on failure.
 */
export async function primeAvatarCache(url: string | null | undefined): Promise<void> {
  if (!url || !isAvailable()) return
  if (inFlightPrimes.has(url)) return
  if (objectUrlByUrl.has(url)) return

  // Skip if already cached and fresh.
  const existing = await withStore<AvatarRecord>('readonly', (store) => store.get(url) as IDBRequest<AvatarRecord>)
  if (isFreshRecord(existing)) return

  inFlightPrimes.add(url)
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' })
    if (!response.ok || response.type === 'opaque') return
    const blob = await response.blob()
    if (blob.size === 0 || blob.size > MAX_BLOB_BYTES) return
    if (!blob.type.startsWith('image/')) return

    const record: AvatarRecord = {
      url,
      blob,
      size: blob.size,
      storedAt: Date.now(),
    }
    await withStore<unknown>('readwrite', (store) => store.put(record) as IDBRequest<unknown>)

    if (Math.random() < PRUNE_PROBABILITY) {
      void pruneAvatarCache()
    }
  } catch {
    // Silent — CORS, network errors, IDB quota, etc. all fall back to no-cache behavior.
  } finally {
    inFlightPrimes.delete(url)
  }
}

/**
 * Drop stale entries (>TTL) and, if the total footprint exceeds the soft
 * cap, evict oldest entries until under cap. Best-effort, silent on error.
 */
export async function pruneAvatarCache(): Promise<void> {
  const db = await openDB()
  if (!db) return
  await new Promise<void>((resolve) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(STORE_NAME, 'readwrite')
    } catch {
      resolve()
      return
    }
    const store = tx.objectStore(STORE_NAME)
    const cutoff = Date.now() - TTL_MS
    const entries: Array<{ url: string; storedAt: number; size: number }> = []
    const cursorReq = store.openCursor()
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (!cursor) {
        // Pass 2: enforce soft cap.
        let total = entries.reduce((acc, entry) => acc + entry.size, 0)
        if (total > SOFT_CAP_BYTES) {
          entries.sort((a, b) => a.storedAt - b.storedAt)
          for (const entry of entries) {
            if (total <= SOFT_CAP_BYTES) break
            store.delete(entry.url)
            total -= entry.size
          }
        }
        return
      }
      const value = cursor.value as AvatarRecord
      if (value.storedAt < cutoff) {
        cursor.delete()
      } else {
        entries.push({ url: value.url, storedAt: value.storedAt, size: value.size })
      }
      cursor.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

/**
 * Drop the in-process object-URL map and revoke any URLs we created.
 * Used when the user signs out or wipes local storage.
 */
export function disposeAvatarObjectUrls(): void {
  for (const url of objectUrlByUrl.values()) {
    try { URL.revokeObjectURL(url) } catch { /* noop */ }
  }
  objectUrlByUrl.clear()
}
