# Phase 5 — Hardening and Completion

## Status

**Current status:** Planned.

Phase 5 is not a large new feature phase. It is a closure phase designed to harden the features already present in Phases 1–4, resolve the remaining implementation gaps discovered during the roadmap audit, and make the project safer to build on.

## Goals

1. Complete high-risk privacy and social gaps before expanding product scope.
2. Make publishing, media upload, and social actions consistently resilient.
3. Add acceptance-level tests around user-visible flows.
4. Reduce roadmap drift by making docs reflect actual code paths.
5. Preserve the Nostr-focused architecture and avoid protocol scope creep.

## Non-Goals

- No ActivityPub or ATProto implementation in this phase.
- No large redesign of the app shell.
- No new monetization, ranking, or recommendation system.
- No cloud draft sync unless explicitly promoted into a later phase.
- No scheduled posts unless all Phase 5 hardening criteria are already complete.

## Workstream A — DM Privacy and Social Completion

### A1. Complete NIP-44 envelope / gift-wrap planning and implementation decision

**Current state:**

- Kind-4 DMs exist.
- NIP-44 encryption is preferred when signer support exists.
- NIP-04 fallback exists.
- `nip44-envelope-planned` is still explicitly marked as planned, not delivered.

**Required work:**

- Decide whether Phase 5 implements full NIP-17/NIP-44 private DM envelopes or records it as Phase 6 scope.
- If implemented here, add seal/chat-message/gift-wrap construction and parsing.
- Add relay selection for sender/recipient DM relays.
- Preserve kind-4 compatibility without downgrading privacy where signer support exists.
- Add migration-safe UI labels so users know which DM privacy mode was used.

**Acceptance criteria:**

- [ ] A signer with NIP-44 support can send a modern private DM envelope if this scope is accepted.
- [ ] Kind-4 fallback remains available where envelope support is unavailable.
- [ ] A signer without NIP-44/NIP-04 cannot submit a DM and receives clear guidance.
- [ ] Incoming and outgoing messages render in a single conversation model without duplicate rows.
- [ ] Tests cover encryption capability selection, relay preference merge, parse/decrypt paths, and unsupported signer errors.

### A2. Social metrics idempotency

**Current state:**

- Platform worker supports kinds 6, 7, and 9735.
- Social metrics are stored separately from search text.

**Required work:**

- Ensure duplicate ingestion does not double-count reaction/repost/zap metrics.
- Add a durable dedupe key for social metric contribution if current `events_raw` insert semantics are insufficient.
- Add tests for replayed relay events and duplicate worker processing.

**Acceptance criteria:**

- [ ] Re-ingesting the same reaction does not increment metrics twice.
- [ ] Re-ingesting the same repost does not increment metrics twice.
- [ ] Re-ingesting the same zap receipt does not increment count or msats twice.
- [ ] Metrics remain correct after worker restart/replay.

## Workstream B — Publishing Reliability and UX Consistency

### B1. Unify publish error taxonomy

**Current state:**

- The main compose sheet uses `usePublishEvent()`.
- Structured compose pages use local publishing state and per-page error handling.

**Required work:**

- Define a shared publish error classifier.
- Normalize signer, relay, network, validation, abort, and duplicate-submit errors.
- Apply the classifier to note, article, video, poll, list, reaction, repost, zap, follow, relay-list, profile, and DM publish flows where relevant.

**Acceptance criteria:**

- [ ] All publish surfaces show user-safe, actionable errors.
- [ ] Abort/cancel is not shown as a scary failure.
- [ ] Signer denial is clearly separated from relay/network failure.
- [ ] Validation failure does not trigger relay publish attempts.

### B2. End-to-end publish acceptance tests

**Required work:**

- Add browser/component integration tests for the real compose flow.
- Mock signer and relay publishing boundaries without weakening code paths.
- Verify local cache insert and navigation after publish.

**Acceptance criteria:**

- [ ] Text note compose → sign → publish → insert → navigate succeeds.
- [ ] Reply compose builds correct NIP-10 tags for kind-1 targets.
- [ ] Comment compose builds correct NIP-22 tags for non-kind-1 targets.
- [ ] Quote compose preserves q tags and trailing NIP-21 reference.
- [ ] Duplicate publish clicks do not produce duplicate events.
- [ ] Permission denied keeps the draft intact.

### B3. Per-kind publish retry audit

**Required work:**

- Audit every publish path for consistent retry semantics.
- Do not retry validation or signer-denied errors.
- Retry transient relay/network errors with bounded backoff.
- Ensure every path supports `AbortSignal` when launched from a cancellable UI.

**Acceptance criteria:**

