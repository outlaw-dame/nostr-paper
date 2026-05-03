-- Threading columns for events_raw (NIP-10 kind-1/11, NIP-22 kind-1111, NIP-23 kind-30023/30024)
ALTER TABLE events_raw
  ADD COLUMN IF NOT EXISTS reply_to_id  text,
  ADD COLUMN IF NOT EXISTS root_id      text,
  ADD COLUMN IF NOT EXISTS root_address text,
  ADD COLUMN IF NOT EXISTS root_kind    text,
  ADD COLUMN IF NOT EXISTS is_reply     boolean NOT NULL DEFAULT false;

-- Index for fetching all replies to a direct parent (e.g. "show replies to this comment")
CREATE INDEX IF NOT EXISTS idx_events_raw_reply_to_id
  ON events_raw (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

-- Index for fetching an entire conversation tree by root event id
CREATE INDEX IF NOT EXISTS idx_events_raw_root_id
  ON events_raw (root_id)
  WHERE root_id IS NOT NULL;

-- Index for fetching comments on addressable roots (NIP-22 articles etc.)
CREATE INDEX IF NOT EXISTS idx_events_raw_root_address
  ON events_raw (root_address)
  WHERE root_address IS NOT NULL;

-- Mirror columns on search_docs for query efficiency (avoids join to events_raw for thread fetches)
ALTER TABLE search_docs
  ADD COLUMN IF NOT EXISTS reply_to_id  text,
  ADD COLUMN IF NOT EXISTS root_id      text,
  ADD COLUMN IF NOT EXISTS root_address text,
  ADD COLUMN IF NOT EXISTS root_kind    text,
  ADD COLUMN IF NOT EXISTS is_reply     boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_search_docs_reply_to_id
  ON search_docs (reply_to_id)
  WHERE reply_to_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_search_docs_root_id
  ON search_docs (root_id)
  WHERE root_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_search_docs_root_address
  ON search_docs (root_address)
  WHERE root_address IS NOT NULL;
