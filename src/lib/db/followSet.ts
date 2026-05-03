/**
 * Current-User Follow Set
 *
 * `useFollowStatus` is rendered once per author card, so on a long feed it
 * fires N database round-trips on every scroll just to render follow pills.
 * This module exposes a singleton, in-memory `Set<pubkey>` for the *current
 * user's* follow list with reactive updates for React consumers.
 *
 * It is hydrated from SQLite once per pubkey change and refreshed on
 * `CONTACT_LIST_UPDATED_EVENT`. Cross-user follow lookups (rare) still go
 * to SQLite via `isFollowing()`.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { getFollows } from './nostr'

export const CONTACT_LIST_UPDATED_EVENT = 'nostr-paper:contact-list-updated'

interface ContactListUpdatedDetail {
  pubkey?: string
}

let currentPubkey: string | null = null
let followSet: Set<string> = new Set()
let loaded = false
const subscribers = new Set<() => void>()

function notify(): void {
  for (const subscriber of subscribers) subscriber()
}

async function refresh(pubkey: string): Promise<void> {
  try {
    const follows = await getFollows(pubkey)
    if (currentPubkey !== pubkey) return
    followSet = new Set(follows)
    loaded = true
    notify()
  } catch {
    if (currentPubkey !== pubkey) return
    // Failure is non-fatal; keep prior state but mark loaded so consumers
    // don't spin indefinitely.
    loaded = true
    notify()
  }
}

let listenerInstalled = false
function ensureListener(): void {
  if (listenerInstalled || typeof window === 'undefined') return
  listenerInstalled = true
  window.addEventListener(CONTACT_LIST_UPDATED_EVENT, (event) => {
    const detail = (event as CustomEvent<ContactListUpdatedDetail>).detail
    const target = detail?.pubkey
    if (currentPubkey && (!target || target === currentPubkey)) {
      void refresh(currentPubkey)
    }
  })
}

export function setCurrentUserPubkeyForFollowSet(pubkey: string | null): void {
  ensureListener()
  if (pubkey === currentPubkey) return
  currentPubkey = pubkey
  followSet = new Set()
  loaded = false
  notify()
  if (pubkey) {
    void refresh(pubkey)
  }
}

export function isInCurrentUserFollowSet(pubkey: string): boolean {
  return followSet.has(pubkey)
}

export function emitContactListUpdated(pubkey?: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CONTACT_LIST_UPDATED_EVENT, {
    detail: pubkey ? { pubkey } : {},
  }))
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener)
  return () => subscribers.delete(listener)
}

interface FollowSetSnapshot {
  loaded: boolean
  pubkey: string | null
  set: Set<string>
}

let snapshot: FollowSetSnapshot = { loaded, pubkey: currentPubkey, set: followSet }
function getSnapshot(): FollowSetSnapshot {
  // Recompute only when underlying state changed (compare cheap fields).
  if (
    snapshot.loaded !== loaded ||
    snapshot.pubkey !== currentPubkey ||
    snapshot.set !== followSet
  ) {
    snapshot = { loaded, pubkey: currentPubkey, set: followSet }
  }
  return snapshot
}

/**
 * React hook returning a stable snapshot of the current user's follow set.
 * Tracking individual pubkeys is done by the caller (`hasPubkey()`), not by
 * subscription, to keep the hook cheap when used per-card.
 */
export function useCurrentUserFollowSet(): {
  loaded: boolean
  pubkey: string | null
  hasPubkey: (pubkey: string) => boolean
} {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    loaded: snap.loaded,
    pubkey: snap.pubkey,
    hasPubkey: (pubkey: string) => snap.set.has(pubkey),
  }
}

/**
 * Hook that wires the follow set to a given current-user pubkey. Place this
 * once near the top of the tree (in `AppContext` mount) so the singleton is
 * always coherent with `state.currentUser?.pubkey`.
 */
export function useBindCurrentUserFollowSet(pubkey: string | null): void {
  useEffect(() => {
    setCurrentUserPubkeyForFollowSet(pubkey ?? null)
  }, [pubkey])
}
