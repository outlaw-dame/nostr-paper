# Phase 2 — Compose and Publishing

## Status

**Current status:** Mostly delivered; formal acceptance verification still needs a final test/QA pass.

This document has been reconciled against the current repository implementation. The original Phase 2 plan described the correct product direction, but its old status line said the phase was still ready to begin. That is no longer accurate: compose, signing, publishing, media upload, draft recovery, and multiple structured compose routes now exist in the app.

## Scope

Phase 2 adds user-authoring and publishing capabilities to Nostr Paper while preserving the project’s security model:

- Private keys must never enter the app.
- Signing must be delegated to NIP-07 browser extensions or NIP-46 remote signers.
- Outbound events must be sanitized, signed, published through the relay/outbox layer, and inserted into the local cache only after validation.
- Media uploads must use signed auth, safe HTTPS endpoints, local metadata caching, and Nostr file metadata where possible.
- Drafts must recover locally and clear after successful publish.

## Implementation Map

### 1. Compose Sheet UI — Delivered

**Primary files:**

- `src/components/compose/ComposeSheet.tsx`
- `src/lib/compose/index.ts`
- `src/lib/compose/drafts.ts`
- `src/hooks/usePublishEvent.ts`

**Implemented:**

- Global compose sheet mounted at the app shell.
- `/compose` routes into the sheet via query state.
- Note, quote, reply, thread, and story modes.
- Local draft recovery and debounced autosave.
- Clear draft after successful publish.
- Hashtag suggestions from local/trending context.
- Link preview cards in the composer.
- AI compose assist with fallback guidance.
- Moderation guidance based on active filters/mute preferences.
- Duplicate-reply warning context for replies.
- Media and GIF attachment state.
- User-supplied alt text for uploaded media.

**Still needs verification:**

- Browser-level unsaved-change warning across every navigation path.
- Manual coverage for mobile pull-down/dismiss behavior after publish failures.

### 2. Signer Integration — Delivered, with implementation-path drift

**Primary files:**

- `src/lib/nostr/ndk.ts`
- `src/pages/OnboardPage.tsx`
- `src/pages/OnboardPage.nip46.test.tsx`

**Implemented:**

- NIP-07 signer auto-detection through NDK.
- NIP-46 bunker token validation.
- NIP-46 signer creation with retry and timeout behavior.
- Session-only NIP-46 token restore.
- Legacy local persistent credential cleanup.
- Logout cleanup for both local/session signer state.
- Read-only pubkey login mode for non-signing sessions.

**Implementation note:**

The original roadmap proposed `src/lib/nostr/nip07.ts` and `src/hooks/useNip07Sign.ts`. The current implementation uses NDK’s signer abstractions directly from `src/lib/nostr/ndk.ts` instead of separate NIP-07 wrapper files. That is acceptable as long as signer errors remain user-visible and private keys never enter the app.

### 3. Publishing Pipeline — Mostly Delivered

**Primary files:**

- `src/hooks/usePublishEvent.ts`
- `src/lib/nostr/note.ts`
- `src/lib/nostr/thread.ts`
- `src/lib/nostr/longForm.ts`
- `src/lib/nostr/video.ts`
- `src/lib/nostr/polls.ts`
- `src/lib/nostr/lists.ts`
- `src/lib/nostr/outbox.ts`
- `src/lib/db/nostr.ts`

**Implemented:**

- Publish state machine with abort handling and stale-state protection.
- Note publishing for kind-1 short notes.
- Quote posts with NIP-21 references and q tags.
- NIP-10 replies for kind-1 note targets.
- NIP-22 kind-1111 comments for non-kind-1 targets.
- Thread roots and thread replies.
- Long-form article publish/draft flow.
- Poll publish flow.
- Video/audio publish flow with rich media metadata.
- NIP-51 list publishing.
- Relay publishing through the NIP-65/outbox layer.
- Local insert after signing/publish path.
- Abort checks around signing/publishing paths where implemented.

**Still needs verification:**

- End-to-end browser acceptance test for compose → sign → publish → local insert → route to published event.
- Consistent retry/backoff behavior audit across every event-kind publisher.
- Explicit idempotency tests for repeated publish clicks after delayed signer prompts.

**Implementation note:**

The original roadmap proposed one `src/lib/nostr/publish.ts`. The current codebase uses event-kind-specific publish modules. That is acceptable and likely cleaner, but `docs/ROADMAP_STATUS.md` should remain the source of truth so future work does not search for a nonexistent monolithic publish file.

### 4. Blossom / NIP-96 Media Upload — Delivered

**Primary files:**

- `src/hooks/useBlossom.ts`
- `src/components/blossom/BlossomUpload.tsx`
- `src/lib/blossom/auth.ts`
- `src/lib/blossom/client.ts`
- `src/lib/blossom/hash.ts`
- `src/lib/blossom/nip96.ts`
- `src/lib/nostr/fileMetadata.ts`
- `src/lib/db/blossom.ts`

**Implemented:**

