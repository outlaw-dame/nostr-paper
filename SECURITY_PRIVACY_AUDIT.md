# Security and Privacy Audit

Date: 2026-05-10

## Scope

Reviewed the client PWA, Nostr authentication paths, translation and AI integrations, service worker and deployment headers, local Python daemon, Vite development server, platform Docker compose stack, NIP-50 search API, Blossom media edge, dependency manifests, and security-sensitive tests/documentation.

## Critical Findings Remediated

1. Local Nostr private key handling was removed.
   - The app no longer accepts or restores `nsec` keys.
   - Legacy `nostr-paper:nsec` storage is purged on boot/logout.
   - Authentication is limited to NIP-07, NIP-46, or read-only public-key mode.

2. Browser-delivered provider secrets were removed.
   - DeepL and Gemini translation keys are no longer read from `VITE_*` build variables.
   - Translation provider secrets are session-only and legacy persisted copies are deleted.
   - Cloudflare AI and Tenor calls now require server-side proxy endpoints.
   - The direct Gemini enhancer path is disabled until it is backed by a server-side proxy.
   - Spotify OAuth access/refresh tokens and Apple Music user tokens are session-only, and legacy persisted token records are purged.
   - Compose drafts are session-only, and legacy persisted draft records are purged.

3. Browser policy was tightened.
   - Added a restrictive CSP in static headers and service-worker document responses.
   - Blocked framing, plugins, base-tag injection, and mixed-content downgrade paths.
   - Removed broad script execution allowances except `wasm-unsafe-eval`, which is still required for the local WASM model/runtime stack.
   - URL handling now rejects non-HTTPS external targets in security-sensitive fetch/navigation paths.
   - User-status web links reject plaintext `http:` references while preserving safe custom URI schemes.

4. Local service exposure was reduced.
   - Vite binds to `127.0.0.1` by default.
   - The local Python API script binds to `127.0.0.1` by default.
   - Platform compose publishes Redis, Postgres, strfry, and search API on `127.0.0.1` by default.
   - Wider host binding now requires explicit opt-in through `DEV_SERVER_HOST` or `PLATFORM_BIND_HOST`.

5. Python daemon request surface was hardened.
   - CORS defaults no longer use a wildcard.
   - Trusted host validation is enabled.
   - OpenAPI/docs are disabled by default.
   - Internal translation exceptions are no longer reflected to clients.

6. Search API admin and relay surfaces were hardened.
   - Moderation ops routes now fail closed unless `MODERATION_OPS_TOKEN` is configured with at least 32 characters.
   - Token verification uses timing-safe comparison.
   - WebSocket payload size, request rate, filter count, kind count, author count, search length, and thread address length are bounded.
   - Invalid or oversized relay requests are rejected/closed before expensive processing.

7. Blossom mirror/upload SSRF and DoS controls were added.
   - Mirror fetches require HTTPS and reject credentials, localhost, private networks, link-local hosts, and metadata hostnames.
   - Redirects are followed manually with a hard cap and every hop is revalidated.
   - Upload and mirror reads are streamed through explicit byte limits.
   - Mirror fetches have bounded timeouts and redirect counts.

8. Documentation and tests were updated to match the hardened behavior.
   - `.env.example`, README, platform docs, and AI integration docs now warn against browser-delivered secrets.
   - NSEC affordances were removed from onboarding/settings copy and tests.

## 2026-06-10 Follow-up Audit

### Additional Scope

Reviewed recently added Nostr embed resolution, Open Graph/link preview fetching, Safe Browsing checks, note rendering/linkification, static deployment headers, and the Vite dev proxy surfaces used for local OG/media/feed fetches.

### Findings Remediated

1. Passive link preview requests could proceed without local URL normalization.
   - `fetchOGData()` now rejects non-HTTPS, credential-bearing, malformed, or otherwise unsafe preview URLs before cache lookup, Safe Browsing, or proxy dispatch.
   - Preview cache keys are based on canonicalized URLs with fragments and credentials removed.

2. Safe Browsing checks only supported fail-open behavior.
   - `checkSafeBrowsingURL()` now accepts `{ failOpen: false }` for passive preview fetches.
   - Link rendering can keep compatibility-oriented fail-open behavior, while preview fetching now fails closed when the reputation proxy is unavailable or returns malformed data.
   - Unsafe URL schemes are rejected before the Safe Browsing proxy is contacted.

