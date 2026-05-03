# Relay Moderation Incident Playbooks

This document defines first-response procedures for high-risk moderation incidents.

## Operational Inputs

- `RELAY_POLICY_MODE`: `enforce` or `observe`.
- `RELAY_POLICY_VERSION`: active relay-policy version string.
- `TAGR_POLICY_VERSION`: active Tagr policy version string.
- `MODERATION_OPS_TOKEN`: optional bearer token for ops endpoints.
- Ops endpoints (from search-api):
  - `GET /ops/moderation/stats`
  - `GET /ops/moderation/blocked`
  - `POST /ops/moderation/reconcile`

## Scenario 1: Mass-Spam Wave

### Signals

- Sudden rise in `blocked` counts and keyword/tagr reasons.
- Spikes in duplicate-body or fanout rejects.
- User reports of feed flooding.

### Immediate Containment

1. Set stricter policy knobs and increment `RELAY_POLICY_VERSION`.
2. Keep `RELAY_POLICY_MODE=enforce` unless false positives are confirmed.
3. Capture baseline using `GET /ops/moderation/stats`.
4. Verify newest blocked records with `GET /ops/moderation/blocked?source=all&limit=100`.

### Verification

1. Confirm blocked share rises while clean content still indexes.
2. Confirm no ingest backlog or DB write pressure regressions.
3. Run replay suite locally:
   - `npm run test:replay --prefix platform/services/relay-policy`

### Communication Template

- Incident: mass-spam wave affecting relay quality.
- Mitigation: tightened rate-limit/fanout policy and version bump.
- Status: active monitoring on blocked reasons and ingest health.

## Scenario 2: False-Positive Spike

### Signals

- Legitimate content rejected at atypical rates.
- `blocked` counts increase without abuse reports.
- Support reports include high-quality users/events being hidden.

### Immediate Containment

1. Move to safer posture by setting `RELAY_POLICY_MODE=observe`.
2. Increment `RELAY_POLICY_VERSION` and document rollback reason.
3. Export recent blocked sample:
   - `GET /ops/moderation/blocked?source=all&limit=200`
4. Identify dominant reason/policy version from `GET /ops/moderation/stats`.

### Recovery

1. Patch offending heuristic and replay against corpus.
2. Add a new replay fixture reproducing the false positive.
3. Re-enable `enforce` only after replay and package tests pass.

### Verification

1. Reconcile state after fixes:
   - `POST /ops/moderation/reconcile`
2. Confirm `allowed` state recovers for legitimate traffic.

## Scenario 3: Tagr Feed Outage or Drift

### Signals

- Tagr reason counts flatline while abuse reports continue.
- Stale `tagr_blocks` policy version versus expected `TAGR_POLICY_VERSION`.
- Missing or delayed remote moderation labels.

### Immediate Containment

1. Keep local keyword/rate-limit defenses active.
2. Bump and pin `TAGR_POLICY_VERSION` to freeze interpretation during outage.
3. Continue serving using existing `tagr_blocks` plus local policy rejects.

### Recovery

1. Restore Tagr ingestion path/connectivity.
2. Re-run moderation reconciliation:
   - `POST /ops/moderation/reconcile`
3. Validate fresh Tagr reasons appear in stats endpoint.

### Verification

1. Check tagr reason distribution and blocked deltas.
2. Confirm no large mismatch between expected and observed Tagr policy version.

## Post-Incident Checklist

1. Create timeline with `policy_version` transitions.
2. Add at least one replay corpus case for the incident signature.
3. Update this runbook when a mitigation pattern proves effective.
4. Link issue/PR IDs for forensic traceability.
