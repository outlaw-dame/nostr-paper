# Platform Architecture (Search + Relay + Control Plane)

## Core Principle

Separation of concerns between:

- Real-time relay (write path)
- Async indexing (compute path)
- Query/search (read path)

## Components

### 1. Relay Layer

- strfry (primary event ingestion + storage)
- Optional: write policies, rate limits

### 2. Event Bus

- Redis Streams
- Guarantees ordering per partition
- Enables fan-out to workers

### 3. Ingestion Bridge

- Subscribes to strfry
- Normalizes events
- Pushes into Redis Streams

### 4. Index Workers

- Tokenization (FTS)
- Embeddings (future phase)
- Hashtag / mention extraction

### 5. Search Layer

- PostgreSQL (FTS5 / pg_trgm)
- NIP-50 compliant API

### 6. Control Plane

- Trust scoring
- Relay health
- Content policies

## Data Flow

Relay → Bridge → Redis → Workers → Postgres → Search API → Client

## Why this architecture

- Keeps relay fast (no heavy compute inline)
- Enables horizontal scaling
- Enables future AI augmentation without redesign
