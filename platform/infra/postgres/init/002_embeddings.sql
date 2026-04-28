CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE search_docs ADD COLUMN IF NOT EXISTS embedding vector(384);
CREATE INDEX IF NOT EXISTS idx_search_docs_embedding ON search_docs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