3. Untrusted OG proxy responses were only shape-checked for a `url` string.
   - OG preview responses are now normalized before UI use.
   - Returned `url`, `image`, and `favicon` fields must pass the same safe HTTPS URL policy.
   - Text fields are sanitized, whitespace-normalized, and length-bounded before caching.

4. Cache-mode confusion between fail-open and fail-closed Safe Browsing decisions was possible.
   - Safe Browsing cache keys now include the failure policy mode so a compatibility-oriented decision cannot satisfy a fail-closed preview fetch.

### Tests Added

- `src/lib/security/safeBrowsing.test.ts` covers unsafe-scheme rejection, default fail-open behavior, fail-closed preview behavior, and separate cache entries for fail-open versus fail-closed checks.

### Residual Follow-up

- The Vite dev OG/media/feed proxies still rely on hostname screening plus redirect validation. They should be upgraded to resolve DNS before each upstream request and reject private, loopback, link-local, multicast, carrier-grade NAT, and cloud-metadata IP ranges. This is less urgent for production because these are development/preview-server helpers, but it matters if `npm run dev:host` is used on an untrusted network.

## Residual Operational Requirements

- `VITE_APPLE_MUSIC_DEVELOPER_TOKEN` remains browser-visible by design because MusicKit uses a developer JWT in the client. Never embed the MusicKit private key; use short-lived generated JWTs and rotate them.
- User-entered cloud translation keys are not persisted, but they are still present in page memory during the session and are sent to the selected provider. High-risk deployments should route all provider calls through a backend proxy instead.
- Spotify OAuth tokens and Apple Music user tokens are session-only. Users must reconnect music services after closing the browser session.
- Compose drafts are session-only. Unpublished text no longer survives browser-session close.
- CSP still allows `style-src 'unsafe-inline'` for the current app styling model and `script-src 'wasm-unsafe-eval'` for the local WASM inference stack. Tighten these further if the runtime is moved to nonce/hash-compatible CSS and WASM loading.
- `connect-src` intentionally permits `https:` and `wss:` for Nostr relays, model downloads, media, and proxy endpoints. Production deployments with a fixed relay/proxy set should narrow this allowlist.
- `npm run dev:host` and `PLATFORM_BIND_HOST=0.0.0.0` are explicit exposure modes. Use only on trusted networks or behind tunnels with their own access controls.

## Verification Performed

- `npm run type-check`
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run test -- src/lib/security/sanitize.test.ts src/pages/OnboardPage.nip46.test.tsx src/lib/translation/storage.test.ts src/workers/router.worker.test.ts`
- `npm run test -- src/lib/music/spotifyAuth.test.ts src/lib/nostr/status.test.ts src/lib/security/sanitize.test.ts`
- `npm run test -- src/lib/compose/drafts.test.ts src/lib/music/appleMusicAuth.test.ts src/lib/music/spotifyAuth.test.ts src/lib/nostr/status.test.ts src/lib/security/sanitize.test.ts`
- `npm run test -- src/pages/OnboardPage.nip05.test.tsx src/pages/OnboardPage.nip46.test.tsx`
- `npm run build --prefix platform/services/search-api`
- `npm run type-check --prefix platform/services/blossom-edge`
- `npm run build --prefix platform/services/ingestion-bridge`
- `npm run build --prefix platform/services/workers/embedding`
- `npm run build --prefix platform/services/workers/lexical-index`
- `npm run test:all --prefix platform/services/relay-policy`
- `npm run test:media-index --prefix platform/services/workers/lexical-index`
- `npm audit`
- `npm audit --prefix platform/services/search-api`
- `npm audit --prefix platform/services/blossom-edge`
- `npm audit --prefix platform/services/ingestion-bridge`
- `npm audit --prefix platform/services/workers/embedding`
- `npm audit --prefix platform/services/workers/lexical-index`

All verification commands above passed for the 2026-05-10 audit. For the 2026-06-10 follow-up changes, use the PR CI run as source of truth because this ChatGPT runtime cannot clone GitHub locally.
