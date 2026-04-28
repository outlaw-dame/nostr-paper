CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE search_docs ADD COLUMN IF NOT EXISTS embedding vector(384);
ALTER TABLE search_docs ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE search_docs ADD COLUMN IF NOT EXISTS embedding_version integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_search_docs_embedding ON search_docs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
