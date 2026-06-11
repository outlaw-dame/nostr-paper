# Nostr Embed Architecture

Nostr Paper resolves shared event references through an app-owned path before native rendering.

## Current implementation

The resolver is `src/lib/nostr/embedResolver.ts`.

The event hook is `src/hooks/useEvent.ts`.

The resolver:

- normalizes event references;
- preserves relay hints from event references;
- caps and deduplicates relay hints;
- adds safe relay hints to the shared NDK pool;
- checks cached and fetched events before returning them to UI callers;
- exposes explicit resolution states for better loading, invalid, and not-found UI.

## Why this exists

Embed cards should not own separate relay pools or bypass app policy. Event lookup belongs in a shared resolver so native cards, note pages, media handling, moderation, and actions all receive the same verified event object.

## Remaining work

- Add a mocked cache-miss to relay-fetch unit test.
- Add explicit deleted/tombstone UI state where needed.
- Add an edge snapshot provider only after a real endpoint exists.
