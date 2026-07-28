# Relay, Search, and Media Services

Nostr Paper currently has three distinct architectural concerns:

1. the client PWA in this repository;
2. the relay/search architecture under `platform/`;
3. the independently deployable Blossom media edge under `platform/services/blossom-edge/`.

The relay/search architecture is being prepared for extraction into its own dedicated repository while remaining linked to the app through documented Nostr protocols, validated endpoint configuration, and contract tests.

The separate `outlaw-dame/nostr-paper-platform` repository is unrelated to this migration and is not the destination for these services.

## Relay/search scope

The extraction scope includes:

- Strfry relay and relay policy
- Redis Streams ingestion pipeline
- PostgreSQL and pgvector search projections
- ingestion bridge
- lexical and embedding workers
- NIP-50/hybrid search relay
- moderation ingestion and reconciliation
- relay/search operations, metrics, migrations, and runbooks

## Media scope

`platform/services/blossom-edge/` is a separate Cloudflare Worker deployment with R2 storage, Nostr-authenticated Blossom endpoints, and optional Filebase/IPFS archival. It is excluded from the relay extraction until its destination is chosen explicitly.

## Client linkage

The PWA remains linked to the extracted services through:

- ordinary Nostr WebSocket relay messages;
- NIP-50 search filters and documented pagination behavior;
- standard event kinds and tags;
- HTTPS Blossom APIs with signed Nostr authorization events;
- validated relay, search-relay, and media endpoint configuration;
- graceful fallback when dedicated services are unavailable.

See [architecture/relay-separation.md](architecture/relay-separation.md) for ownership rules, migration invariants, and validation requirements.
