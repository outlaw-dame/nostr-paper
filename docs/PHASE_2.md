# Phase 2 — Compose

## Overview

Phase 2 adds event publishing capabilities to Nostr Paper. Users can now:
- Draft and publish short-form notes (kind=1)
- Sign events via NIP-07 browser extensions or NIP-46 remote signers
- Upload media files (images, videos) to Blossom servers
- Compose polls, long-form articles, and structured content
- Auto-complete hashtags and mentions from known profiles

## Requirements & Constraints

### Publishing Architecture
- **Private keys never enter the app** — all signing delegated to NIP-07 extensions or NIP-46 relay signers
- **Event validation** — verify signatures before publishing, ensure compliance with NIP-01
- **Relay routing** — publish to user's relays + Nostr Paper search relay
- **Idempotency** — prevent duplicate publishes on network retry

### Media Upload (Blossom)
- **NIP-96 compliance** — Blossom media server integration
- **HTTPS only** — no unencrypted uploads
- **Metadata** — embed image dimensions, alt text, MIME type in `imeta` tags
- **Rate limiting** — respect server quotas per content type

### Signer Support
- **NIP-07** (Nos2x, Alby, Flamingo) — browser extension signing
- **NIP-46** (Nostr Connect) — remote signer via relay (Phase 2B)
- **Permission prompts** — ask user to confirm before signing

## Deliverables

### 1. Compose Sheet UI Component ✓ (existing prototype, needs completion)
**File:** `src/components/compose/ComposeSheet.tsx`

**Features:**
- Full-screen compose overlay with pull-down dismiss
- Auto-save drafts to localStorage
- Character counter + emoji support
- Real-time tone detection (caution/supportive/neutral)
- AI compose assist (Gemini fallback hints)
- Hashtag autocomplete from DB
- @mention suggestions from follows

**Status:** Prototype exists; needs integration with signing + publishing

### 2. NIP-07 Signer Integration
**Files:** 
- `src/lib/nostr/ndk.ts` (already has NIP-07 auto-detect)
- `src/lib/nostr/nip07.ts` (new)
- `src/hooks/useNip07Sign.ts` (new)

**Features:**
- Detect installed extensions (nos2x, Alby, Flamingo)
- Request signing with user confirmation
- Handle permission denied + timeout errors
- Display extension name in publish UI

**Inputs:**
- Unsigned event (UnsignedEvent)
- Optional relay hint

**Outputs:**
- Signed event (NostrEvent) with sig + id
- Error result if signing fails

### 3. Event Publishing Pipeline
**Files:**
- `src/lib/nostr/publish.ts` (new)
- `src/hooks/usePublishEvent.ts` (new)

**Features:**
- Validate unsigned event before signing
- Sign via NIP-07 or NIP-46
- Publish to user's relays + search relay
- Retry on transient failures (exponential backoff)
- Deduplicate relay URLs (don't publish twice to same relay)
- Return event ID on success

**Event Types:**
- kind=1 (short notes)
- kind=6 (reposts)
- kind=7 (reactions)
- kind=9 (file metadata + imeta tags)
- kind=23 (long-form articles)
- kind=25 (video)
- kind=30024 (polls)
- kind=34235 (moderated lists)

### 4. NIP-96 Media Upload (Blossom)
**Files:**
- `src/lib/blossom/upload.ts` (new)
- `src/hooks/useBlossomUpload.ts` (new)
- `src/components/media/MediaUploadButton.tsx` (new)

**Features:**
- Detect Blossom servers from relays (via NIP-96 discovery)
- Pre-sign upload request with NIP-98 auth
- Upload to HTTPS endpoint with progress tracking
- Extract returned media URL + hash
- Embed in compose as `[image alt](url)` or `imeta` tag

**Upload Flow:**
1. User selects image/video
2. App queries relay for Blossom endpoint (server.well-known/nostr/blossom.json)
3. Generate NIP-98 auth header (signed expiration + hash)
4. POST file to /upload endpoint
5. Receive URL + hash + dimensions
6. Insert image tag into compose draft

### 5. Compose Pages & Routes
**New Pages:**
- `/compose` — full-screen note composer
- `/compose/video` — video upload + metadata
- `/compose/poll` — poll builder
- `/compose/article` — long-form article composer
- `/compose/list` — moderated list composer

**Shared Components:**
- `ComposeSheet` — reusable overlay
- `MediaUploadButton` — file picker + upload
- `MentionInput` — @mention autocomplete
- `HashtagInput` — #tag suggestions

### 6. Draft Management
**Files:**
- `src/lib/compose/drafts.ts` (new)
- `src/contexts/ComposeContext.tsx` (new)

**Features:**
- Auto-save drafts to localStorage per composition type
- Recover draft on page reload
- Clear draft on successful publish
- Display unsaved changes warning on navigation

### 7. Publishing State Management
**Files:**
- `src/hooks/usePublishState.ts` (new)

**Features:**
- Track publish progress (idle → signing → publishing → complete)
- Handle errors gracefully
- Retry on network failure
- Display user feedback (toast notifications)

## Testing

### Unit Tests
- [ ] Unsigned event validation
- [ ] NIP-07 signing flow
- [ ] Media URL extraction from Blossom response
- [ ] Draft serialization / deserialization
- [ ] Relay URL deduplication

### Integration Tests
- [ ] End-to-end compose → sign → publish flow
- [ ] Media upload with auth
- [ ] Retry on relay timeout
- [ ] Draft recovery on page reload

### Manual Testing Checklist
- [ ] Compose note with text only
- [ ] Compose with image upload
- [ ] Compose with @mention and #hashtag
- [ ] Publish with Nos2x extension
- [ ] Handle "permission denied" from extension
- [ ] Recover draft after browser crash
- [ ] Verify published note appears in feed within 5 seconds

## Out of Scope (Phase 3+)

- NIP-46 remote signer UI (Phase 2B)
- Reactions (kind 7) composition (Phase 3)
- Zaps (kind 9734) integration (Phase 3)
- Reposts (kind 6) composition (Phase 3)
- DMs (kind 4, NIP-44 encrypted) (Phase 3)
- List creation UI (Phase 3)
- Scheduled posts (Phase 5)
- Drafts cloud sync (Phase 5)

## Implementation Order

1. **NIP-07 signer integration** (foundation for all publishing)
2. **Event publishing pipeline** (core publish logic)
3. **Compose Sheet UI** (complete + integrate)
4. **NIP-96 media upload** (image/video support)
5. **Compose pages** (routes + navigation)
6. **Draft management** (localStorage recovery)
7. **Testing + polish** (error messages, UX feedback)

## Success Criteria

✅ Users can publish notes to their relays  
✅ Published notes appear in their feed within 5 seconds  
✅ Media uploads work with image preview  
✅ NIP-07 signing works with installed extensions  
✅ All tests pass (unit + integration)  
✅ No console errors in production build  
✅ CSP headers + security model still intact

## Resources

- [NIP-07 Signer Specification](https://github.com/nostr-protocol/nips/blob/master/07.md)
- [NIP-96 Media Upload (Blossom)](https://github.com/nostr-protocol/nips/blob/master/96.md)
- [NIP-98 HTTP Auth](https://github.com/nostr-protocol/nips/blob/master/98.md)
- [NDK Publisher API](https://docs.ndk.dev/modules/NDKPublisher)
- [Blossom Server](https://github.com/xn3nn/blossom)

## Status

🔜 Ready to begin — waiting for Phase 1 completion (✅ complete)
