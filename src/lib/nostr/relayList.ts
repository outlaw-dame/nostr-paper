import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { getDefaultRelayUrls, getCurrentUser, getNDK, getOutboxRelayUrls } from '@/lib/nostr/ndk'
import { getFreshNip51ListEvent } from '@/lib/nostr/lists'
import {
  getStoredRelayPreferences,
  normalizeRelayPreferences,
  type RelayPreference,
} from '@/lib/relay/relaySettings'
import { withRetry } from '@/lib/retry'
import { isValidRelayURL } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const RELAY_LIST_STALE_SECONDS = 15 * 60

function normalizeRelayUrls(relayUrls: readonly string[]): string[] {
  return [...new Set(relayUrls.filter(isValidRelayURL))]
}

function getDefaultRelayPreferences(): RelayPreference[] {
  return getDefaultRelayUrls().map(url => ({ url, read: true, write: true }))
}

function serializeRelayPreference(p: RelayPreference): string {
  return `${p.url}:${p.read ? 'r' : ''}${p.write ? 'w' : ''}`
}

export function relayListsAreEqual(
  a: readonly RelayPreference[],
  b: readonly RelayPreference[],
): boolean {
  if (a.length !== b.length) return false
  const setA = new Set(a.map(serializeRelayPreference))
  return b.every(p => setA.has(serializeRelayPreference(p)))
}

export function parseRelayListPreferences(event: Pick<NostrEvent, 'tags'> | null | undefined): RelayPreference[] {
  if (!event) return []

  return normalizeRelayPreferences(
    event.tags.map((tag) => {
      const [name, url, mode] = tag
      if (name !== 'r' || typeof url !== 'string') return null

      return {
        url,
        read: !mode || mode === 'read',
        write: !mode || mode === 'write',
      }
    }).filter((value): value is RelayPreference => value !== null),
  )
}

function buildRelayListTags(relayPreferences: readonly RelayPreference[]): string[][] {
  return relayPreferences.map((relayPreference) => {
    if (relayPreference.read && relayPreference.write) {
      return ['r', relayPreference.url]
    }

    return ['r', relayPreference.url, relayPreference.write ? 'write' : 'read']
  })
}

export function getEffectiveRelayListEntries(): RelayPreference[] {
  return normalizeRelayPreferences(getStoredRelayPreferences() ?? getDefaultRelayPreferences())
}

export function getEffectiveRelayListUrls(): string[] {
  return normalizeRelayUrls(getEffectiveRelayListEntries().map(({ url }) => url))
}

export async function syncCurrentUserRelayList(signal?: AbortSignal): Promise<NostrEvent | null> {
  const user = await getCurrentUser()
  if (!user) return null

  return getFreshNip51ListEvent(user.pubkey, Kind.RelayList, {
    maxAgeSeconds: RELAY_LIST_STALE_SECONDS,
    ...(signal ? { signal } : {}),
  })
}

export async function importCurrentUserRelayListPreferences(
  pubkeyOrSignal?: string | AbortSignal,
  maybeSignal?: AbortSignal,
): Promise<RelayPreference[]> {
  const explicitPubkey = typeof pubkeyOrSignal === 'string' ? pubkeyOrSignal : null
  const signal = pubkeyOrSignal instanceof AbortSignal ? pubkeyOrSignal : maybeSignal
  const user = explicitPubkey ? null : await getCurrentUser()
  const pubkey = explicitPubkey ?? user?.pubkey
  if (!pubkey) return []

  const relayList = await getFreshNip51ListEvent(pubkey, Kind.RelayList, {
    maxAgeSeconds: 0,
    ...(signal ? { signal } : {}),
  })

  return parseRelayListPreferences(relayList)
}

export async function publishCurrentUserRelayList(options: {
  relayPreferences?: readonly RelayPreference[]
  relayUrls?: readonly string[]
  publishRelayUrls?: readonly string[]
  force?: boolean
  signal?: AbortSignal
} = {}): Promise<NostrEvent | null> {
  const ndk = getNDK()
  if (!ndk.signer) return null

  const user = await getCurrentUser()
  if (!user) return null

  const relayPreferences = normalizeRelayPreferences(
    options.relayPreferences
      ?? options.relayUrls?.map(url => ({ url, read: true, write: true }))
      ?? getEffectiveRelayListEntries(),
  )

  if (relayPreferences.length === 0) {
    throw new Error('Relay list must contain at least one valid relay URL.')
  }

  // Skip publishing when explicit preferences are provided but are identical to the
  // currently stored list. Prevents noisy relay traffic from no-op saves.
  // When no explicit preferences are given, always publish (explicit republish intent).
  if (!options.force && (options.relayPreferences ?? options.relayUrls)) {
    const currentPreferences = normalizeRelayPreferences(getEffectiveRelayListEntries())
    if (relayListsAreEqual(relayPreferences, currentPreferences)) {
      return null
    }
  }

  const relayUrls = relayPreferences.map(({ url }) => url)
  const publishRelayUrls = normalizeRelayUrls([
    ...relayUrls,
    ...getOutboxRelayUrls(),
    ...(options.publishRelayUrls ?? []),
  ])
  const event = new NDKEvent(ndk)
  event.kind = Kind.RelayList
  event.content = ''
  event.tags = await withOptionalClientTag(
    buildRelayListTags(relayPreferences),
    options.signal,
  )

  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  await event.sign()

  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const relaySet = NDKRelaySet.fromRelayUrls(publishRelayUrls, ndk, true)

  await withRetry(
    async () => {
      if (options.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      await event.publish(relaySet)
    },
    {
      maxAttempts: 2,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  )

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}