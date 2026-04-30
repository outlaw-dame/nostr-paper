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
- MUST store and serve `kind:10002` relay-list events (NIP-65)

### NIP-65 Outbox Compatibility

- Client publish fanout: author write relays + tagged-user read relays.
- Relay list discoverability: republish the author's latest `kind:10002` alongside normal publishing fanout.
- Ingestion bridge preserves all `kind:10002` events and now emits parsed outbox snapshots (`read_relays`, `write_relays`) in stream envelopes.
- Search/index workers may ignore `kind:10002` for lexical relevance, but relay and ingestion layers must not drop or mutate these events.

### Tagr Moderation Integration

- Ingestion bridge can subscribe to a dedicated Tagr relay source (`TAGR_RELAY_URL`) and accept only the trusted bot pubkey (`TAGR_BOT_PUBKEY`) for kinds `1984` and `1985`.
- Lexical worker persists Tagr decisions in `tagr_blocks` and marks matching `search_docs` rows as `moderation_state='blocked'`.
- Search API already enforces `moderation_state='allowed'`, so Tagr-blocked content is excluded from relay-search results.
- Block state is durable and self-healing: if moderation arrives before the target event is indexed, later upserts still resolve to `blocked`.

### Relay Media Handling

- strfry stores media-related events as regular Nostr events subject to size limits (`events.maxEventSize`).
- Ingestion bridge validates signatures and content/tag limits but does not fetch or transform media payloads.
- Platform search indexes textual/event metadata only; media bytes are never proxied through relay/search services.
- Client-side media safety, fetch-proxying, and NSFW evaluation remain in the app layer.

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
