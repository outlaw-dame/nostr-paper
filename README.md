# Nostr Paper

A local-first, privacy-respecting Nostr client PWA inspired by Facebook Paper's gesture-driven editorial design — rebuilt with iOS 26 / Apple HIG design language.

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  UI Layer                                                        │
│  Konsta UI v5 (iOS 26 theme) · Framer Motion v12 · Tailwind CSS │
│  @use-gesture/react · scroll-snap · backdrop-filter glass        │
├──────────────────────────────────────────────────────────────────┤
│  Nostr Protocol                                                  │
│  NDK (relay pool · outbox model · NIP-07/46 signing)            │
│  nostr-tools (crypto primitives · event validation)              │
├──────────────────────────────────────────────────────────────────┤
│  Local-First Data (Web Worker — off main thread)                │
│  @sqlite.org/sqlite-wasm · OPFS (Origin Private File System)    │
│  WAL mode · FTS5 full-text search · NIP-01 filter engine        │
│  Typed DB proxy · transaction helpers · exponential backoff      │
├──────────────────────────────────────────────────────────────────┤
│  PWA Infrastructure                                              │
│  vite-plugin-pwa · Workbox (injectManifest)                     │
│  coi-serviceworker (COOP/COEP for OPFS on static hosts)         │
│  CSP headers · nostr-push-proxy (VAPID, no FCM)                 │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Relay (wss://) → NDK (validation + dedup) → insertEvent()
                                                  │
                                          ┌───────▼────────┐
                                          │  SQLite/OPFS   │
                                          │  (Web Worker)  │
                                          └───────┬────────┘
                                                  │
                        queryEvents() ────────────┘
                              │
                        useNostrFeed()
                              │
                           React UI
```

Private keys **never** enter the application. All signing is delegated to NIP-07 browser extensions (nos2x, Alby) or NIP-46 remote signers (Nostr Connect).

---

## Phase Roadmap

| Phase | Status | Scope |
|-------|--------|-------|
| **1 — Foundation** | ✅ This PR | DB · NDK · PWA shell · Feed · Security |
| 2 — Compose       | 🔜 | Sign + publish · NIP-07/46 · Media upload |
| 3 — Social        | 🔜 | Reactions · Zaps · Replies · DMs (NIP-44) |
| 4 — Profile       | 🔜 | NIP-05 · Follow graph · NIP-65 relay lists |
| 5 — Discovery     | 🔜 | Search · Trending · Topic sections |
| 6 — Notifications | 🔜 | Push (VAPID · no FCM) · Notification proxy |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- A NIP-07 browser extension for signing: [nos2x](https://github.com/fiatjaf/nos2x), [Alby](https://getalby.com/), or [Flamingo](https://www.getflamingo.org/)

### Development

```bash
# Install dependencies
npm install

# Start dev server (includes COOP/COEP headers for OPFS)
npm run dev
```

Open `http://localhost:5173`. The app requires HTTPS in production for full PWA features; `localhost` is treated as a secure context by all modern browsers.

### Google Safe Browsing (URL threat checks)

This project supports Google Safe Browsing checks before fetching Open Graph previews.

1. Copy [.env.example](.env.example) to `.env.local`.
2. Set `GOOGLE_SAFE_BROWSING_API_KEY` for local dev proxy checks.
3. Frontend defaults to same-origin `POST /api/safe-browsing/check`.
4. In Vite dev, that path proxies to `http://127.0.0.1:7080/safe-browsing/check` by default.
5. Optional: set `SAFE_BROWSING_BACKEND_ORIGIN` to change the dev proxy backend origin.
6. Optional: set `VITE_SAFE_BROWSING_PROXY_URL` to fully override the frontend endpoint.

If you use the bundled Python server, the endpoint is:

```text
POST /safe-browsing/check
```

and it reads `GOOGLE_SAFE_BROWSING_API_KEY` from environment variables.

### Build

```bash
npm run build       # Production build
npm run preview     # Preview production build locally
npm run analyze     # Bundle size analysis
```

### Test

```bash
npm test            # Run all tests
npm run test:watch  # Watch mode
npm run test:coverage
```

---

## Security

### Private Key Handling

This application **never stores, transmits, or accepts nsec private keys**. Authentication is exclusively through:

- **NIP-07**: Browser extension signs events (nos2x, Alby, Flamingo)
- **NIP-46**: Remote signer via Nostr Connect bunker URL

If you need local key storage as a fallback, the architecture supports PIN-encrypted AES-GCM via Web Crypto API (PBKDF2, 100k iterations). This is a Phase 2 addition gated behind explicit user consent.

### Content Sanitization

All content from relays is treated as untrusted:

1. **Structural validation** — event schema + field types
2. **Cryptographic verification** — signature check via `nostr-tools`
3. **HTML sanitization** — DOMPurify with strict allowlist before any rendering
4. **URL allowlisting** — only `https:` and `wss:` schemes permitted
5. **Content limits** — all fields capped at defined byte limits

### HTTP Security Headers

Set via `public/_headers` (Cloudflare Pages) and injected by the service worker for all document responses:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ...
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```

### Storage

Event data is stored in SQLite via OPFS — the browser's Origin Private File System. This storage is:
- Inaccessible to other origins
- Not synced to the cloud
- Persistent across sessions (call `navigator.storage.persist()` — handled in bootstrap)
- Evictable under storage pressure on iOS Safari unless persistence is granted

---

## Database Schema

```sql
events          -- Core NIP-01 events (id, pubkey, kind, content, sig, raw)
tags            -- Normalized tag index for NIP-01 filter queries
profiles        -- Kind-0 metadata cache (sanitized, denormalized)
follows         -- Kind-3 follow lists
relay_list      -- NIP-65 kind-10002 relay lists
deletions       -- Kind-5 deletion markers
seen_events     -- Deduplication ring buffer (pruned >24h)
events_fts      -- FTS5 virtual table for NIP-50 search
```

FTS5 uses the Porter stemmer (`tokenize='porter unicode61'`) and keeps in sync with the events table via `AFTER INSERT/DELETE/UPDATE` triggers.

---

## Contributing

```bash
# Fork, then clone your fork
git clone https://github.com/your-username/nostr-paper
cd nostr-paper

# Create a feature branch
git checkout -b feature/your-feature

# Make changes, ensuring tests pass
npm test
npm run type-check
npm run lint

# Commit with conventional commits
git commit -m "feat: add compose sheet with NIP-07 signing"

# Push and open a PR against main
```

### Commit Convention

```
feat:     new feature
fix:      bug fix
security: security improvement
perf:     performance improvement
refactor: code change with no user-facing effect
test:     test additions/changes
docs:     documentation only
chore:    build/tooling changes
```

---

## Deployment

### Cloudflare Pages (recommended)

1. Connect your GitHub repo to Cloudflare Pages
2. Set build command: `npm run build`
3. Set output directory: `dist`
4. The `public/_headers` file sets COOP/COEP for OPFS support

The `coi-serviceworker` in `index.html` provides a fallback for any host that doesn't set the headers — but Cloudflare Pages supports them natively via `_headers`.

For compression, prefer Cloudflare edge compression instead of uploading precompressed assets. Cloudflare Compression Rules can prefer `zstd` and fall back automatically; keep Pages uploads uncompressed and let the edge negotiate encodings per client.

### Self-Hosted (nginx)

```nginx
server {
  # See deploy/nginx/nostr-paper.conf.example for the full version.
  gzip on;
  gzip_vary on;
  gzip_static on;
}
```

Build commands:

- Standard portable build: `npm run build`
- nginx-friendly precompressed build: `npm run build:precompressed`
- Optional zstd sidecars for advanced servers/CDNs: `npm run build:precompressed:zstd`

More detail: [docs/COMPRESSION.md](docs/COMPRESSION.md)
Full nginx example: [deploy/nginx/nostr-paper.conf.example](deploy/nginx/nostr-paper.conf.example)

---

## License

MIT — see [LICENSE](LICENSE)

---

## Acknowledgements

- [NDK](https://github.com/nostr-dev-kit/ndk) — Nostr Development Kit
- [Konsta UI](https://konstaui.com) — iOS/Material components
- [Framer Motion](https://www.framer.com/motion/) — Physics animation
- [SQLite WASM](https://sqlite.org/wasm) — Official SQLite WebAssembly
- Facebook Paper (2014) — The original design inspiration
