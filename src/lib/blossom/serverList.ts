/**
 * Blossom Server List — BUD-03
 *
 * Manages the user's preferred Blossom media server list via NIP-51
 * kind-10063 events (replaceable event).
 *
 * Spec: https://github.com/hzrd149/blossom/blob/master/buds/03.md
 *
 * The kind-10063 event structure:
 *   {
 *     kind: 10063,
 *     content: "",
 *     tags: [
 *       ["server", "https://blossom.example.com"],
 *       ["server", "https://cdn.another.com"],
 *     ]
 *   }
 *
 * Servers are ordered by priority (first = highest priority).
 */

import { NDKEvent } from '@nostr-dev-kit/ndk'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { getNDK } from '@/lib/nostr/ndk'
import {
  getBlossomServers,
  setBlossomServers,
  addBlossomServer,
} from '@/lib/db/blossom'
import { isValidBlossomUrl } from '@/lib/blossom/validate'
import type { BlossomServer } from '@/types'
import { Kind } from '@/types'

export const BLOSSOM_SERVER_LIST_KIND = 10063
export const NIP96_FILE_SERVER_LIST_KIND = Kind.FileServerPreference

// ── Relay → Local ────────────────────────────────────────────

/**
 * Fetch the user's BUD-03 server list from relays for a given pubkey.
 * Returns ordered server URLs (index 0 = highest priority).
 */
export async function fetchServerListFromRelays(
  pubkey: string,
): Promise<string[]> {
  let ndk
  try { ndk = getNDK() } catch { return [] }

  const events = await ndk.fetchEvents({
    kinds:   [BLOSSOM_SERVER_LIST_KIND, NIP96_FILE_SERVER_LIST_KIND as unknown as typeof BLOSSOM_SERVER_LIST_KIND],
    authors: [pubkey],
    limit:   4,
  })

  // Take the most recent event
  const latest = [...events].sort(
    (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)
  )[0]

  if (!latest) return []

  return latest.tags
    .filter(t => t[0] === 'server' && typeof t[1] === 'string')
    .map(t => t[1]!)
    .filter(isValidBlossomUrl)
}

/**
 * Sync the user's relay-side BUD-03 server list into local SQLite.
 *
 * Merges remote servers with existing local servers — servers already
 * present locally are not re-added. New servers are appended at lower
 * priority than existing ones.
 */
export async function syncServerListFromRelays(pubkey: string): Promise<number> {
  const relayUrls = await fetchServerListFromRelays(pubkey)
  if (relayUrls.length === 0) return 0

  const existing    = await getBlossomServers()
  const existingSet = new Set(existing.map(s => s.url))
  const now         = Math.floor(Date.now() / 1000)

  const added: BlossomServer[] = relayUrls
    .filter(url => !existingSet.has(url))
    .map((url, i) => ({
      url,
      priority: existing.length + i,
      addedAt:  now,
    }))

  if (added.length > 0) {
    await setBlossomServers([...existing, ...added])
  }

  return added.length
}

// ── Local → Relay ────────────────────────────────────────────

/**
 * Publish the current local server list to relays as a kind-10063 event.
 *
 * Replaces any existing server list event on the user's relays.
 * Requires a NIP-07 signer.
 */
export async function publishServerList(): Promise<void> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 browser extension.')
  }

  const servers = await getBlossomServers()

  const tags = await withOptionalClientTag(servers.map(s => ['server', s.url]))

  const blossomEvent = new NDKEvent(ndk)
  blossomEvent.kind = BLOSSOM_SERVER_LIST_KIND
  blossomEvent.content = ''
  blossomEvent.tags = tags

  await blossomEvent.sign()
  await blossomEvent.publish()

  const nip96Event = new NDKEvent(ndk)
  nip96Event.kind = NIP96_FILE_SERVER_LIST_KIND
  nip96Event.content = ''
  nip96Event.tags = tags

  await nip96Event.sign()
  await nip96Event.publish()
}

// ── Convenience Wrappers ─────────────────────────────────────

/**
 * Add a server to the local list and immediately publish to relays.
 * Validates the URL before adding.
 *
 * @throws if URL is invalid
 * @throws if publish fails (caller may retry)
 */
export async function addAndPublishServer(url: string): Promise<void> {
  if (!isValidBlossomUrl(url)) {
    throw new Error(`Invalid Blossom server URL: ${url}`)
  }
  await addBlossomServer(url)
  await publishServerList().catch(err => {
    console.warn('[Blossom] Server added locally but publish failed:', err)
  })
}
