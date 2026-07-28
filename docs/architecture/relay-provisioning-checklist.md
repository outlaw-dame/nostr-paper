# Relay repository provisioning checklist

This checklist is the external prerequisite for executing the history-preserving relay extraction documented in `relay-extraction-runbook.md`.

## Repository requirements

Create a new, empty repository dedicated to the Nostr Paper relay/search deployment.

The unrelated `outlaw-dame/nostr-paper-platform` repository must not be used.

Recommended characteristics:

- no generated README, license, or `.gitignore` during creation;
- default branch established only after the filtered history is pushed;
- branch protection enabled after CI is installed;
- secret scanning and dependency alerts enabled;
- deployment credentials stored as repository or environment secrets, never committed;
- production and staging environments separated;
- maintainers limited to operators who need relay deployment access.

## Before extraction

- Choose and record the final repository name and URL.
- Confirm the repository is empty.
- Confirm the operator performing extraction can push all filtered refs.
- Install `git-filter-repo` locally.
- Create a full backup clone of `outlaw-dame/nostr-paper`.
- Record the source commit SHA used for extraction.

## Extraction scope

Include:

- `platform/infra/`
- `platform/packages/`
- `platform/services/ingestion-bridge/`
- `platform/services/relay-policy/`
- `platform/services/search-api/`
- `platform/services/workers/`
- relay/search operational documentation under `platform/docs/`

Exclude:

- `platform/services/blossom-edge/`
- PWA source and local-first storage code;
- client relay/search/media adapters;
- user-facing UI and PWA deployment files.

## After extraction

Do not delete the source subtree from `nostr-paper` yet.

First establish:

- dependency installation and lockfile verification;
- lint, type-check, unit, integration, replay, and migration checks;
- container builds;
- staging relay deployment;
- health and readiness checks;
- NIP-50 contract smoke tests from the PWA;
- moderation ingestion and reconciliation validation;
- Redis consumer-group recovery validation;
- rollback instructions and a tested rollback deployment.

Only after those gates pass should a separate PR remove the extracted relay/search subtree from `nostr-paper`.
