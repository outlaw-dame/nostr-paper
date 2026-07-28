# Nostr Paper

A local-first, privacy-respecting Nostr client PWA inspired by Facebook Paper's gesture-driven editorial design — rebuilt with iOS 26 / Apple HIG design language.

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)

---

## Relay and Media Architecture

Nostr Paper currently contains three distinct deployment concerns:

- the client PWA in this repository;
- the relay/search architecture under `platform/`, which is being prepared for extraction into its own dedicated relay repository while remaining linked to the app through Nostr protocols and validated endpoint configuration;
- the Blossom media edge under `platform/services/blossom-edge/`, which is an independently deployable media service and is not automatically part of the relay extraction.

The separate `outlaw-dame/nostr-paper-platform` repository is unrelated to this migration and is not the destination for the relay architecture.

See [docs/backend.md](docs/backend.md) and [docs/architecture/relay-separation.md](docs/architecture/relay-separation.md).

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

The dev server binds to `127.0.0.1` by default. Use `npm run dev:host` only for an intentional LAN or tunnel session, and pair it with the strict host allowlist in `vite.config.ts`.

### Google Safe Browsing (URL threat checks)

This project supports Google Safe Browsing checks before fetching Open Graph previews.

1. Copy [.env.example](.env.example) to `.env.local`.
2. Set `GOOGLE_SAFE_BROWSING_API_KEY` for local dev proxy checks.
3. In Vite dev, frontend defaults to same-origin `POST /__dev/safe-browsing`, handled directly by Vite middleware.
4. Production builds default to same-origin `POST /api/safe-browsing/check`.
5. Optional: set `VITE_SAFE_BROWSING_PROXY_URL` to fully override the frontend endpoint.
6. Optional: if you want local dev to call the bundled Python server instead, point the frontend at `/api/safe-browsing/check` and set `SAFE_BROWSING_BACKEND_ORIGIN`.

If you use the bundled Python server, the endpoint is:

```text
POST /safe-browsing/check
```

and it reads `GOOGLE_SAFE_BROWSING_API_KEY` from environment variables.

### Gemma 4 local inference (Google AI Edge)

This repo includes an on-device Gemma runtime built on `@mediapipe/tasks-genai`.
It runs entirely in a Web Worker and requires a WebGPU-capable browser.

1. Install dependencies with `npm install`.
2. Download one or both model files into `public/models/`:

```bash
mkdir -p public/models

curl -L "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task" \
      -o public/models/gemma-4-E2B-it-web.task

curl -L "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.task" \
      -o public/models/gemma-4-E4B-it-web.task
```

3. Add the model paths to `.env.local`:

```bash
VITE_GEMMA_E2B_MODEL_PATH=/models/gemma-4-E2B-it-web.task
VITE_GEMMA_E4B_MODEL_PATH=/models/gemma-4-E4B-it-web.task
VITE_GEMMA_MAX_TOKENS=1024
VITE_GEMMA_TEMPERATURE=0.8
VITE_GEMMA_TOP_K=40
```

4. Use the client from `src/lib/gemma/client.ts`:

```ts
import { generateText, isGemmaAvailable } from '@/lib/gemma/client'
if (isGemmaAvailable()) {
      const text = await generateText('Summarize this note...', {
            onToken: (partial) => console.log(partial),
      })
}
```

Notes:

- If both model paths are configured, the runtime prefers E4B by default.
- `public/models/` is ignored by git because the model assets are multi-GB local files.
- Gemma runtime WASM assets are copied into `public/vendor/mediapipe/tasks-genai/wasm` by `npm install` via `scripts/sync-gemma-wasm.mjs`.
- Vite is already configured with the required COOP/COEP headers and excludes `@mediapipe/tasks-genai` from dependency pre-bundling.

### Gemini API translation provider (Google cloud)

The translation settings now include a Gemini cloud provider.

1. Create a Gemini API key in Google AI Studio: https://aistudio.google.com/apikey
2. Open Settings -> Translations in the app.
3. Choose Provider = Gemini API (cloud).
4. Enter your API key and optional model ID (default: `gemini-2.5-flash`).

Optional local model default in `.env.local`:

```bash
VITE_GEMINI_MODEL=gemini-2.5-flash
```

Security notes:
