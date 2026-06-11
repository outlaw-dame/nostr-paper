# Nostr Embed Architecture

Nostr Paper renders Nostr references as native React UI. Web components can remain useful reference material, but the production path is the app-owned resolver and cache pipeline.

## Goals

- Check SQLite/OPFS before relay fetches.
- Preserve relay hints from shared references without letting components create their own socket pools.
- Treat relay and edge data as untrusted until the event passes validation.
- Keep rendering, moderation, media previews, and actions inside the native app UI.

## Current flow

```text
NIP-21 or NIP-19 input
  -> decodeEventReference()
  -> normalizeEventEmbedReference()
  -> local getEvent(id)
  -> verifyEmbedEvent(event, requested id/author/kind)
  -> add safe nevent relay hints to the shared NDK pool
  -> ndk.fetchEvents({ ids, authors?, kinds?, limit: 1 })
  -> waitForCachedEvents([id])
  -> local getEvent(id)
  -> verifyEmbedEvent(...)
  -> native event card UI
```

The central implementation is `src/lib/nostr/embedResolver.ts`. `src/hooks/useEvent.ts` uses this resolver so raw hex ids, `note1...`, `nevent1...`, and `nostr:` event references all follow the same path.

## Relay-hint policy

Relay hints are lookup hints only.

- Only valid `wss://` relay hints are accepted for passive embed resolution.
- Hints are deduplicated and capped before they touch the shared relay pool.
- Hints are added through the existing NDK pool helper.
- Fetch filters retain the requested event id plus optional `author` and `kind` constraints from `nevent`.

## Verification gate

`verifyEmbedEvent()` rejects malformed events, invalid events, and valid events that do not match the requested id, author, or kind constraints.

The database insert path also validates events, but the embed boundary keeps its own check so caches, relays, and future edge snapshots never become implicit trust anchors.

## Render states

The resolver exposes these states:

```text
idle
decoding-reference
cache-hit
selecting-relays
fetching-event
verifying-event
ready
not-found
invalid-reference
invalid-event
error
```

Current callers can continue reading `event`, `loading`, and `error`. The additional state is available for richer skeletons, collapsed invalid cards, tombstones, and diagnostics.

## Media and link previews

The resolver only resolves events. Media and link rendering stay in the existing native card stack:

- NIP-92 `imeta` parsing and media rendering remain in the media components.
- Link cards flow through `useLinkPreview()` and `LinkPreviewCard`.
- Open Graph fetching should stay behind the configured preview proxy instead of being performed by embed components directly.

## Edge acceleration boundary

A future HTTP or edge snapshot provider may speed first paint, but it must remain an acceleration layer rather than the source of truth:

1. fetch snapshot;
2. validate event shape, id, and signature through the normal app boundary;
3. verify requested id, author, and kind constraints;
4. store only through the normal validated path;
5. render only after verification passes.

## Follow-up hardening

- Add mocked cache-miss to relay-fetch resolver tests.
- Add signed-event test fixtures when connector constraints allow them.
- Add explicit deleted/tombstone state handling where UI needs to distinguish deletion from ordinary not-found.
- Add a generic `EmbedSnapshotProvider` only when a real edge snapshot endpoint exists.
