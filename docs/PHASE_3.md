# Phase 3 Acceptance Checklist

Phase 3 covers the social layer: replies, reactions, zaps, direct messages, and platform parity.

## Replies and Threads

- App thread views hydrate from local cache, relay fetches, and the optional platform search relay when `VITE_PLATFORM_SEARCH_RELAY_URL` is configured.
- Root event-id threads use `thread_id`.
- Addressable roots, such as article comments, use `thread_address`.
- Pure quote reposts remain outside reply trees.

Acceptance tests:

- Opening a root note shows the root plus descendants in deterministic order.
- Opening an addressable article loads kind-1111 comments through the root address.
- Quote-only events do not appear in the replies section.

## Reactions

- Kind-7 publishing has optimistic UI state.
- Failed publish attempts roll back the optimistic state.
- Rapid duplicate taps are guarded before a second publish can start.
- Failure categories are counted through social telemetry.

Acceptance tests:

- One like tap sends one reaction event.
- A failed like returns the action bar to its previous count.
- Signer, relay, network, validation, and abort failures are classifiable.

## Zaps

- Kind-9734 zap requests are signer-safe.
- Invoice creation respects LNURL min, max, and comment limits.
- Wallet open failure keeps the invoice visible for copy fallback.
- Kind-9735 receipts can be validated against an expected LNURL server pubkey when available.
- Event zaps and profile zaps have separate entry points.

Acceptance tests:

- Invoice fetch sends amount and zap request to the callback.
- LNURL errors are visible and retryable.
- Receipt validation rejects mismatched LNURL server pubkeys.

## Direct Messages

- `/dm` shows a signed-in user's DM inbox.
- `/dm/:pubkey` shows one encrypted conversation and send box.
- `/dm/compose` sends a first message by hex pubkey, npub, or nprofile.
- Kind-4 messages prefer NIP-44 encryption and fall back to NIP-04 when available.
- DM relay preferences are read from kind-10050 lists and merged with defaults.
- Unsupported signer encryption is surfaced before a send attempt.

Acceptance tests:

- Kind-4 inbound and outbound events parse into the same conversation.
- Inbox filters include inbound mentions and outbound authored DMs.
- A signer without NIP-44 or NIP-04 cannot submit the send form.

## Platform Parity

- The lexical worker ingests social kinds 6, 7, and 9735.
- Social events update `event_social_metrics` instead of polluting searchable text.
- Duplicate event ingestion does not double-count metrics.

Acceptance tests:

- A reaction increments reaction and like/dislike totals for the target event.
- A repost increments repost totals for the target event.
- A zap receipt increments zap count and millisat totals for the target event.
