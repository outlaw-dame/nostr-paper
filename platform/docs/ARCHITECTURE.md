# Platform Architecture (Search + Relay + Control Plane)

## Core Principle

Separation of concerns between:

- Real-time relay (write path)
- Async indexing (compute path)
- Query/search (read path)

## Components

### 1. Relay Layer

- strfry (primary event ingestion + storage)
- Synchronous write policy for intelligent rate limiting
- MUST store and serve `kind:10002` relay-list events (NIP-65)

### Intelligent Relay Rate Limiting

The relay uses a strfry write-policy plugin before events are accepted into LMDB. The policy is intentionally cheap and deterministic so the write path stays fast:

- Token buckets are maintained for pubkeys, source addresses, and the relay as a whole.
- Events consume weighted points instead of a flat request count. Large events, heavy tag fanout, media metadata, moderation events, and addressable/list events cost more than lightweight reactions.
- Repeated rejection creates a temporary penalty multiplier, so noisy clients cool down faster without permanently banning a key.
- Duplicate event bodies are rejected inside a short window to stop replay spam.
- Excessive `p` tags are rejected as likely hellthread fanout before storage.
- Allowlists exist for trusted pubkeys and infrastructure sources.

This is not model-based moderation. It is an inline abuse throttle. AI or heavier reputation jobs can observe the event stream later and write trust/abuse signals into the control plane, but the relay never waits on a model before acknowledging or rejecting a write.

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
- Platform search indexes textual/event metadata, BUD-03 Blossom server-list events (`kind:10063`), NIP-94 metadata, NIP-92 `imeta` URLs, and `fallback`/`server` URLs. Media bytes are never proxied through relay/search services.
- Client-side media safety, fetch-proxying, and NSFW evaluation remain in the app layer.

### Blossom Edge Storage

- `services/blossom-edge` is the media edge: a Cloudflare Worker that implements Blossom HTTP endpoints and stores blobs by SHA-256 in R2.
- R2 is the hot path for media retrieval (`GET|HEAD /<sha256>[.<ext>]`) with immutable cache headers and range reads for video/audio.
- Filebase is the archival path. When configured, uploads and mirrors are also written to a Filebase IPFS bucket through its S3-compatible API, and returned descriptors can include an IPFS gateway fallback.
- The relay layer only stores signed Nostr metadata: BUD-03 server lists, NIP-94 kind-1063 file metadata, and NIP-92 media tags. Blob bytes stay out of strfry/Postgres.

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
- Rate-limit tuning and allowlists
- Future async AI/reputation signals consumed by policy configuration, not synchronous relay inference

## Data Flow

Relay → Bridge → Redis → Workers → Postgres → Search API → Client

Write gate:

Client → strfry write-policy plugin → strfry LMDB → Bridge → Redis → Workers

## Why this architecture

- Keeps relay fast (no heavy compute inline)
- Enables horizontal scaling
- Enables future AI augmentation without redesign:
  - New AI workers can subscribe to Redis Streams beside the lexical and embedding workers.
  - They can add summaries, spam/reputation scores, topic labels, translation hints, semantic clusters, and ranking features into Postgres/control-plane tables.
  - Search and client APIs can read those derived fields without changing the Nostr relay protocol or putting model calls in the relay write path.
  - If AI-derived trust scores become useful for rate limiting, they can update policy configuration or allow/deny lists asynchronously; the inline relay policy remains deterministic and low-latency.
