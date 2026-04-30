import { NDKEvent, type NDKEvent as NDKFetchedEvent } from '@nostr-dev-kit/ndk'
import { getContactList, insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import {
  buildContactListTags,
  compareReplaceableEvents,
  normalizeContactPetname,
  normalizeContactRelayHint,
  parseContactListEvent,
  removeContactListEntry,
  upsertContactListEntry,
} from '@/lib/nostr/contactList'
import { getCurrentUser, getNDK } from '@/lib/nostr/ndk'
import { publishEventWithNip65Outbox } from '@/lib/nostr/outbox'
import { withRetry } from '@/lib/retry'
import { isValidHex32 } from '@/lib/security/sanitize'
import type { ContactList, NostrEvent } from '@/types'
import { Kind } from '@/types'

const CONTACT_LIST_STALE_SECONDS = 15 * 60
const CONTACT_FETCH_LIMIT = 8
const BULK_CONTACT_MUTATION_LIMIT = 256

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function pickNewestContactListEvent(events: Iterable<NDKFetchedEvent>): NostrEvent | null {
  const parsed = [...events]
    .map((event) => {
      const raw = event.rawEvent() as unknown as NostrEvent
      const contactList = parseContactListEvent(raw)
      return contactList ? { raw, contactList } : null
    })
    .filter((value): value is { raw: NostrEvent; contactList: NonNullable<ReturnType<typeof parseContactListEvent>> } => value !== null)
    .sort((a, b) => compareReplaceableEvents(
      { eventId: b.contactList.eventId, createdAt: b.contactList.createdAt },
      { eventId: a.contactList.eventId, createdAt: a.contactList.createdAt },
    ))

  return parsed[0]?.raw ?? null
}

async function loadEditableCurrentUserContactList(
  signal?: AbortSignal,
): Promise<{ pubkey: string; contactList: ContactList }> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('No signer available — install a NIP-07 extension to publish kind-3 contacts.')
  }

  const local = await getContactList(user.pubkey)

  try {
    const synced = await syncContactListFromRelays(user.pubkey, signal)
    if (synced) {
      return { pubkey: user.pubkey, contactList: synced }
    }
  } catch (error) {
    if (!local) throw error
  }

  if (local) {
    return { pubkey: user.pubkey, contactList: local }
  }

  return {
    pubkey: user.pubkey,
    contactList: {
      pubkey: user.pubkey,
      entries: [],
    },
  }
}

export async function syncContactListFromRelays(
  pubkey: string,
  signal?: AbortSignal,
): Promise<ContactList | null> {
  if (!isValidHex32(pubkey)) return null
  const local = await getContactList(pubkey)

  let ndk
  try {
    ndk = getNDK()
  } catch {
    return local
  }

  const newest = await withRetry(
    async () => {
      throwIfAborted(signal)

      const events = await ndk.fetchEvents({
        authors: [pubkey],
        kinds: [Kind.Contacts],
        limit: CONTACT_FETCH_LIMIT,
      })

      throwIfAborted(signal)
      return pickNewestContactListEvent(events)
    },
    {
      maxAttempts: 2,
      baseDelayMs: 1_000,
      maxDelayMs: 3_000,
      ...(signal ? { signal } : {}),
    },
  )

  if (!newest) return local

  await insertEvent(newest)
  return getContactList(pubkey)
}

export async function getFreshContactList(
  pubkey: string,
  options: {
    maxAgeSeconds?: number
    signal?: AbortSignal
  } = {},
): Promise<ContactList | null> {
  if (!isValidHex32(pubkey)) return null

  const local = await getContactList(pubkey)
  const maxAgeSeconds = options.maxAgeSeconds ?? CONTACT_LIST_STALE_SECONDS
  const now = Math.floor(Date.now() / 1000)

  if (local?.updatedAt !== undefined && now - local.updatedAt < maxAgeSeconds) {
    return local
  }

  try {
    const synced = await syncContactListFromRelays(pubkey, options.signal)
    return synced ?? local
  } catch {
    return local
  }
}

