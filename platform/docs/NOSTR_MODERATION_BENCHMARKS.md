# Nostr Relay Moderation Benchmarks

This document summarizes moderation-relevant patterns from widely used Nostr relay projects and maps them to actionable steps for this repository.

## Sources Reviewed

- strfry: plugin-based write-policy and router filtering, metrics endpoint, operational tooling.
- nostr-rs-relay: configurable limits (rate, size), production config posture.
- khatru: policy hooks and composable defaults for custom relay behavior.
- NIP-56: reporting (`kind:1984`) and warning against naive automatic moderation.
- NIP-32: labels (`kind:1985`, `L`/`l`) and namespace guidance.

## What Other Implementers Do

1. Separate policy enforcement from storage/search by using policy hooks or plugins.
2. Provide operational observability (metrics endpoints, explicit config knobs).
3. Keep moderation logic composable and versionable.
4. Avoid blind trust of open reports; use trusted sources and layered policies.
5. Use structured labels/reports (NIP-32/NIP-56) for interoperability.

## Adopt Now

1. Keep relay-policy as the first write gate, lexical-index as durability/reconciliation layer.
2. Continue explicit `policy_version` tagging in moderation reasons/messages.
3. Maintain replay corpus regression tests as a merge gate for policy changes.
4. Use ops endpoints for reason/state monitoring and reconcile operations.

## Adopt Next

1. Add Prometheus metrics for moderation counters and reject categories.
2. Add scoped trusted-moderator ingestion policy for NIP-56 reports.
3. Add namespace-aware NIP-32 label normalization checks in ingestion.
4. Add a periodic replay run against real anonymized samples.

## Avoid

1. Automatic hard blocks directly from untrusted public reports.
2. Policy changes without version bumps and replay validation.
3. Incident response without a documented rollback and reconcile path.

## Mapped Actions for This Repo

1. Relay policy replay suite added under `platform/services/relay-policy/src/abuseReplay.corpus.json`.
2. CI gate added in `.github/workflows/ci.yml` as `Relay Policy Replay`.
3. Ops HTTP surface added in `platform/services/search-api/src/main.ts` under `/ops/moderation/*`.
4. Incident runbook added in `platform/docs/INCIDENT_PLAYBOOKS.md`.
