ALTER TABLE search_docs
ADD COLUMN IF NOT EXISTS embedding_model text;

ALTER TABLE search_docs
ADD COLUMN IF NOT EXISTS embedding_version integer NOT NULL DEFAULT 1;
