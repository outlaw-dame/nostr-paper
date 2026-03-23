# Compression Strategy

## Summary

This app should not compress assets in browser runtime code. Static asset compression belongs at the CDN/origin layer, where browsers can negotiate `Accept-Encoding` and receive the correct `Content-Encoding` automatically.

For this repo:

- Default `npm run build` stays portable and host-agnostic.
- `npm run build:precompressed` generates `.gz` files for compressible static assets in `dist/`.
- `npm run build:precompressed:zstd` also generates `.zst` files when the local Node runtime supports Zstandard.

## Why Gzip Is The Baseline

- `gzip` is universally supported by browsers, reverse proxies, and CDNs.
- Open-source nginx has first-party support for serving precompressed `.gz` assets via `gzip_static`.
- It is the lowest-risk format for self-hosted static deployments.

## Why Zstd Is Optional

- `zstd` generally gives better ratios and better decompression speed than `gzip`.
- Browser and CDN support for `Content-Encoding: zstd` is now real, but origin-server support is still uneven.
- Open-source nginx has a first-party `gzip_static` module, but not an equivalent built-in `zstd_static` module.

That means `.zst` files are useful only when your edge/CDN or origin server explicitly knows how to negotiate and serve them.

## Recommended By Host

### Cloudflare Pages

Use normal `npm run build`.

Do not upload precompressed `.gz` / `.zst` files just to chase compression. Cloudflare already handles response compression at the edge, and can be configured to prefer Zstandard via Compression Rules.

Recommended policy:

- Keep uploads uncompressed: just deploy `dist/` from `npm run build`.
- Leave `Cache-Control` headers transform-friendly. Do not add `no-transform` to static assets, because Cloudflare Compression Rules will skip those responses.
- If you want the conservative default, do nothing and let Cloudflare keep its default compression behavior.
- If you want to explicitly prefer Zstandard, create a Compression Rule for static responses and use the dashboard setting `Enable Zstandard (Zstd) compression Beta`, which Cloudflare documents as preferring Zstd and automatically falling back to Brotli, Gzip, or uncompressed data.

When to prefer Cloudflare edge `zstd` over uploaded sidecars:

- Prefer edge `zstd` when you are serving through proxied Cloudflare DNS and want the edge to negotiate per-client encodings.
- Prefer edge `zstd` when you do not control the origin server’s content-encoding logic.
- Do not upload `.gz` / `.zst` sidecars to Pages just to force compression; Pages plus Compression Rules is the cleaner path.

### Self-Hosted nginx

Use `npm run build:precompressed`.

That gives nginx `.gz` sidecars it can serve safely with `gzip_static on;`. This is the best low-risk integration for the current stack.

If you have a CDN or origin that explicitly supports `Content-Encoding: zstd`, use `npm run build:precompressed:zstd` and configure that server separately.

Recommended nginx policy:

- Use `gzip_static on;` for precompressed `.gz` files.
- Keep the original files alongside the `.gz` sidecars.
- Keep mtimes aligned between original and compressed files. The precompress script already does this because nginx recommends it.
- Treat `.zst` as an advanced deployment feature only. Open-source nginx has first-party `gzip_static`, but not a built-in equivalent `zstd_static`.

The repo includes a ready-to-adapt example at [deploy/nginx/nostr-paper.conf.example](../deploy/nginx/nostr-paper.conf.example).

## Design Constraints

- No runtime asset recompression in the service worker.
- No client-side `CompressionStream` usage for app bundles.
- No hard dependency on Vite compression plugins for dev-server stability.
- Keep original files and compressed sidecars together in `dist/`.
- Preserve mtimes on compressed outputs so nginx `gzip_static` behavior stays predictable.

## Source Notes

This strategy is based on:

- nginx `ngx_http_gzip_module`
- nginx `ngx_http_gzip_static_module`
- Cloudflare Compression Rules and Compression Rules settings
- RFC 8878 for Zstandard transport semantics