- SHA-256 hashing via Web Crypto.
- Signed Blossom/BUD auth token creation.
- NIP-98 auth fallback for NIP-96 upload endpoints.
- Sequential upload attempts across configured media servers.
- Server diagnostics for upload success/failure.
- Local blob metadata caching.
- NIP-94/kind-1063 file metadata publishing attempt after upload.
- Media dimensions and fallback URL metadata.
- UI upload component with idle/hash/upload/publish/done/error states.

**Still needs verification:**

- Rate-limit behavior and server quota response handling across common Blossom servers.
- Manual upload tests for image, video, and audio from mobile Safari and desktop browsers.
- Clear user guidance when no Blossom servers are configured.

### 5. Compose Pages and Routes — Delivered

**Primary files:**

- `src/App.tsx`
- `src/pages/ArticleComposePage.tsx`
- `src/pages/VideoComposePage.tsx`
- `src/pages/PollComposePage.tsx`
- `src/pages/ListComposePage.tsx`
- `src/pages/DvmComposePage.tsx`

**Implemented routes:**

- `/compose` → note compose sheet.
- `/compose/article` → `/article/new`.
- `/compose/video` → `/video/new`.
- `/compose/poll` → `/poll/new`.
- `/compose/list` → `/list/new`.
- `/article/new` long-form article composer.
- `/video/new` video/audio composer.
- `/poll/new` poll composer.
- `/list/new` NIP-51 list composer.
- `/dvm/new` DVM compose page.

**Still needs verification:**

- Route-level accessibility labels and keyboard behavior.
- Consistent post-publish navigation across all compose surfaces.
- Consistent error taxonomy across every compose page.

### 6. Draft Management — Partially Delivered

**Primary files:**

- `src/lib/compose/drafts.ts`
- `src/components/compose/ComposeSheet.tsx`
- `src/pages/ArticleComposePage.tsx`

**Implemented:**

- Local note/reply/quote/thread draft storage for the sheet.
- Draft recovery on compose open.
- Draft clearing after successful note/thread/reply publish.
- Long-form article publish/draft event flow.

**Partial / not yet complete:**

- A global `ComposeContext` from the original roadmap does not exist.
- Draft autosave is not clearly unified across every structured compose page.
- Draft cloud sync remains out of scope for this phase.

### 7. Publishing State and UX Feedback — Mostly Delivered

**Primary files:**

- `src/hooks/usePublishEvent.ts`
- `src/components/compose/ComposeSheet.tsx`
- Per-kind compose pages under `src/pages/`

**Implemented:**

- Central publish state hook for the main compose sheet.
- Per-page publish/saving state for article, video, poll, and list pages.
- User-visible validation errors before publish.
- Abort handling in the central compose publish hook.

**Still needs verification:**

- Consistent toast/status feedback after publish failure and retry.
- Consistent abort/cancel semantics across every page-level composer.
- Centralized publish telemetry for compose failures.

## Test / Acceptance Matrix

### Unit and component tests

- [x] Compose provider / AI provider behavior exists in tests.
- [x] Reply publish path has component test coverage.
- [x] NIP-46 onboarding has test coverage.
- [x] Publish state hook is implemented with abort cleanup.
- [ ] Dedicated unsigned-event validation tests across every event-kind publisher.
- [ ] Dedicated media upload auth/transport tests for Blossom + NIP-96 fallback.
- [ ] Dedicated draft serialization/deserialization tests for every draft context.
- [ ] Dedicated relay URL dedupe tests for publish target selection.

### Integration / browser acceptance

- [ ] Compose note with text only.
- [ ] Compose note with image upload and alt text.
- [ ] Compose quote post from an existing event.
- [ ] Compose NIP-10 reply to kind-1 note.
- [ ] Compose NIP-22 comment to non-kind-1 target.
- [ ] Publish with NIP-07 extension.
- [ ] Publish with NIP-46 bunker signer.
- [ ] Handle signer permission denied without losing draft.
- [ ] Recover draft after reload/browser restart.
- [ ] Verify published note appears in local feed or note route after publish.

## Deferred from Phase 2

These are intentionally outside this phase or better tracked in later hardening work:

- Full NIP-44 gift-wrap/private DM envelope support.
- Scheduled posts.
- Draft cloud sync.
- Full end-to-end publish automation against live relays.
- Production push notification proxy.
- Cross-device compose/session handoff.

## Definition of Done

Phase 2 should be treated as **functionally delivered** once the following verification pass is complete:

- [ ] Run full CI for the current branch.
- [ ] Confirm compose → sign → publish works with at least one NIP-07 signer.
- [ ] Confirm compose → sign → publish works with NIP-46 bunker flow.
- [ ] Confirm image upload → kind-1063 metadata → note imeta flow.
- [ ] Confirm draft recovery after reload for note, reply, quote, and thread contexts.
- [ ] Confirm structured compose pages publish or fail safely with clear errors.
- [ ] Update `docs/ROADMAP_STATUS.md` when verification is complete.

## Current Assessment

Phase 2 is no longer “ready to begin.” It is **mostly implemented**, with the remaining work focused on formal acceptance verification, consistency hardening, and documentation alignment.