export async function syncCurrentUserContactList(signal?: AbortSignal): Promise<ContactList | null> {
  const user = await getCurrentUser()
  if (!user) return null
  return syncContactListFromRelays(user.pubkey, signal)
}

export async function publishContactList(
  entries: ReadonlyArray<ContactList['entries'][number]>,
  signal?: AbortSignal,
): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish kind-3 contacts.')
  }

  const event = new NDKEvent(ndk)
  event.kind = Kind.Contacts
  event.content = ''
  event.tags = await withOptionalClientTag(buildContactListTags([...entries]), signal)

  throwIfAborted(signal)
  await event.sign()
  throwIfAborted(signal)

  await publishEventWithNip65Outbox(event, signal)

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}

export async function saveCurrentUserContactEntry(
  pubkey: string,
  input: {
    relayUrl?: string | null
    petname?: string | null
  },
  signal?: AbortSignal,
): Promise<ContactList> {
  if (!isValidHex32(pubkey)) {
    throw new Error('Invalid pubkey for kind-3 contact list entry.')
  }

  const editable = await loadEditableCurrentUserContactList(signal)
  if (editable.pubkey === pubkey) {
    throw new Error('Refusing to publish a self-follow entry.')
  }

  const relayInput = input.relayUrl?.trim()
  const relayUrl = relayInput ? normalizeContactRelayHint(relayInput) : undefined
  const petname = normalizeContactPetname(input.petname)
  if (relayInput && !relayUrl) {
    throw new Error('Relay hint must be a valid ws:// or wss:// URL.')
  }

  const nextEntryInput: { pubkey: string; relayUrl?: string | null; petname?: string | null } = { pubkey }
  if (relayUrl !== undefined) nextEntryInput.relayUrl = relayUrl
  if (petname !== undefined) nextEntryInput.petname = petname

  const nextEntries = upsertContactListEntry(editable.contactList.entries, nextEntryInput)

  await publishContactList(nextEntries, signal)
  return (await getContactList(editable.pubkey)) ?? {
    pubkey: editable.pubkey,
    entries: nextEntries,
  }
}

export async function unfollowCurrentUserContact(
  pubkey: string,
  signal?: AbortSignal,
): Promise<ContactList> {
  if (!isValidHex32(pubkey)) {
    throw new Error('Invalid pubkey for kind-3 contact list entry.')
  }

  const editable = await loadEditableCurrentUserContactList(signal)
  const nextEntries = removeContactListEntry(editable.contactList.entries, pubkey)

  await publishContactList(nextEntries, signal)
  return (await getContactList(editable.pubkey)) ?? {
    pubkey: editable.pubkey,
    entries: nextEntries,
  }
}

export async function saveCurrentUserContactEntries(
  inputs: ReadonlyArray<{
    pubkey: string
    relayUrl?: string | null
    petname?: string | null
  }>,
  signal?: AbortSignal,
): Promise<ContactList> {
  const editable = await loadEditableCurrentUserContactList(signal)
  let nextEntries = [...editable.contactList.entries]
  let changed = false
  let applied = 0

  for (const input of inputs) {
    if (applied >= BULK_CONTACT_MUTATION_LIMIT) break
    if (!isValidHex32(input.pubkey)) continue
    if (input.pubkey === editable.pubkey) continue

    const previousLength = nextEntries.length
    const previousEntry = nextEntries.find((entry) => entry.pubkey === input.pubkey)
    nextEntries = upsertContactListEntry(nextEntries, input)
    const nextEntry = nextEntries.find((entry) => entry.pubkey === input.pubkey)

    const entryChanged = previousLength !== nextEntries.length
      || JSON.stringify(previousEntry ?? null) !== JSON.stringify(nextEntry ?? null)
    if (!entryChanged) continue

    changed = true
    applied += 1
  }

  if (!changed) {
    return editable.contactList
  }

  await publishContactList(nextEntries, signal)
  return (await getContactList(editable.pubkey)) ?? {
    pubkey: editable.pubkey,
    entries: nextEntries,
  }
}
