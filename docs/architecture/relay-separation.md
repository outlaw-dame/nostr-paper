# Relay separation architecture

## Scope

Nostr Paper is being separated into independently deployable components without severing their protocol-level integration:

1. the Nostr Paper PWA remains in this repository;
2. the relay/search architecture currently under `platform/` moves to a dedicated relay repository;
3. the Blossom media edge is treated as an independent deployment boundary and is not bundled into the relay extraction by default.

The unrelated `outlaw-dame/nostr-paper-platform` repository is outside this migration.

## Component ownership

### Remains in `nostr-paper`

- React/TypeScript/Vite PWA
- service worker and offline behavior
- local SQLite/OPFS storage and local search
- NDK and `nostr-tools` client integration
- signer, publishing, feeds, profiles, threads, and UI moderation
- NIP-50 request construction and remote-result normalization
- relay endpoint configuration and graceful fallback behavior
- Blossom client, upload UI, server discovery, and BUD-03 publication
- client-facing contract tests

### Moves to the relay repository

- `platform/infra/`
- `platform/packages/`, after confirming no package is imported by the PWA
- `platform/services/ingestion-bridge/`
- `platform/services/relay-policy/`
- `platform/services/search-api/`
- `platform/services/workers/`
- relay-specific operational documentation and database migrations

This unit contains Strfry, Redis Streams, PostgreSQL/pgvector, ingestion, indexing, moderation projections, hybrid/NIP-50 search, relay policy, and operations endpoints.

### Media boundary

`platform/services/blossom-edge/` is a standalone Cloudflare Worker with its own deployment lifecycle, R2 storage, Nostr-authenticated Blossom API, upload policy, and optional Filebase/IPFS archive. It is excluded from the relay extraction until its destination is chosen explicitly.

## Supported external contracts

### PWA to relay/search

The application connects through documented Nostr interfaces rather than source imports:

- WebSocket relay messages (`REQ`, `EVENT`, `EOSE`, `CLOSE`, and `NOTICE`)
- NIP-50 search filters
- standard event kinds and tags
- documented pagination and error behavior

The PWA must remain usable against ordinary Nostr relays when the dedicated relay/search service is unavailable.

### PWA to media

The application connects to the media edge over HTTPS using Blossom endpoints and signed Nostr authorization events. The media service is independently replaceable and must not become a startup dependency for the PWA.

## Migration invariants

1. No PWA source file may import relay-service internals.
2. Relay and media endpoints are validated configuration, not hard-coded topology.
3. Local search remains an offline/client capability; remote search remains a broader relay-backed capability.
4. Dedicated-service outages must degrade gracefully.
5. Shared code is limited to stable wire contracts; large cross-repository internal packages are prohibited.
6. Each extracted component owns its build, tests, migrations, deployment, security configuration, and operations documentation.
7. The extraction must preserve Git history using `git filter-repo` or `git subtree split`; copying files without history is not acceptable.

## Extraction order

1. Inventory PWA imports and CI references to `platform/`.
2. Publish and test the relay/search wire contract.
3. Remove Blossom from any relay dependency assumptions and document it as an independent deployment.
4. Split relay files into the new relay repository with history.
5. Replace in-repository coupling with configured endpoints and contract tests.
6. Verify the PWA builds and starts with the relay and media services absent.
7. Verify remote search, publishing, relay moderation, migrations, and media upload independently.
8. Remove the extracted relay implementation from this repository only after the new repository and integration tests are operational.

## Required validation

- PWA type-check, tests, and production build without relay source present
- offline/local behavior with dedicated services unavailable
- remote NIP-50 search against the extracted relay
- normal publishing and reading through non-Nostr-Paper relays
- Blossom upload and retrieval against the independent media edge
- relay unit, integration, migration, replay, and failure-recovery tests
- versioned contract tests between PWA and relay
