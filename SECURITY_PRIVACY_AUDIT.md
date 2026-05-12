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

All verification commands above passed. Dependency audits reported zero vulnerabilities.
