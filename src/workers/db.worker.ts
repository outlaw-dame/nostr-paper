/**
 * DB Worker
 *
 * SQLite WASM runs entirely in this dedicated Web Worker.
 * All disk I/O is off the main thread → UI stays at 60fps.
 *
 * Uses OPFS (Origin Private File System) for persistence.
 * Falls back to in-memory DB if OPFS is unavailable.
 *
 * Message protocol: DBWorkerRequest / DBWorkerResponse
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { DBWorkerRequest, DBWorkerResponse } from '@/types'

// ── Schema ───────────────────────────────────────────────────

const SCHEMA_VERSION = 1

// Detect mobile/iOS to apply conservative memory settings.
// iOS Safari kills Web Workers that allocate too much memory (e.g. 256MB mmap).
const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(
  (self as unknown as { navigator: Navigator }).navigator?.userAgent ?? ''
)
const CACHE_SIZE  = IS_MOBILE ? -4000  : -16000   // 4MB mobile, 16MB desktop
const MMAP_SIZE   = IS_MOBILE ? 0      : 67108864 // disabled mobile, 64MB desktop

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA wal_autocheckpoint = 1000;
PRAGMA journal_size_limit = 16777216; -- cap WAL/journal residue to 16MB
PRAGMA foreign_keys = ON;
PRAGMA trusted_schema = OFF;
PRAGMA defensive = ON;
PRAGMA temp_store = MEMORY;
PRAGMA auto_vacuum = INCREMENTAL;
PRAGMA cache_size = ${CACHE_SIZE};
PRAGMA mmap_size = ${MMAP_SIZE};
PRAGMA query_only = OFF;
PRAGMA optimize;              -- Run analyzer on startup

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Core Events ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id          TEXT    PRIMARY KEY,
  pubkey      TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  kind        INTEGER NOT NULL,
  content     TEXT    NOT NULL DEFAULT '',
  sig         TEXT    NOT NULL,
  raw         TEXT    NOT NULL,
  inserted_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Composite index for timeline queries (most common pattern)
CREATE INDEX IF NOT EXISTS idx_events_kind_created_at
  ON events(kind, created_at DESC);

-- Author timeline
CREATE INDEX IF NOT EXISTS idx_events_pubkey_kind_created
  ON events(pubkey, kind, created_at DESC);

-- For range queries with since/until
CREATE INDEX IF NOT EXISTS idx_events_created_at
  ON events(created_at DESC);

-- ── Tags (normalized) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  event_id  TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  value     TEXT    NOT NULL,
  idx       INTEGER NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Primary tag lookup (NIP-01 tag filters like #e, #p, #t)
CREATE INDEX IF NOT EXISTS idx_tags_name_value
  ON tags(name, value);

-- Reverse lookup: all tags for an event
CREATE INDEX IF NOT EXISTS idx_tags_event_id
  ON tags(event_id);

-- ── Profiles (kind 0, denormalized) ─────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  pubkey        TEXT    PRIMARY KEY,
  event_id      TEXT,
  name          TEXT,
  display_name  TEXT,
  picture       TEXT,
  banner        TEXT,
  about         TEXT,
  website       TEXT,
  nip05         TEXT,
  nip05_domain  TEXT,
  nip05_verified INTEGER NOT NULL DEFAULT 0,
  nip05_verified_at INTEGER,
  nip05_last_checked_at INTEGER,
  lud06         TEXT,
  lud16         TEXT,
  bot           INTEGER NOT NULL DEFAULT 0,
  birthday_json TEXT,
  updated_at    INTEGER NOT NULL,
  raw           TEXT    NOT NULL
);

-- ── Follows (kind 3, denormalized) ──────────────────────────
CREATE TABLE IF NOT EXISTS follows (
  follower  TEXT NOT NULL,
  followee  TEXT NOT NULL,
  relay_url TEXT,
  petname   TEXT,
  position  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (follower, followee)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower
  ON follows(follower);

CREATE INDEX IF NOT EXISTS idx_follows_followee
  ON follows(followee);

CREATE TABLE IF NOT EXISTS contact_lists (
  pubkey     TEXT    PRIMARY KEY,
  event_id   TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_lists_updated_at
  ON contact_lists(updated_at DESC);

-- ── Relay Lists (NIP-65 kind 10002) ─────────────────────────
CREATE TABLE IF NOT EXISTS relay_list (
  pubkey  TEXT    NOT NULL,
  url     TEXT    NOT NULL,
  read    INTEGER NOT NULL DEFAULT 1,
  write   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (pubkey, url)
);

CREATE INDEX IF NOT EXISTS idx_relay_list_pubkey
  ON relay_list(pubkey);

-- ── Event Deletions (kind 5) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS event_deletions (
  event_id          TEXT    NOT NULL,
  deleted_by        TEXT    NOT NULL,
  request_event_id  TEXT    NOT NULL,
  deleted_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (event_id, deleted_by)
);

CREATE INDEX IF NOT EXISTS idx_event_deletions_event_id
  ON event_deletions(event_id);

CREATE TABLE IF NOT EXISTS address_deletions (
  coordinate        TEXT    NOT NULL,
  deleted_by        TEXT    NOT NULL,
  until_created_at  INTEGER NOT NULL,
  request_event_id  TEXT    NOT NULL,
  deleted_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (coordinate, deleted_by, request_event_id)
);

CREATE INDEX IF NOT EXISTS idx_address_deletions_lookup
  ON address_deletions(coordinate, deleted_by, until_created_at DESC);

-- ── Seen Events (deduplication ring buffer) ──────────────────
-- Stores event IDs we've seen to avoid reprocessing relay duplicates
CREATE TABLE IF NOT EXISTS seen_events (
  event_id   TEXT    PRIMARY KEY,
  seen_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Clean up older seen entries via periodic maintenance.
CREATE INDEX IF NOT EXISTS idx_seen_events_seen_at
  ON seen_events(seen_at);

-- ── NIP-50 Full Text Search ──────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
  USING fts5(
    content,
    content  = 'events',
    content_rowid = 'rowid',
    tokenize = 'porter unicode61'
  );

-- Triggers to keep FTS index in sync with events table
CREATE TRIGGER IF NOT EXISTS events_ai
  AFTER INSERT ON events BEGIN
    INSERT INTO events_fts(rowid, content)
    VALUES (new.rowid, new.content);
  END;

CREATE TRIGGER IF NOT EXISTS events_ad
  AFTER DELETE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  END;

CREATE TRIGGER IF NOT EXISTS events_au
  AFTER UPDATE OF content ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
    INSERT INTO events_fts(rowid, content)
    VALUES (new.rowid, new.content);
  END;
`

// ── Migration v2: Blossom Media Server Support ───────────────

const MIGRATION_V2_SQL = `
-- BUD-03: User-configured Blossom media servers
CREATE TABLE IF NOT EXISTS blossom_servers (
  url       TEXT    PRIMARY KEY,
  priority  INTEGER NOT NULL DEFAULT 0,
  added_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- BUD-01: Local cache of uploaded blob metadata
CREATE TABLE IF NOT EXISTS blossom_blobs (
  sha256      TEXT    PRIMARY KEY,
  url         TEXT    NOT NULL,
  mime_type   TEXT    NOT NULL,
  size        INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL DEFAULT (unixepoch()),
  servers     TEXT    NOT NULL DEFAULT '[]', -- JSON array of server URLs
  nip94_json  TEXT,
  metadata_event_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_blossom_blobs_uploaded_at
  ON blossom_blobs(uploaded_at DESC);
`

// ── Migration v3: Profile Full-Text Search ───────────────────

const MIGRATION_V3_SQL = `
-- NIP-50 profile search: index name, display_name, about, nip05
CREATE VIRTUAL TABLE IF NOT EXISTS profiles_fts
  USING fts5(
    name,
    display_name,
    about,
    nip05,
    content      = 'profiles',
    content_rowid = 'rowid',
    tokenize     = 'porter unicode61'
  );

-- Keep profiles_fts in sync with the profiles table
CREATE TRIGGER IF NOT EXISTS profiles_ai
  AFTER INSERT ON profiles BEGIN
    INSERT INTO profiles_fts(rowid, name, display_name, about, nip05)
    VALUES (
      new.rowid,
      COALESCE(new.name,         ''),
      COALESCE(new.display_name, ''),
      COALESCE(new.about,        ''),
      COALESCE(new.nip05,        '')
    );
  END;

CREATE TRIGGER IF NOT EXISTS profiles_ad
  AFTER DELETE ON profiles BEGIN
    INSERT INTO profiles_fts(profiles_fts, rowid, name, display_name, about, nip05)
    VALUES (
      'delete', old.rowid,
      COALESCE(old.name,         ''),
      COALESCE(old.display_name, ''),
      COALESCE(old.about,        ''),
      COALESCE(old.nip05,        '')
    );
  END;

CREATE TRIGGER IF NOT EXISTS profiles_au
  AFTER UPDATE ON profiles BEGIN
    INSERT INTO profiles_fts(profiles_fts, rowid, name, display_name, about, nip05)
    VALUES (
      'delete', old.rowid,
      COALESCE(old.name,         ''),
      COALESCE(old.display_name, ''),
      COALESCE(old.about,        ''),
      COALESCE(old.nip05,        '')
    );
    INSERT INTO profiles_fts(rowid, name, display_name, about, nip05)
    VALUES (
      new.rowid,
      COALESCE(new.name,         ''),
      COALESCE(new.display_name, ''),
      COALESCE(new.about,        ''),
      COALESCE(new.nip05,        '')
    );
  END;

-- Backfill existing profiles into the FTS index
INSERT INTO profiles_fts(rowid, name, display_name, about, nip05)
SELECT
  rowid,
  COALESCE(name,         ''),
  COALESCE(display_name, ''),
  COALESCE(about,        ''),
  COALESCE(nip05,        '')
FROM profiles;
`

// ── Migration v4: Indexed NIP-05 Domains For `domain:` Search ─────────────

const MIGRATION_V4_SQL = `
CREATE INDEX IF NOT EXISTS idx_profiles_nip05_domain
  ON profiles(nip05_domain);

UPDATE profiles
SET nip05_domain = NULL
WHERE nip05_domain IS NOT NULL;
`

// ── Migration v5: Verified NIP-05 Metadata ────────────────────────────────

const MIGRATION_V5_SQL = `
UPDATE profiles
SET
  nip05 = CASE
    WHEN nip05 IS NULL THEN NULL
    ELSE lower(trim(nip05))
  END,
  nip05_domain = NULL,
  nip05_verified = 0,
  nip05_verified_at = NULL,
  nip05_last_checked_at = NULL;
`

// ── Migration v7: Full Kind-3 Contact List Metadata ───────────────────────

const MIGRATION_V7_SQL = `
CREATE TABLE IF NOT EXISTS contact_lists (
  pubkey     TEXT    PRIMARY KEY,
  event_id   TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_lists_updated_at
  ON contact_lists(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_follows_follower_position
  ON follows(follower, position, followee);
`

// ── Migration v9: Performance Indexes For Hot Query Paths ──────────────────

const MIGRATION_V9_SQL = `
CREATE INDEX IF NOT EXISTS idx_events_kind_created_id
  ON events(kind, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_events_pubkey_created_id
  ON events(pubkey, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_profiles_updated_at_pubkey
  ON profiles(updated_at DESC, pubkey);

CREATE INDEX IF NOT EXISTS idx_tags_name_value_event_id
  ON tags(name, value, event_id);

CREATE INDEX IF NOT EXISTS idx_tags_event_id_name_value
  ON tags(event_id, name, value);
`

// ── Migration v10: Critical Deletion & Deduplication Indexes ──────────────

const MIGRATION_V10_SQL = `
CREATE INDEX IF NOT EXISTS idx_event_deletions_deleted_by_created
  ON event_deletions(deleted_by, event_id);

CREATE INDEX IF NOT EXISTS idx_address_deletions_deleted_by
  ON address_deletions(deleted_by, coordinate);

CREATE INDEX IF NOT EXISTS idx_seen_events_event_id_seen_at
  ON seen_events(event_id, seen_at);
`

// ── Migration v11: Profile & Contact Query Optimization ────────────────

const MIGRATION_V11_SQL = `
CREATE INDEX IF NOT EXISTS idx_profiles_pubkey_picture
  ON profiles(pubkey, picture);

CREATE INDEX IF NOT EXISTS idx_follows_followee_follower
  ON follows(followee, follower);

CREATE INDEX IF NOT EXISTS idx_relay_list_pubkey_url
  ON relay_list(pubkey, url);
`

// ── Worker State ─────────────────────────────────────────────

type SqliteDB = {
  exec: (config: {
    sql: string
    bind?: unknown[]
    rowMode?: string
    callback?: (row: Record<string, unknown>) => void
    returnValue?: string
  } | string) => void
  changes: () => number
  close: () => void
}

let _db: SqliteDB | null = null
let initialized = false

async function openDB(): Promise<SqliteDB> {
  const sqlite3 = await sqlite3InitModule()

  // Try OPFS first (persistent, high-performance)
  if ('opfs' in sqlite3) {
    try {
      const opfsDb = new sqlite3.oo1.OpfsDb('/nostr-paper.sqlite3') as SqliteDB
      self.postMessage({ type: 'log', message: 'Using OPFS persistent storage' })
      return opfsDb
    } catch (err) {
      self.postMessage({ type: 'log', message: `OPFS failed, falling back to in-memory: ${err}` })
    }
  }

  // Fallback to in-memory (data lost on page close, but fully functional)
  const memDb = new sqlite3.oo1.DB('/nostr-paper.sqlite3', 'ct') as SqliteDB
  self.postMessage({ type: 'log', message: 'Using in-memory storage (OPFS unavailable)' })
  return memDb
}

function getTableColumns(table: string): Set<string> {
  const columns = new Set<string>()
  _db?.exec({
    sql: `PRAGMA table_info(${table})`,
    rowMode: 'object',
    callback: (row) => {
      const name = row['name']
      if (typeof name === 'string') columns.add(name)
    },
  })
  return columns
}

function tableExists(table: string): boolean {
  let exists = false
  _db?.exec({
    sql: 'SELECT 1 FROM sqlite_master WHERE type IN (\'table\', \'view\') AND name = ? LIMIT 1',
    bind: [table],
    rowMode: 'object',
    callback: () => { exists = true },
  })
  return exists
}

function ensureProfileSchema(): void {
  const columns = getTableColumns('profiles')
  if (!columns.has('event_id')) {
    _db?.exec('ALTER TABLE profiles ADD COLUMN event_id TEXT')
  }
  if (!columns.has('banner')) {
    _db?.exec('ALTER TABLE profiles ADD COLUMN banner TEXT')
  }
  if (!columns.has('website')) {
    _db?.exec('ALTER TABLE profiles ADD COLUMN website TEXT')
  }
  if (!columns.has('nip05_domain')) {
    _db?.exec('ALTER TABLE profiles ADD COLUMN nip05_domain TEXT')
  }
  if (!columns.has('nip05_verified')) {
    _db?.exec('ALTER TABLE profiles ADD COLUMN nip05_verified INTEGER NOT NULL DEFAULT 0')
  }
  if (!columns.has('nip05_verified_at')) {
    _db?.exec('ALTER TABLE profiles ADD COLUMN nip05_verified_at INTEGER')
  }
  if (!columns.has('nip05_last_checked_at')) {
    _db?.exec('ALTER TABLE profiles ADD COLUMN nip05_last_checked_at INTEGER')
  }
  if (!columns.has('lud06')) {
    _db?.exec('ALTER TABLE profiles ADD COLUMN lud06 TEXT')
  }
  if (!columns.has('bot')) {
    _db?.exec('ALTER TABLE profiles ADD COLUMN bot INTEGER NOT NULL DEFAULT 0')
  }
  if (!columns.has('birthday_json')) {
    _db?.exec('ALTER TABLE profiles ADD COLUMN birthday_json TEXT')
  }
  if (!columns.has('external_identities')) {
    _db?.exec('ALTER TABLE profiles ADD COLUMN external_identities TEXT')
  }

  _db?.exec(`
    CREATE INDEX IF NOT EXISTS idx_profiles_nip05_domain
      ON profiles(nip05_domain);
  `)
}

function ensureProfilesFts(): void {
  if (!tableExists('profiles_fts')) {
    _db?.exec(MIGRATION_V3_SQL)
    return
  }

  _db?.exec(`
    CREATE TRIGGER IF NOT EXISTS profiles_ai
      AFTER INSERT ON profiles BEGIN
        INSERT INTO profiles_fts(rowid, name, display_name, about, nip05)
        VALUES (
          new.rowid,
          COALESCE(new.name,         ''),
          COALESCE(new.display_name, ''),
          COALESCE(new.about,        ''),
          COALESCE(new.nip05,        '')
        );
      END;

    CREATE TRIGGER IF NOT EXISTS profiles_ad
      AFTER DELETE ON profiles BEGIN
        INSERT INTO profiles_fts(profiles_fts, rowid, name, display_name, about, nip05)
        VALUES (
          'delete', old.rowid,
          COALESCE(old.name,         ''),
          COALESCE(old.display_name, ''),
          COALESCE(old.about,        ''),
          COALESCE(old.nip05,        '')
        );
      END;

    CREATE TRIGGER IF NOT EXISTS profiles_au
      AFTER UPDATE ON profiles BEGIN
        INSERT INTO profiles_fts(profiles_fts, rowid, name, display_name, about, nip05)
        VALUES (
          'delete', old.rowid,
          COALESCE(old.name,         ''),
          COALESCE(old.display_name, ''),
          COALESCE(old.about,        ''),
          COALESCE(old.nip05,        '')
        );
        INSERT INTO profiles_fts(rowid, name, display_name, about, nip05)
        VALUES (
          new.rowid,
          COALESCE(new.name,         ''),
          COALESCE(new.display_name, ''),
          COALESCE(new.about,        ''),
          COALESCE(new.nip05,        '')
        );
      END;
  `)

}

function ensureBlossomBlobSchema(): void {
  const columns = getTableColumns('blossom_blobs')
  if (columns.size === 0) return

  if (!columns.has('nip94_json')) {
    _db?.exec('ALTER TABLE blossom_blobs ADD COLUMN nip94_json TEXT')
  }
  if (!columns.has('metadata_event_id')) {
    _db?.exec('ALTER TABLE blossom_blobs ADD COLUMN metadata_event_id TEXT')
  }
}

function ensureFollowSchema(): void {
  const columns = getTableColumns('follows')

  if (columns.size === 0) {
    _db?.exec(`
      CREATE TABLE IF NOT EXISTS follows (
        follower   TEXT    NOT NULL,
        followee   TEXT    NOT NULL,
        relay_url  TEXT,
        petname    TEXT,
        position   INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (follower, followee)
      );
    `)
  } else {
    if (!columns.has('relay_url')) {
      _db?.exec('ALTER TABLE follows ADD COLUMN relay_url TEXT')
    }
    if (!columns.has('petname')) {
      _db?.exec('ALTER TABLE follows ADD COLUMN petname TEXT')
    }
    if (!columns.has('position')) {
      _db?.exec('ALTER TABLE follows ADD COLUMN position INTEGER NOT NULL DEFAULT 0')
    }
    if (!columns.has('updated_at')) {
      _db?.exec('ALTER TABLE follows ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0')
    }
  }

  _db?.exec(`
    CREATE INDEX IF NOT EXISTS idx_follows_follower
      ON follows(follower);

    CREATE INDEX IF NOT EXISTS idx_follows_follower_position
      ON follows(follower, position, followee);

    CREATE INDEX IF NOT EXISTS idx_follows_followee
      ON follows(followee);
  `)

  _db?.exec(MIGRATION_V7_SQL)
}

function ensurePerformanceIndexes(): void {
  _db?.exec(MIGRATION_V9_SQL)
}

async function initializeDB(): Promise<void> {
  if (initialized) return

  _db = await openDB()

  // Run base schema (idempotent — all CREATE TABLE IF NOT EXISTS)
  _db.exec(SCHEMA_SQL)
  ensureProfileSchema()
  ensureFollowSchema()
  _db.exec({
    sql: `INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)`,
    bind: [SCHEMA_VERSION],
  })

  // Migration v2: Blossom tables
  const v2Applied: number[] = []
  _db.exec({
    sql:     'SELECT 1 FROM schema_migrations WHERE version = 2',
    rowMode: 'object',
    callback: () => { v2Applied.push(1) },
  })
  if (v2Applied.length === 0) {
    _db.exec(MIGRATION_V2_SQL)
    _db.exec({ sql: 'INSERT INTO schema_migrations (version) VALUES (2)' })
  }
  ensureBlossomBlobSchema()

  // Migration v3: Profile FTS
  const v3Applied: number[] = []
  _db.exec({
    sql:     'SELECT 1 FROM schema_migrations WHERE version = 3',
    rowMode: 'object',
    callback: () => { v3Applied.push(1) },
  })
  if (v3Applied.length === 0) {
    ensureProfilesFts()
    _db.exec({ sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (3)' })
  } else {
    ensureProfilesFts()
  }

  // Migration v4: indexed NIP-05 domain for local `domain:` filtering
  const v4Applied: number[] = []
  _db.exec({
    sql:     'SELECT 1 FROM schema_migrations WHERE version = 4',
    rowMode: 'object',
    callback: () => { v4Applied.push(1) },
  })
  if (v4Applied.length === 0) {
    _db.exec(MIGRATION_V4_SQL)
    _db.exec({ sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (4)' })
  } else {
    _db.exec(`
      CREATE INDEX IF NOT EXISTS idx_profiles_nip05_domain
        ON profiles(nip05_domain);
    `)
  }

  // Migration v5: verified NIP-05 state and freshness tracking
  const v5Applied: number[] = []
  _db.exec({
    sql:     'SELECT 1 FROM schema_migrations WHERE version = 5',
    rowMode: 'object',
    callback: () => { v5Applied.push(1) },
  })
  if (v5Applied.length === 0) {
    ensureProfileSchema()
    _db.exec(MIGRATION_V5_SQL)
    _db.exec({ sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (5)' })
  }

  const v6Applied: number[] = []
  _db.exec({
    sql: 'SELECT 1 FROM schema_migrations WHERE version = 6',
    rowMode: 'object',
    callback: () => { v6Applied.push(1) },
  })
  if (v6Applied.length === 0) {
    ensureBlossomBlobSchema()
    _db.exec({ sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (6)' })
  } else {
    ensureBlossomBlobSchema()
  }

  const v7Applied: number[] = []
  _db.exec({
    sql: 'SELECT 1 FROM schema_migrations WHERE version = 7',
    rowMode: 'object',
    callback: () => { v7Applied.push(1) },
  })
  if (v7Applied.length === 0) {
    ensureFollowSchema()
    _db.exec({ sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (7)' })
  } else {
    ensureFollowSchema()
  }

  const v8Applied: number[] = []
  _db.exec({
    sql: 'SELECT 1 FROM schema_migrations WHERE version = 8',
    rowMode: 'object',
    callback: () => { v8Applied.push(1) },
  })
  if (v8Applied.length === 0) {
    ensureProfileSchema()
    _db.exec({ sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (8)' })
  } else {
    ensureProfileSchema()
  }

  const v9Applied: number[] = []
  _db.exec({
    sql: 'SELECT 1 FROM schema_migrations WHERE version = 9',
    rowMode: 'object',
    callback: () => { v9Applied.push(1) },
  })
  if (v9Applied.length === 0) {
    ensurePerformanceIndexes()
    _db.exec({ sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (9)' })
  } else {
    ensurePerformanceIndexes()
  }

  const v10Applied: number[] = []
  _db.exec({
    sql: 'SELECT 1 FROM schema_migrations WHERE version = 10',
    rowMode: 'object',
    callback: () => { v10Applied.push(1) },
  })
  if (v10Applied.length === 0) {
    _db.exec(MIGRATION_V10_SQL)
    _db.exec({ sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (10)' })
  } else {
    _db.exec(MIGRATION_V10_SQL)
  }

  const v11Applied: number[] = []
  _db.exec({
    sql: 'SELECT 1 FROM schema_migrations WHERE version = 11',
    rowMode: 'object',
    callback: () => { v11Applied.push(1) },
  })
  if (v11Applied.length === 0) {
    _db.exec(MIGRATION_V11_SQL)
    _db.exec({ sql: 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (11)' })
  } else {
    _db.exec(MIGRATION_V11_SQL)
  }

  // Bound analysis rows per index before running optimize.
  // analysis_limit = 0 means unlimited, which is slow on large DBs on mobile.
  _db.exec('PRAGMA analysis_limit = 400;')
  _db.exec('PRAGMA optimize = 0x10002;')

  initialized = true
}

// ── Message Handler ──────────────────────────────────────────

self.addEventListener('message', async (e: MessageEvent<DBWorkerRequest>) => {
  const { id, type } = e.data
  const respond = (result: unknown) => {
    self.postMessage({ id, result } satisfies DBWorkerResponse)
  }
  const respondError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    self.postMessage({ id, error: message } satisfies DBWorkerResponse)
  }

  try {
    switch (type) {
      case 'init': {
        await initializeDB()
        respond('ok')
        break
      }

      case 'exec': {
        if (!_db) throw new Error('DB not initialized')
        const { sql, bind } = (e.data as Extract<DBWorkerRequest, { type: 'exec' }>).payload
        const rows: Record<string, unknown>[] = []
        _db.exec({
          sql,
          ...(bind !== undefined ? { bind } : {}),
          rowMode: 'object',
          callback: (row) => { rows.push(row) },
        })
        respond(rows)
        break
      }

      case 'run': {
        if (!_db) throw new Error('DB not initialized')
        const { sql, bind } = (e.data as Extract<DBWorkerRequest, { type: 'run' }>).payload
        _db.exec({ sql, ...(bind !== undefined ? { bind } : {}) })
        respond({ changes: _db.changes() })
        break
      }

      case 'transaction': {
        if (!_db) throw new Error('DB not initialized')
        const ops = (e.data as Extract<DBWorkerRequest, { type: 'transaction' }>).payload
        // Reserve the write lock up front to avoid mid-transaction lock escalation.
        _db.exec('BEGIN IMMEDIATE')
        try {
          for (const op of ops) {
            _db.exec({ sql: op.sql, ...(op.bind !== undefined ? { bind: op.bind } : {}) })
          }
          _db.exec('COMMIT')
        } catch (err) {
          try { _db.exec('ROLLBACK') } catch { /* ignore rollback errors */ }
          throw err
        }
        respond('ok')
        break
      }

      case 'close': {
        if (_db) {
          _db.close()
          _db = null
          initialized = false
        }
        respond('ok')
        break
      }

      default: {
        respondError(`Unknown message type: ${type as string}`)
      }
    }
  } catch (error) {
    respondError(error)
  }
})
