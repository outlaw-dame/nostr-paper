# Embed Phase Audit

Status after the embed resolver hardening branch.

| Phase | Status | Notes |
| --- | --- | --- |
| 1. Native embed foundation | Mostly complete | Native cards, event-reference decoding, NDK, local cache, and the new embed resolver are present. |
| 2. Media and link previews | Mostly complete | Existing media components, `imeta` support, link preview hook, and link preview cards cover the main path. |
| 3. Interactions and app signing | Mostly complete | Existing action components cover reactions, reposts, replies, quotes, zaps, bookmarks, reports, and deletes. |
| 4. Edge acceleration | Partial | Platform and preview infrastructure exist, but no generic verified embed snapshot provider is wired into the resolver yet. |

## Branch changes

- Added `normalizeEventEmbedReference()` to preserve relay hints, author constraints, and kind constraints.
- Added relay-hint normalization with dedupe, cap, and passive `wss://` acceptance.
- Added `buildEmbedFetchFilter()` so relay fetches retain id, author, and kind constraints.
- Added `verifyEmbedEvent()` as a render-time event boundary.
- Routed `useEvent()` through `resolveNostrEventEmbed()`.
- Added unit coverage for relay-hint normalization, reference preservation, fetch filter construction, and forged event rejection.

## Remaining work

- Add mocked cache-miss to relay-fetch resolver tests.
- Confirm YouTube and provider-specific link previews through the configured preview proxy.
- Add explicit deleted/tombstone UI state where callers need that distinction.
- Add an edge snapshot provider only after the endpoint exists.
