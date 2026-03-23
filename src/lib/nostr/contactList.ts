import {
  isValidHex32,
  isValidRelayURL,
  sanitizeName,
} from '@/lib/security/sanitize'
import type {
  ContactListEntry,
  NostrEvent,
} from '@/types'
import { Kind } from '@/types'

export interface ReplaceableEventCoordinate {
  eventId: string
  createdAt: number
}

export interface ParsedContactListEvent extends ReplaceableEventCoordinate {
  pubkey: string
  entries: ContactListEntry[]
}

export interface UpsertContactListEntryOptions {
  pubkey: string
  relayUrl?: string | null
  petname?: string | null
}

export function compareReplaceableEvents(
  a: ReplaceableEventCoordinate,
  b: ReplaceableEventCoordinate,
): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt
  }
  if (a.eventId === b.eventId) return 0
  return a.eventId > b.eventId ? 1 : -1
}

export function isNewerReplaceableEvent(
  candidate: ReplaceableEventCoordinate,
  current: ReplaceableEventCoordinate | null,
): boolean {
  return current === null || compareReplaceableEvents(candidate, current) > 0
}

export function normalizeContactRelayHint(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (!isValidRelayURL(trimmed)) return undefined

  try {
    const normalized = new URL(trimmed)
    normalized.hash = ''
    normalized.username = ''
    normalized.password = ''

    if (
      (normalized.protocol === 'wss:' && normalized.port === '443') ||
      (normalized.protocol === 'ws:' && normalized.port === '80')
    ) {
      normalized.port = ''
    }

    return normalized.toString()
  } catch {
    return undefined
  }
}

export function normalizeContactPetname(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined

  const sanitized = sanitizeName(value).trim()
  return sanitized.length > 0 ? sanitized : undefined
}

export function normalizeContactListEntry(
  input: UpsertContactListEntryOptions & { position?: number | null },
): ContactListEntry | null {
  if (!isValidHex32(input.pubkey)) return null

  const relayUrl = normalizeContactRelayHint(input.relayUrl)
  const petname = normalizeContactPetname(input.petname)
  const position = Number.isSafeInteger(input.position) && (input.position ?? 0) >= 0
    ? input.position!
    : 0

  return {
    pubkey: input.pubkey,
    position,
    ...(relayUrl ? { relayUrl } : {}),
    ...(petname ? { petname } : {}),
  }
}

export function parseContactListEvent(event: NostrEvent): ParsedContactListEvent | null {
  if (event.kind !== Kind.Contacts) return null

  const deduped = new Map<string, ContactListEntry>()

  for (let index = 0; index < event.tags.length; index++) {
    const tag = event.tags[index]
    if (!tag || tag[0] !== 'p') continue

    const normalized = normalizeContactListEntry({
      pubkey: tag[1] ?? '',
      position: index,
      ...(tag[2] !== undefined ? { relayUrl: tag[2] } : {}),
      ...(tag[3] !== undefined ? { petname: tag[3] } : {}),
    })
    if (!normalized) continue

    // Keep the last valid occurrence if a malformed event duplicates a pubkey.
    deduped.set(normalized.pubkey, normalized)
  }

  return {
    pubkey: event.pubkey,
    eventId: event.id,
    createdAt: event.created_at,
    entries: [...deduped.values()].sort((a, b) =>
      a.position - b.position || a.pubkey.localeCompare(b.pubkey)
    ),
  }
}

export function buildContactListTags(entries: ReadonlyArray<ContactListEntry>): string[][] {
  return [...entries]
    .sort((a, b) => a.position - b.position || a.pubkey.localeCompare(b.pubkey))
    .flatMap((entry) => {
      const normalized = normalizeContactListEntry(entry)
      if (!normalized) return []

      const tag = ['p', normalized.pubkey]
      if (normalized.relayUrl || normalized.petname) {
        tag.push(normalized.relayUrl ?? '')
      }
      if (normalized.petname) {
        tag.push(normalized.petname)
      }
      return [tag]
    })
}

export function upsertContactListEntry(
  entries: ReadonlyArray<ContactListEntry>,
  input: UpsertContactListEntryOptions,
): ContactListEntry[] {
  const relayUrl = input.relayUrl === undefined
    ? undefined
    : normalizeContactRelayHint(input.relayUrl)
  const petname = input.petname === undefined
    ? undefined
    : normalizeContactPetname(input.petname)

  const existing = entries.find(entry => entry.pubkey === input.pubkey)
  const nextPosition = existing
    ? existing.position
    : entries.reduce((max, entry) => Math.max(max, entry.position), -1) + 1

  const normalized = normalizeContactListEntry({
    pubkey: input.pubkey,
    position: nextPosition,
    ...(relayUrl !== undefined ? { relayUrl } : {}),
    ...(petname !== undefined ? { petname } : {}),
  })
  if (!normalized) {
    throw new Error('Invalid pubkey for kind-3 contact list entry.')
  }

  const withoutExisting = entries.filter(entry => entry.pubkey !== input.pubkey)
  return [...withoutExisting, normalized].sort((a, b) =>
    a.position - b.position || a.pubkey.localeCompare(b.pubkey)
  )
}

export function removeContactListEntry(
  entries: ReadonlyArray<ContactListEntry>,
  pubkey: string,
): ContactListEntry[] {
  return entries.filter(entry => entry.pubkey !== pubkey)
}
