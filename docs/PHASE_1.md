# Phase 1 — Foundation

## Delivered

### Infrastructure
- Vite 5 + React 18 + TypeScript 5.6 (strict mode, `noUncheckedIndexedAccess`)
- `vite-plugin-pwa` with `injectManifest` strategy — full custom service worker
- `coi-serviceworker` for COOP/COEP headers on static hosts (Cloudflare Pages, Netlify)
- Path aliases (`@/`, `@lib/`, `@components/`, etc.)
- ESLint with `eslint-plugin-security` for static security analysis
- Vitest with jsdom and full browser API mocks
- GitHub Actions CI: type-check → lint → test → build → audit

### Local-First Database
- `@sqlite.org/sqlite-wasm` running in a dedicated Web Worker (main thread never blocked)
- OPFS (Origin Private File System) persistence with in-memory fallback
- WAL journal mode, 32MB page cache, `mmap_size=256MB`
- Full NIP-01 schema: `events`, `tags`, `profiles`, `follows`, `relay_list`, `deletions`, `seen_events`
- FTS5 virtual table with Porter stemmer + `unicode61` tokenizer, kept in sync via SQL triggers
- NIP-01 compliant filter engine in pure SQL (tag filters, compound indexes, time ranges)
- NIP-50 full-text search via FTS5 MATCH + BM25 ranking
- Typed DB proxy with per-query 10s timeout and ROLLBACK on transaction failure
- `dbTransaction()` helper for multi-statement atomicity

### Security
- DOMPurify strict allowlist (no `style`, `class`, `data-*`, or event handlers)
- Post-sanitize hooks enforce HTTPS-only `href`/`src`, force `rel="noopener noreferrer nofollow"`, and `loading="lazy"` on all images
- URL scheme allowlist (`https:` for links, `wss:` for relays only)
- NIP-01 structural validation + `verifyEvent()` cryptographic check on every inbound event
- Byte-length limits on every user-controlled field (`LIMITS` constants)
- Future-timestamp rejection (>10 min clock skew)
- Deletion events (kind 5) processed atomically — cannot delete another author's events
- `navigator.storage.persist()` requested at boot to prevent eviction
- CSP injected by service worker on all HTML responses
- `requestPersistentStorage()` called during bootstrap

### Error Handling & Resilience
- `withRetry()` — full-jitter exponential backoff with `AbortSignal` support, per-error `shouldRetry` predicate, `onRetry` callback
- `RelayBackoff` — per-relay state machine tracking failure count, `isExhausted` flag at `maxFailures`
- `fetchWithRetry()` — status-aware (4xx not retried, 5xx retried)
- Typed `Result<T, E>` return type on all fallible public APIs
- `AppError` with `ErrorCode` enum + `recoverable` flag
- Bootstrap is resilient: DB failure is fatal; NDK failure degrades to offline/cache-only mode
- All `useEffect` hooks use `AbortController` for clean cancellation on unmount

### Nostr Protocol
- NDK configured with outbox model (`enableOutboxModel: true`) and `purplepag.es` for NIP-65 lookups
- `NDKSQLiteCache` adapter implementing full `NDKCacheAdapter` interface
- NIP-07 signer auto-detected at boot — no private key ever enters the app
- Default relay set: damus.io, nos.lol, relay.nostr.band, nostr.wine, relay.snort.social
- `insertEvent()` handles kind-0 (profile upsert), kind-3 (follow list), kind-5 (deletion), kind-10002 (relay list) atomically
- `queryEvents()` is a full NIP-01 filter engine in SQL with tag filters, FTS, time ranges

### UI Foundation
- iOS 26 design token system (light/dark CSS custom properties matching HIG values exactly)
- Liquid Glass material system: `.glass`, `.glass-heavy`, `.glass-liquid` utility classes
- HIG typography scale: Large Title → Caption 2 (pixel-exact letter-spacing and line-height)
- `env(safe-area-inset-*)` safe area support throughout
- Konsta UI v5 (iOS 26 theme) integrated with Tailwind
- `BootSplash` with spring-animated logo mark
- `SectionRail` — glass floating pill with `layoutId` active indicator, velocity-gated swipe
- `HeroCard` — 55svh full-bleed card with drag-up expand, pubkey-derived gradient fallback
- `ExpandedNote` — shared layout morph from card, pull-down dismiss with `PanInfo` velocity check
- `PanoramaImage` — DeviceOrientation tilt + mouse parallax fallback, `useSpring` smoothing
- `NoteContent` — pure React tokenizer (no `dangerouslySetInnerHTML`), hashtag/URL/nostr: detection
- `FeedSkeleton` — shimmer placeholder for hero + card variants
- PWA update banner, offline banner, error screen with reload

## Not In Phase 1 (deferred)

- Compose / event publishing (Phase 2)
- NIP-46 remote signer UI (Phase 2)
- Reactions, zaps, reposts (Phase 3)
- Full profile page (Phase 4)
- NIP-05 verification flow (Phase 4)
- Push notification proxy (Phase 6)
- Long-form article rendering (Phase 5)
- Media upload (Phase 2)

## Known Limitations

- OPFS requires `SharedArrayBuffer` which requires COOP/COEP headers. The `coi-serviceworker` handles this on most static hosts but requires a first page load to install before OPFS activates. On second load, OPFS is available.
- iOS Safari ≤ 16.3 does not support OPFS — the app transparently falls back to in-memory SQLite. Data does not persist across sessions on those browsers.
- `SharedWorker` is not supported on Chrome for Android — the worker uses `Worker` (not `SharedWorker`) so multiple tabs each run their own SQLite instance. Write contention is avoided because all writes go through NDK's single subscription handler per session.
