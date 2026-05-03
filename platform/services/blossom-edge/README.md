# Nostr Paper Blossom Edge

Cloudflare Worker that exposes a Blossom media server backed by Cloudflare R2, with optional Filebase/IPFS archival.

Supported endpoints:

- `GET|HEAD /<sha256>[.<ext>]` for BUD-01 retrieval with range support
- `PUT /upload` for BUD-02 uploads
- `HEAD /upload` for BUD-06 upload requirements
- `PUT /mirror` for BUD-04 remote mirroring
- `PUT|HEAD /media` for BUD-05 trusted media storage
- `GET /list/<pubkey>` and `DELETE /<sha256>` for BUD-12 management

Native Blossom write operations require BUD-11 kind-24242 authorization. Objects are stored under their SHA-256 hash, so R2 acts as the fast edge/object layer and Filebase can pin the same bytes for longer-term IPFS retrieval.

## Setup

1. Copy `wrangler.toml.example` to `wrangler.toml` and set the R2 bucket name.
2. Create/bind the R2 bucket in Cloudflare.
3. Optional: set `FILEBASE_BUCKET`, `FILEBASE_GATEWAY_BASE_URL`, and the two Filebase secrets for IPFS archival.
4. Run `npm install`, then `npm run deploy` from this directory.
