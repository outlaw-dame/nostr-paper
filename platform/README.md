# Nostr Paper Relay/Search Workspace

This directory contains the server-side relay and search architecture that supports the Nostr Paper client. It is being prepared for extraction into a dedicated relay repository while preserving protocol-level integration with the PWA.

The separate `outlaw-dame/nostr-paper-platform` repository is unrelated to this workspace and is not the extraction target.

## Hard boundaries

- The root application remains the client-facing Nostr Paper PWA.
- Relay/search services must not depend on client build internals.
- The PWA must not import relay-service internals.
- Integration must use Nostr protocols, documented APIs, validated endpoint configuration, and contract tests.
- The PWA must continue to operate against ordinary Nostr relays when the dedicated relay/search service is unavailable.

## Relay/search extraction scope

- `infra/` — Strfry, Redis, PostgreSQL/pgvector, compose, migrations, and deployment configuration
- `packages/` — server-side shared packages, after confirming no PWA imports
- `services/ingestion-bridge/` — relay and moderation-event ingestion
- `services/relay-policy/` — Strfry write policy, rate limiting, and abuse controls
- `services/search-api/` — NIP-50/hybrid search relay and operations endpoints
- `services/workers/` — lexical indexing, embeddings, reconciliation, and projections
- relay-specific operational documentation and runbooks

## Media boundary

`services/blossom-edge/` is not part of the relay extraction by default. It is a standalone Cloudflare Worker with its own deployment lifecycle, R2 storage, Nostr-authenticated Blossom API, upload policy, and optional Filebase/IPFS archival.

It may remain temporarily in this repository or move to a dedicated media repository, but it must not be silently bundled into the relay repository.

## Relay stack

The relay/search deployment currently includes:

1. Strfry relay and write policy
2. Redis Streams backbone
3. PostgreSQL and pgvector search/control-plane schema
4. ingestion bridge
5. lexical indexing worker
6. embedding worker
7. NIP-50/hybrid search relay
8. moderation ingestion, reconciliation, metrics, and operations endpoints

## Local exposure defaults

`infra/docker-compose.yml` publishes Redis, Postgres, Strfry, and the search API on `127.0.0.1` by default. Set `PLATFORM_BIND_HOST` only when intentionally exposing the stack to another device, tunnel, or isolated test network.

## Relay rate limiting

`services/relay-policy/` is a Strfry write-policy plugin. It applies pubkey/source/global token buckets, weighted event cost, duplicate-body rejection, hellthread fanout limits, allowlists, and temporary penalty multipliers before events are stored.

## Moderation

The relay stack can ingest trusted Tagr moderation events, persist moderation outcomes, apply shared keyword policy, reconcile already indexed events, and expose authenticated moderation operations endpoints.

## Extraction rule

Do not delete this directory from `nostr-paper` until:

- the new relay repository exists;
- Git history has been preserved with `git filter-repo` or `git subtree split`;
- relay CI, migrations, tests, and deployment are operational there;
- the PWA has no source imports from the extracted implementation;
- remote-search contract tests pass;
- the PWA builds and runs with the dedicated relay and media services unavailable.

See `../docs/architecture/relay-separation.md` for the migration contract and validation requirements.
