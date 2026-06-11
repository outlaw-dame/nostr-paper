# Roadmap Implementation Status

This document is the current source of truth for comparing the documented phase roadmap to the actual repository implementation.

Last audited: 2026-06-11 against `main`.

## Status Legend

- **Delivered** — code exists and matches the core acceptance criteria.
- **Mostly delivered** — code exists and appears functional, but final acceptance verification or consistency hardening remains.
- **Partial** — meaningful implementation exists, but major requirements remain open.
- **Not found** — no concrete implementation was found in the repo audit.
- **Not documented** — repo has no formal phase document for that scope yet.

## Phase Summary

| Phase | Document | Current status | Notes |
|---|---|---|---|
| Phase 1 — Foundation | `docs/PHASE_1.md` | Delivered | Local-first DB, validation, NDK, PWA, security, and UI foundation are present. |
| Phase 2 — Compose and Publishing | `docs/PHASE_2.md` | Mostly delivered | Implementation has moved past the old roadmap status. Needs acceptance/QA pass. |
| Phase 3 — Social Layer | `docs/PHASE_3.md` | Mostly delivered | Threads, replies, reactions, reposts, zaps, DMs, and platform metrics exist. DM envelope work remains. |
| Phase 4 — Profile Layer | `docs/PHASE_4.md` | Delivered | NIP-05, follow graph, relay list, and profile metadata hardening are present. |
| Phase 5 — Hardening and Completion | `docs/PHASE_5.md` | Planned | Created to close real gaps discovered during the roadmap/repo comparison. |
| Phase 6+ | Not found | Not documented | No formal phase docs were found for later phases during this audit. |

## Phase 1 — Foundation

**Status:** Delivered.

Evidence in the repo:

- Vite/React/TypeScript/PWA foundation.
- SQLite/OPFS local-first data path with event/tag/profile/contact/relay/deletion storage.
- NIP-01 filter querying and FTS path.
- `insertEvent()` validation and atomic kind-specific side effects.
- NDK initialization with local cache adapter and NIP-65/outbox support.
- NIP-07 signer auto-detection and private-key exclusion from app state.
- Core sanitizer/validation helpers and CSP/service-worker hardening.

Remaining work should not be tracked as Phase 1 unless it is a regression or direct foundation bug.

## Phase 2 — Compose and Publishing

**Status:** Mostly delivered.

Delivered implementation areas:

- Main `ComposeSheet` is mounted globally and opened through route/query state.
- Notes, quotes, replies, comments, threads, and stories are handled from the compose sheet.
- `usePublishEvent()` provides a central publish state wrapper for the main sheet.
- Event-kind-specific publishing modules exist for notes, threads/comments, long-form articles, videos, polls, and lists.
- NIP-07 and NIP-46 signer support exists through `src/lib/nostr/ndk.ts`.
- Blossom/NIP-96 upload support exists through `src/hooks/useBlossom.ts` and Blossom components/libs.
- Structured compose pages exist for articles, video/audio, polls, lists, and DVMs.
- Local draft storage/recovery exists for the primary compose sheet.

Open verification/hardening:

- Final browser QA for compose → sign → publish with both NIP-07 and NIP-46.
- Dedicated test coverage for media upload auth/fallback behavior.
- Unified draft behavior across every structured compose page.
- Consistent publish telemetry and retry semantics across all publishers.
- Documentation cleanup for implementation-path drift from the original planned file names.

## Phase 3 — Social Layer

**Status:** Mostly delivered.

Delivered implementation areas:

- Thread parsing and hydration for NIP-10 replies, NIP-22 comments, kind-11 thread roots, and addressable roots.
- Relay/platform thread hydration and iterative reply frontier fetching.
- Reactions, reposts, and quote-post parsing/publishing.
- Zap request, invoice, receipt parsing, validation, and aggregation.
- Direct message inbox/thread/compose routes for kind-4 encrypted DMs.
- DM encryption capability detection with NIP-44 preference and NIP-04 fallback.
- Platform lexical worker supports social kinds 6, 7, and 9735.
- Platform social metrics table tracks reaction/like/dislike/repost/zap counts separately from searchable text.

Open verification/hardening:

- Full modern NIP-44 envelope / gift-wrap DM support is not complete; the type name explicitly marks that path as planned.
- Live-relay acceptance tests are still needed for reactions, reposts, zaps, and DMs.
- Social metric idempotency should be tested against duplicate ingestion and relay replay.
- Zap receipt trust validation needs production configuration guidance for expected LNURL server pubkeys.

## Phase 4 — Profile Layer

**Status:** Delivered.

Delivered implementation areas:

- NIP-05 verification state machine with idle/verifying/verified/stale/invalid/lookup_error states.
- Follow/unfollow flows with optimistic UI and publish guards.
- Contact-list sync with relay source-of-truth and local fallback.
- Relay-list sync/import/publish with deterministic diff/no-op behavior.
- Profile metadata editor with field-level validation, Blossom uploads, canonical metadata publishing, and conflict detection.

Remaining work should be treated as polish or regression unless it changes the Phase 4 scope.

## Phase 5 — Hardening and Completion

**Status:** Planned.

Phase 5 should close the real implementation gaps revealed by this audit rather than adding a large new product surface. The phase is documented in `docs/PHASE_5.md` and should be executed before inventing Phase 6+ feature work.

Priority areas:

1. Complete the social/DM privacy gap.
2. Harden media upload, link preview, and dev proxy safety.
3. Add end-to-end acceptance coverage for publishing and social actions.
4. Normalize publish-state, retry, and telemetry behavior across compose surfaces.
5. Keep roadmap docs synchronized with implementation reality.

## Repo Hygiene Rules Going Forward

- Every new phase must include a status section with Delivered / Partial / Not Implemented items.
- Roadmap docs must name actual implemented file paths, not aspirational file paths.
- If code intentionally diverges from a planned file name, document the replacement implementation path.
- Do not mark a phase as delivered unless the acceptance checklist is either tested or explicitly noted as manually verified.
- Keep future scope Nostr-focused unless the project explicitly expands protocol scope later.
