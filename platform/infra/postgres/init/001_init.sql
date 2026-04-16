CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS events_raw (
  id                text PRIMARY KEY,
  pubkey            text NOT NULL,
  kind              integer NOT NULL,
  created_at        timestamptz NOT NULL,
  content           text NOT NULL DEFAULT '',
  tags              jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw               jsonb NOT NULL,
  source_relay      text,
  source_type       text NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  is_replaceable    boolean NOT NULL DEFAULT false,
  is_ephemeral      boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_events_raw_kind_created_at
  ON events_raw (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_raw_pubkey_created_at
  ON events_raw (pubkey, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_raw_source_relay
  ON events_raw (source_relay);

CREATE INDEX IF NOT EXISTS idx_events_raw_tags_gin
  ON events_raw USING gin (tags jsonb_path_ops);

CREATE TABLE IF NOT EXISTS search_docs (
  event_id             text PRIMARY KEY REFERENCES events_raw(id) ON DELETE CASCADE,
  language             text NOT NULL DEFAULT 'simple',
  search_text          text NOT NULL,
  fts                  tsvector NOT NULL,
  title_text           text,
  author_pubkey        text NOT NULL,
  kind                 integer NOT NULL,
  created_at           timestamptz NOT NULL,
  hashtags             text[] NOT NULL DEFAULT '{}',
  mentions             text[] NOT NULL DEFAULT '{}',
  urls                 text[] NOT NULL DEFAULT '{}',
  moderation_state     text NOT NULL DEFAULT 'allowed',
  is_searchable        boolean NOT NULL DEFAULT true,
  rank_boost           real NOT NULL DEFAULT 1.0,
  indexed_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_docs_fts
  ON search_docs USING gin (fts);

CREATE INDEX IF NOT EXISTS idx_search_docs_kind_created_at
  ON search_docs (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_docs_author_created_at
  ON search_docs (author_pubkey, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_search_docs_hashtags_gin
  ON search_docs USING gin (hashtags);

CREATE INDEX IF NOT EXISTS idx_search_docs_mentions_gin
  ON search_docs USING gin (mentions);

CREATE INDEX IF NOT EXISTS idx_search_docs_searchable
  ON search_docs (is_searchable, moderation_state, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type      text NOT NULL,
  subject        text NOT NULL,
  action         text NOT NULL,
  scope          jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS moderation_events (
  event_id         text PRIMARY KEY REFERENCES events_raw(id) ON DELETE CASCADE,
  decision         text NOT NULL,
  reason           text,
  matched_rule_ids uuid[] NOT NULL DEFAULT '{}',
  review_state     text NOT NULL DEFAULT 'final',
  decided_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moderation_events_decision
  ON moderation_events (decision, decided_at DESC);

CREATE TABLE IF NOT EXISTS relay_sources (
  relay_url        text PRIMARY KEY,
  enabled          boolean NOT NULL DEFAULT true,
  last_seen_at     timestamptz,
  latency_ms       integer,
  event_rate_1m    integer NOT NULL DEFAULT 0,
  failure_count    integer NOT NULL DEFAULT 0,
  notes            text
);

CREATE TABLE IF NOT EXISTS pubkey_usage (
  pubkey                  text PRIMARY KEY,
  event_count             bigint NOT NULL DEFAULT 0,
  searchable_event_count  bigint NOT NULL DEFAULT 0,
  approx_storage_bytes    bigint NOT NULL DEFAULT 0,
  last_active_at          timestamptz
);
