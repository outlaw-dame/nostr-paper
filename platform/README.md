# Nostr Paper Platform Workspace

This subtree is the transition scaffold for the backend platform that will sit beside the existing `nostr-paper` client.

## Why this lives inside the repo for now

The long-term clean shape is still:

- `nostr-paper` client app
- relay/search/control-plane platform as a sibling repo or standalone workspace

But this scaffold lives here first so the service boundaries, contracts, infra, and implementation slices can be built without blocking on repository provisioning.

## Hard boundaries

- The existing root app remains the client-facing Nostr Paper PWA.
- `platform/` is server-side infrastructure and services only.
- Nothing in `platform/` should leak client build assumptions into relay/search code.
- Nothing in the root app should start depending on `platform/` internals directly.

## Planned first slice

1. Strfry deployment and configuration
2. Redis Streams backbone
3. PostgreSQL search and control-plane schema
4. Ingestion bridge
5. Lexical indexing worker
6. NIP-50 search relay

## Directory map

- `docs/` — architecture and operational documentation
- `infra/` — local/dev deployment manifests and service configuration
- `services/` — deployable services
- `packages/` — shared runtime libraries used by services

## Relay Rate Limiting

`services/relay-policy/` is a strfry write-policy plugin. It applies lightweight intelligent rate limiting before events are stored: pubkey/source/global token buckets, weighted event cost, duplicate-body rejection, hellthread fanout limits, and temporary penalty multipliers. Local compose builds a custom strfry image that includes this plugin and enables it through `infra/strfry.conf/strfry.conf`.

Useful knobs:

- `RELAY_POLICY_MODE=observe|enforce`
- `RELAY_POLICY_VERSION=relay-policy-v1`
- `RELAY_POLICY_PUBKEY_POINTS_PER_MINUTE`
- `RELAY_POLICY_SOURCE_POINTS_PER_MINUTE`
- `RELAY_POLICY_GLOBAL_POINTS_PER_SECOND`
- `RELAY_POLICY_HELLTHREAD_TAG_LIMIT`
- `RELAY_POLICY_ALLOWLIST_PUBKEYS`
- `RELAY_POLICY_ALLOWLIST_SOURCES`

## Blossom Media Edge

`services/blossom-edge/` is a Cloudflare Worker Blossom server. It stores blobs by SHA-256 in Cloudflare R2 for low-latency media retrieval and can archive the same bytes to a Filebase IPFS bucket. The app publishes BUD-03 `kind:10063` server lists so clients and relays can discover the preferred media edge.

## Tagr Moderation Source (Relay Stack)

The platform relay stack can ingest Nos Social Tagr moderation events directly:

- `TAGR_RELAY_URL` (default: `wss://relay.nos.social`)
- `TAGR_BOT_PUBKEY` (default: canonical Tagr bot pubkey)

The ingestion bridge filters to Tagr moderation kinds (`1984`, `1985`) for the trusted pubkey and forwards them into the Redis pipeline. The lexical worker persists moderation outcomes and marks affected search rows as blocked.

Keyword-policy blocks are also persisted durably in `keyword_blocks`, using the shared moderation taxonomy from `@nostr-paper/content-policy`. To re-run the current policy against already indexed events and repair `moderation_state`, run `npm run reconcile:moderation` from `platform/services/workers/lexical-index`.

The search API now exposes moderation operations endpoints for dashboards and runbooks:

- `GET /ops/moderation/stats`
- `GET /ops/moderation/blocked?source=all|tagr|keyword&limit=...`
- `POST /ops/moderation/reconcile`

Set `MODERATION_OPS_TOKEN` to require `Authorization: Bearer <token>` on `/ops/moderation/*` routes.

Relay policy regressions are covered by a replay corpus at `services/relay-policy/src/abuseReplay.corpus.json` and can be run with `npm run test:replay --prefix platform/services/relay-policy`.

Operational docs:

- `docs/INCIDENT_PLAYBOOKS.md`
- `docs/NOSTR_MODERATION_BENCHMARKS.md`

## Transition note

Once the backend platform hardens, this subtree can be split into its own repository with minimal churn because service/package seams are defined here first.