- [ ] Retry behavior is documented per publisher.
- [ ] Relay/network retry is bounded and cancellable.
- [ ] Validation and signer errors are not retried.
- [ ] No publish path can leave stale UI state after unmount.

## Workstream C — Media Upload and Link Preview Hardening

### C1. Blossom/NIP-96 upload hardening

**Current state:**

- Blossom upload exists with hash, signed auth, server diagnostics, NIP-96 fallback, metadata publishing, and local caching.

**Required work:**

- Add tests for Blossom auth generation and NIP-96 fallback.
- Add size/type guardrails before hashing large unsupported files.
- Surface server quota/rate-limit responses clearly.
- Ensure failed kind-1063 metadata publish produces warning, not lost upload state.

**Acceptance criteria:**

- [ ] Unsupported file types fail before upload.
- [ ] Oversized files fail before expensive work where possible.
- [ ] NIP-96 fallback is tested.
- [ ] Upload diagnostics are deterministic and useful.
- [ ] Metadata publish failure leaves the uploaded blob usable with a warning.

### C2. Link preview and dev proxy safety

**Required work:**

- Audit link preview fetch/proxy code for SSRF protections.
- Block localhost, private IP ranges, link-local, multicast, and internal hostnames.
- Enforce HTTPS where user-facing previews require it.
- Add timeout, response-size, content-type, redirect, and decompression limits.
- Add tests for malicious redirect chains and private network targets.

**Acceptance criteria:**

- [ ] Link preview cannot fetch private/internal network resources.
- [ ] Redirects are revalidated at every hop.
- [ ] Response body and header sizes are capped.
- [ ] Unsupported content types do not render active content.
- [ ] Failed previews degrade to safe plain links.

## Workstream D — Documentation and Roadmap Discipline

### D1. Keep phase docs status-aligned

**Required work:**

- Treat `docs/ROADMAP_STATUS.md` as the status ledger.
- Update phase docs when implementation diverges from planned file names.
- Add explicit Delivered / Partial / Not Implemented sections to future phase docs.

**Acceptance criteria:**

- [ ] Phase 2 no longer claims it is ready to begin.
- [ ] Roadmap status lists Phases 1–5 with accurate implementation status.
- [ ] New implementation work updates the relevant status doc in the same PR.

### D2. Add implementation-index references

**Required work:**

- Add short implementation maps for compose, social, profile, media, and platform workers.
- Avoid duplicating code explanations across docs.
- Link to canonical files and tests from the roadmap status doc.

**Acceptance criteria:**

- [ ] A new contributor can find each major implementation path from docs.
- [ ] Deprecated planned file names are either removed or marked as intentionally superseded.
- [ ] Scope boundaries remain Nostr-focused.

## Workstream E — CI and Acceptance Gates

### E1. Define phase completion gate

**Required work:**

- Define the exact commands/workflows required before marking Phase 5 complete.
- Include unit tests, type-check, lint, build, dependency audit, and platform worker checks where applicable.

**Acceptance criteria:**

- [ ] TypeScript passes.
- [ ] ESLint passes.
- [ ] Unit tests pass.
- [ ] Production build passes.
- [ ] Dependency audit passes or has documented exceptions.
- [ ] Platform worker tests/checks pass where present.

### E2. Manual QA checklist

**Required work:**

Create and complete a manual QA checklist for:

- NIP-07 login and publish.
- NIP-46 bunker login and publish.
- Note compose.
- Reply/comment compose.
- Quote compose.
- Image upload and alt text.
- Video/audio publish.
- Poll publish.
- List publish.
- Like/repost/zap.
- DM send/read/decrypt.
- Profile edit.
- Follow/unfollow.
- Relay-list save/no-op save.

**Acceptance criteria:**

- [ ] Manual QA result is recorded in docs or release notes.
- [ ] Known failures are converted into issues or Phase 5 follow-up checklist items.

## Recommended Execution Order

1. Documentation correction and status ledger.
2. Publish error taxonomy and retry audit.
3. Compose acceptance tests.
4. Blossom/link-preview hardening.
5. Social metrics idempotency tests.
6. DM envelope decision and implementation or explicit deferral.
7. Full CI and manual QA gate.
8. Mark Phase 5 complete only after the checklist is evidence-backed.

## Definition of Done

Phase 5 is complete only when:

- [ ] `docs/ROADMAP_STATUS.md` matches the current implementation.
- [ ] Phase 2 is formally marked delivered or its remaining acceptance gaps are tracked.
- [ ] Publish/social/media/profile hardening work has tests or documented manual verification.
- [ ] DM privacy gap is either implemented or explicitly deferred with a clear Phase 6 plan.
- [ ] CI is green on the final branch/PR.
- [ ] No phase doc claims completion without either tests or manual verification evidence.
