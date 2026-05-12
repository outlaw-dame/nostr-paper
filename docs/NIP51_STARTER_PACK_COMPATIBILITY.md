# NIP-51 Starter/Follow Pack Compatibility Matrix

Date: 2026-05-11

This document captures verified external-client behavior for starter/follow-pack style lists and maps those formats into Nostr Paper ingestion/publishing strategy.

## Verified Client Evidence

### Damus (damus-io/damus)

Observed support:
- Kind `39089` is mapped as `follow_list` in `NostrKind`.
- Dedicated follow-pack feature models and views exist (`FollowPackEvent`, `FollowPackView`, onboarding loaders).
- Follow-pack parsing uses tags: `d`, `title`, `image`, `description`, repeated `p` pubkeys.

Implication:
- Damus-style follow packs are compatible with our `Kind.StarterPack` (`39089`) parser and UI.

### Coracle (coracle-social/coracle)

Observed support:
- Explicit constant `FOLLOW_PACK = 39089` in domain list code.
- Uses NIP-51 list/feeds workflows and custom list kinds in app state.
- Changelog/README references broad NIP-51 list support.

Implication:
- Coracle `39089` follow packs are compatible with our `Kind.StarterPack` handling.

### Amethyst (vitorpamplona/amethyst)

Observed support:
- Kind `39089` is defined in `FollowListEvent`.
- Serialization tests include starter-pack events with `d`, `title`, `image`, `description`, and repeated `p` tags.

Implication:
- Amethyst starter packs are wire-compatible with our starter-pack parser and follow-pack discovery flow.

### Iris (irislib/iris-messenger)

Observed support:
- README currently marks NIP-51 as not implemented.
- Uses follow suggestions and kind-3 follows, plus app-specific kind-30000 usage.

Implication:
- Iris does not appear to publish standardized NIP-51 starter packs; interoperability should rely on kind-3 follows or app-specific transforms rather than direct starter-pack ingestion.

## Canonical Interop Shape (for 39089)

For best cross-client compatibility, treat this as canonical:
- Event kind: `39089`
- Addressable identifier: `d` tag (required)
- Optional metadata tags: `title`, `image`, `description`
- Members: repeated `p` tags
  - `p[1]`: pubkey (required)
  - `p[2]`: relay hint (optional)
  - `p[3]`: petname/display hint (optional)
- Content: empty string preferred

## Nostr Paper Fit Strategy

### Ingestion

1. Accept `39089` from any author as starter packs.
2. Parse/retain optional relay and petname from each `p` tag.
3. Deduplicate by `(kind, author, d)` using latest replaceable event semantics.
4. Rank for Explore using:
   - missing profiles (not already followed)
   - recency
   - metadata completeness (`title`/`description`/`image`)

### Publishing

1. Keep publishing `39089` for general starter packs.
2. Preserve metadata tags (`title`, `image`, `description`) for UI parity.
3. Keep `39092` media starter packs as Nostr Paper extension where useful; degrade to `39089` in interop exports if target client lacks `39092` behavior.

### Compatibility fallback rules

1. If a client/relay ecosystem only shows kind-3 follows, offer one-click conversion into a local starter-pack draft.
2. If incoming `39089` has missing metadata, synthesize display title from `d` or author profile.
3. If incoming `39089` contains malformed `p` tags, skip invalid entries but keep the set.

## Recommended Seed Packs to Mirror

When curating default/fallback packs for onboarding, prioritize lists that match Damus/Coracle conventions:
- `39089` with explicit `d`, `title`, `description` and clean `p` tags.
- Keep pack sizes moderate (for UX and follow-all safety), e.g. 8-40 profiles.
- Include at least one relay hint in `p` tags when known.

## Operational Note

Client code already supports both:
- `39089` (`StarterPack`)
- `39092` (`MediaStarterPack`)
- `30000` (`FollowSet`) as follow-pack discovery input
- `30001` (`DeprecatedListSet`) for legacy compatibility parsing (`pin`, `bookmark`, `communities`)

Client code also now avoids treating legacy `30000:d=mute` compatibility events as follow-packs, preventing false "Follow All" UX on old mute-list encodings.

The Profile page now dynamically loads all addressable NIP-51 sets, so newly ingested external pack/set kinds are visible without additional hardcoded UI buckets.
