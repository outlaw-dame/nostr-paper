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

## Transition note

Once the backend platform hardens, this subtree can be split into its own repository with minimal churn because service/package seams are defined here first.
