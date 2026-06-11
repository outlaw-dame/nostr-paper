# Embed Phase Audit

Status reflects the repository after the embed resolver hardening branch.

| Phase | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| 1. Native embed foundation | Mostly complete | Native cards, NIP-21/NIP-19 decoding, NDK relay pool, local SQLite/OPFS cache, and the new `src/lib/nostr/embedResolver.ts` path. | Add a cache-miss to relay-fetch integration test with mocked NDK/cache behavior. |
| 2. Media and link previews | Mostly complete | NIP-92 `imeta`, media attachment components, link preview hook, and link preview cards exist in the app stack. | Confirm provider-specific previews, especially YouTube/oEmbed style cards, through the configured preview proxy. |
| 3. Interactions and signing | Mostly complete | Existing action components cover reactions, reposts, replies, quotes, zaps, bookmarks, reports, and deletes. Existing NDK setup delegates signing through the app signer layer. | Continue runtime validation across available browser extension and remote signer providers. |
| 4. Edge acceleration | Partial | Platform and preview-proxy infrastructure exists, but no generic verified embed snapshot provider is wired into the resolver. | Add an `EmbedSnapshotProvider` only after there is a concrete endpoint; keep snapshots untrusted and verify before render. |

## What changed in this branch

- Added `normalizeEventEmbedReference()` so event embeds preserve `nevent` relay hints, author constraints, and kind constraints.
- Added relay-hint normalization with dedupe, cap, and passive `wss://`-only acceptance.
- Added `buildEmbedFetchFilter()` so relay fetches retain id, author, and kind constraints.
- Added `verifyEmbedEvent()` so cached or fetched events are checked at the embed boundary before rendering.
- Routed `useEvent()` through `resolveNostrEventEmbed()` so note pages and embed consumers share the same cache-first resolver path.
- Added focused unit coverage for relay-hint normalization, reference preservation, fetch filter construction, and forged event rejection.

## Important notes

- The resolver does not replace the database insert validation path; it adds a second boundary at render-time.
- Embed components should not create their own relay pools.
- Open Graph previews should remain behind the configured preview proxy.
- Edge snapshots should not be treated as authoritative unless they pass the same local verification boundary.
