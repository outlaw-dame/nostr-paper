-- Persist Tagr bot moderation outcomes independently of search_docs lifecycle.
-- This lets moderation survive ingestion ordering (block can arrive before target event)
-- and keeps search_docs moderation_state self-healing on reindex/upsert.

CREATE TABLE IF NOT EXISTS tagr_blocks (
  event_id        text PRIMARY KEY,
  reason          text NOT NULL,
  source_event_id text NOT NULL,
  source_pubkey   text NOT NULL,
  blocked_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tagr_blocks_blocked_at
  ON tagr_blocks (blocked_at DESC);
