# Phase 4 Acceptance Checklist

Phase 4 covers the profile layer: NIP-05 identity verification, follow graph reliability,
relay list (NIP-65) management, and profile metadata quality.

---

## PR A — NIP-05 Core and UI

### Delivered

- `Profile.nip05LastCheckedAt` field added to the type and populated from the DB row mapper.
- `useNip05Verification` hook (`src/hooks/useNip05Verification.ts`) with a six-state machine:
  - `idle` — no NIP-05 set, or never checked.
  - `verifying` — active network lookup in flight.
  - `verified` — lookup passed within the success TTL (12 h).
  - `stale` — verified but within the 1-hour stale buffer before expiry.
  - `invalid` — lookup returned a pubkey mismatch or 404.
  - `lookup_error` — network/server error; retryable.
- `deriveNip05UiState()` exported as a pure function so it can be unit tested without React.
- Inflight guard: a second `verify()` call while `verifying` is a no-op.
- `AbortController` on the in-flight request; cleaned up on unmount.
- `ProfilePage.tsx` badge area replaces the static verified checkmark with:
  - Green pill for `verified`.
  - Orange tappable pill for `stale` (refresh on tap).
  - Red tappable pill for `invalid` / `lookup_error` with actionable label.
  - Spinner pill for `verifying`.

### Acceptance tests

- `src/hooks/useNip05Verification.test.tsx` — 13 tests covering pure state derivation and
  the full idle → verifying → verified / invalid / lookup_error transition paths.

### Acceptance criteria

- [x] Manual verify works and updates state instantly.
- [x] Stale verification surfaces a tap-to-refresh badge.
- [x] Invalid domains/pubkeys are surfaced with actionable error text.
- [x] No duplicate inflight requests for the same pubkey.

---

## PR B — Follow Graph Consistency and Sync

### Delivered

- `handleSave` and `handleUnfollow` in `ProfilePage.tsx` now use `followInflightRef` to
  prevent concurrent follow/unfollow calls (rapid-tap guard).
- Optimistic UI: contact list updated immediately before the relay publish; rolled back to
  the previous state on any publish failure.
- Source-of-truth precedence for follows (`syncContactListFromRelays` → local cache fallback)
  was already correct; no changes to `contacts.ts` merge logic.

### Acceptance tests

- `src/lib/nostr/contacts.sync.test.ts` — 9 tests covering:
  - Follow publish and list update.
  - Self-follow rejection.
  - No duplicate entries on re-follow.
  - Invalid pubkey rejection without network call.
  - Unfollow with list update.
  - Idempotent unfollow (pubkey not present).
  - NDK-unavailable cache fallback.
  - No relay events → local cache returned.
  - Non-hex pubkey rejected before NDK call.

### Acceptance criteria

- [x] No duplicate follow edges.
- [x] Rapid follow/unfollow toggle is guarded — only one publish in flight at a time.
- [x] Failed publish rolls back the optimistic UI state.
- [x] Self-follow is rejected before any publish attempt.

---

## PR C — Relay List Management (NIP-65)

### Delivered

- `relayListsAreEqual(a, b)` helper added to `relayList.ts` — canonical, order-independent
  comparison of `RelayPreference[]` entries (URL + read/write flags).
- `publishCurrentUserRelayList` now skips publishing when explicit preferences are provided
  and are identical to the currently stored list. No-op saves produce no relay traffic.
- Unconditional (no-option) calls always publish — preserving the deliberate republish intent.

### Acceptance tests

- `src/lib/nostr/relayList.diff.test.ts` — 8 tests covering:
  - Equality comparison (order-independent, flag-sensitive, empty lists).
  - Diff guard skips publish on identical explicit preferences.
  - Diff guard allows publish when preferences differ.
  - Unconditional call always publishes.
  - Empty relay list throws before sign.

### Acceptance criteria

- [x] Relay list publish succeeds with deterministic tags.
- [x] Re-opening settings and saving without changes does not republish.
- [x] Invalid relay entries are blocked by `isValidRelayURL` before publish.

---

## PR D — Profile Validation and Conflict Resolution

### Delivered

- `ProfileMetadataEditor.tsx` rewritten to use `publishProfileMetadata()` from `metadata.ts`,
  eliminating the raw `NDKEvent` path that bypassed validation and NIP-39 identity tags.
- Field-level error display: per-field `FieldErrors` state with `validateFields()` pure
  function; save is blocked until all fields are clean.
- Inflight guard (`saveInflightRef`) prevents concurrent saves.
- Conflict guard: reads the persisted `profile.updatedAt` from DB before signing; refuses
  to overwrite a profile event that is newer than the loaded snapshot, with a user-visible
  message directing them to reload.
- Profile sync init: editor fields are only overwritten from the incoming profile prop
  if the field is still empty (no user edits lost on re-render).

### Acceptance tests

- `src/lib/nostr/metadata.test.ts` extended with 4 new publish tests:
  - Successful publish signs, publishes, inserts, and dispatches `nostr-paper:profile-updated`.
  - No-signer throws before publish.
  - Pre-aborted signal throws `AbortError` before signing.
  - Publish failure prevents `insertEvent` from being called.

### Acceptance criteria

- [x] Invalid profile payloads are blocked before publish (field-level errors shown).
- [x] Concurrent saves from the same editor are guarded (inflight ref).
- [x] Conflict detection refuses to overwrite a newer remote event.
- [x] `publishProfileMetadata()` canonical path is the single publish entry point.

---

## PR E — Testing and Observability

### Test coverage summary (Phase 4 additions)

| File | Tests |
|---|---|
| `useNip05Verification.test.tsx` | 13 |
| `contacts.sync.test.ts` | 9 |
| `relayList.diff.test.ts` | 8 |
| `metadata.test.ts` (extended) | 4 new, 7 existing |

**Full suite:** 739 tests across 113 files — 0 regressions.

### Observability

- `socialTelemetry.ts` (Phase 3) already counts reaction/repost/zap publish failures.
- NIP-05 verification failures are classifiable through the `Nip05UiState` enum exposed by
  the hook; product analytics can instrument `lookup_error` and `invalid` transitions.
- Follow publish failures surface immediately via the rollback path and the `error` state
  visible in the ProfilePage follow control section.
- Relay list no-op skips are silent (return `null`) — callers can log or surface this if needed.

---

## Definition of Done

- [x] User can verify NIP-05 identity with reliable state transitions and manual retry.
- [x] Stale verification surfaces a tap-to-refresh badge within 11 hours of the last check.
- [x] Follow state remains correct across reconnects (local cache fallback) and race conditions (inflight guard + optimistic rollback).
- [x] Relay list management is deterministic and does not republish on no-op saves.
- [x] Profile metadata writes use the canonical validation path with field-level error feedback.
- [x] Concurrent edit conflicts (newer remote event) are detected before signing.
- [x] Phase 4 test suite is green and integrated into the existing CI run (`npm test`).
