import { NDKEvent, type NDKFilter, type NDKEvent as NDKFetchedEvent } from '@nostr-dev-kit/ndk'
import { naddrEncode } from 'nostr-tools/nip19'
import { getLatestAddressableEvent, insertEvent, queryEvents } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { getEventAddressCoordinate, normalizeAddressIdentifier, parseAddressCoordinate } from '@/lib/nostr/addressable'
import { compareReplaceableEvents } from '@/lib/nostr/contactList'
import { parseLongFormEvent } from '@/lib/nostr/longForm'
import { getCurrentUser, getNDK } from '@/lib/nostr/ndk'
import { decryptNip04, hasNip04Support } from '@/lib/nostr/nip04'
import { decryptNip44, encryptNip44, hasNip44Support } from '@/lib/nostr/nip44'
import { withRetry } from '@/lib/retry'
import {
  isSafeMediaURL,
  isSafeURL,
  isValidHex32,
  isValidRelayURL,
  normalizeHashtag,
  sanitizeName,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const LIST_STALE_SECONDS = 15 * 60
const LIST_FETCH_LIMIT = 12
const LIST_COLLECTION_FETCH_LIMIT = 24
const LIST_TITLE_CHARS = 160
const LIST_DESCRIPTION_CHARS = 1024
const LIST_ITEM_VALUE_CHARS = 2048
const LIST_GENERIC_VALUE_CHARS = 512
const LIST_GROUP_ID_CHARS = 256
const LIST_SHORTCODE_CHARS = 64
const LIST_PETNAME_CHARS = 64
const LIST_WORD_CHARS = 128
const MAX_PUBLIC_ITEMS = 512
const MAX_PRIVATE_ITEMS = 512
const LIST_TAG_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/i
const LIST_RESERVED_TAGS = new Set(['d', 'title', 'image', 'description', 'client'])
const TAG_NAMES_SIMPLE_GROUPS = ['group', 'r'] as const

export interface Nip51ListDefinition {
  kind: number
  name: string
  description: string
  addressable: boolean
  expectedTagNames: string[]
  identifierRule?: 'required' | 'kind-string'
}

export interface Nip51ListItem {
  tagName: string
  values: string[]
  isPrivate?: boolean
}

export interface ParsedNip51ListEvent {
  id: string
  pubkey: string
  createdAt: number
  kind: number
  definition: Nip51ListDefinition
  identifier?: string
  title?: string
  description?: string
  image?: string
  naddr?: string
  route: string
  publicItems: Nip51ListItem[]
  hasPrivateItems: boolean
  privateEncryption?: 'nip44' | 'nip04'
}

export interface PublishNip51ListOptions {
  kind: number
  identifier?: string
  title?: string
  description?: string
  image?: string
  publicItems?: Nip51ListItem[]
  privateItems?: Nip51ListItem[]
  preservedPrivateContent?: string
  signal?: AbortSignal
}

export interface ToggleBookmarkResult {
  event: NostrEvent
  bookmarked: boolean
}

const NIP51_LIST_DEFINITIONS: Nip51ListDefinition[] = [
  {
    kind: Kind.Contacts,
    name: 'Follow List',
    description: 'Microblogging follow list.',
    addressable: false,
    expectedTagNames: ['p'],
  },
  {
    kind: Kind.MuteList,
    name: 'Mute List',
    description: 'Profiles, hashtags, words, and threads the user does not want to see.',
    addressable: false,
    expectedTagNames: ['p', 't', 'word', 'e'],
  },
  {
    kind: Kind.PinnedNotes,
    name: 'Pinned Notes',
    description: 'Notes the user wants to showcase.',
    addressable: false,
    expectedTagNames: ['e'],
  },
  {
    kind: Kind.RelayList,
    name: 'Read/Write Relays',
    description: 'Relays where the user writes and expects mentions.',
    addressable: false,
    expectedTagNames: ['r'],
  },
  {
    kind: Kind.Bookmarks,
    name: 'Bookmarks',
    description: 'Global uncategorized bookmarks.',
    addressable: false,
    expectedTagNames: ['e', 'a'],
  },
  {
    kind: Kind.CommunitiesList,
    name: 'Communities',
    description: 'Communities the user belongs to.',
    addressable: false,
    expectedTagNames: ['a'],
  },
  {
    kind: Kind.PublicChatsList,
    name: 'Public Chats',
    description: 'Public chat channels the user is in.',
    addressable: false,
    expectedTagNames: ['e'],
  },
  {
    kind: Kind.BlockedRelays,
    name: 'Blocked Relays',
    description: 'Relays the client should never connect to.',
    addressable: false,
    expectedTagNames: ['relay'],
  },
  {
    kind: Kind.SearchRelays,
    name: 'Search Relays',
    description: 'Relays the client should use for search queries.',
    addressable: false,
    expectedTagNames: ['relay'],
  },
  {
    kind: Kind.SimpleGroupsList,
    name: 'Simple Groups',
    description: 'NIP-29 groups and relays the user is in.',
    addressable: false,
    expectedTagNames: [...TAG_NAMES_SIMPLE_GROUPS],
  },
  {
    kind: Kind.RelayFeeds,
    name: 'Relay Feeds',
    description: 'Favorite browsable relays and relay sets.',
    addressable: false,
    expectedTagNames: ['relay', 'a'],
  },
  {
    kind: Kind.InterestsList,
    name: 'Interests',
    description: 'Topics and related interest sets.',
    addressable: false,
    expectedTagNames: ['t', 'a'],
  },
  {
    kind: Kind.MediaFollows,
    name: 'Media Follows',
    description: 'Multimedia follow list.',
    addressable: false,
    expectedTagNames: ['p'],
  },
  {
    kind: Kind.EmojisList,
    name: 'Emojis',
    description: 'Preferred emojis and emoji-set pointers.',
    addressable: false,
    expectedTagNames: ['emoji', 'a'],
  },
  {
    kind: Kind.DmRelays,
    name: 'DM Relays',
    description: 'Relays where the user receives direct messages.',
    addressable: false,
    expectedTagNames: ['relay'],
  },
  {
    kind: Kind.GoodWikiAuthors,
    name: 'Good Wiki Authors',
    description: 'Recommended wiki authors.',
    addressable: false,
    expectedTagNames: ['p'],
  },
  {
    kind: Kind.GoodWikiRelays,
    name: 'Good Wiki Relays',
    description: 'Relays deemed to host useful wiki articles.',
    addressable: false,
    expectedTagNames: ['relay'],
  },
  {
    kind: Kind.FollowSet,
    name: 'Follow Set',
    description: 'Categorized set of followed profiles.',
    addressable: true,
    expectedTagNames: ['p'],
    identifierRule: 'required',
  },
  {
    kind: Kind.RelaySet,
    name: 'Relay Set',
    description: 'User-defined relay group.',
    addressable: true,
    expectedTagNames: ['relay'],
    identifierRule: 'required',
  },
  {
    kind: Kind.BookmarkSet,
    name: 'Bookmark Set',
    description: 'Categorized bookmarks collection.',
    addressable: true,
    expectedTagNames: ['e', 'a'],
    identifierRule: 'required',
  },
  {
    kind: Kind.ArticleCurationSet,
    name: 'Article Curation Set',
    description: 'Collection of articles and notes.',
    addressable: true,
    expectedTagNames: ['a', 'e'],
    identifierRule: 'required',
  },
  {
    kind: Kind.VideoCurationSet,
    name: 'Video Curation Set',
    description: 'Collection of videos.',
    addressable: true,
    expectedTagNames: ['e'],
    identifierRule: 'required',
  },
  {
    kind: Kind.PictureCurationSet,
    name: 'Picture Curation Set',
    description: 'Collection of pictures.',
    addressable: true,
    expectedTagNames: ['e'],
    identifierRule: 'required',
  },
  {
    kind: Kind.KindMuteSet,
    name: 'Kind Mute Set',
    description: 'Profiles muted for a specific kind.',
    addressable: true,
    expectedTagNames: ['p'],
    identifierRule: 'kind-string',
  },
  {
    kind: Kind.InterestSet,
    name: 'Interest Set',
    description: 'Set of hashtags for a topic.',
    addressable: true,
    expectedTagNames: ['t'],
    identifierRule: 'required',
  },
  {
    kind: Kind.EmojiSet,
    name: 'Emoji Set',
    description: 'Categorized emoji group.',
    addressable: true,
    expectedTagNames: ['emoji'],
    identifierRule: 'required',
  },
  {
    kind: Kind.ReleaseArtifactSet,
    name: 'Release Artifact Set',
    description: 'Artifacts for a software release.',
    addressable: true,
    expectedTagNames: ['e', 'a'],
    identifierRule: 'required',
  },
  {
    kind: Kind.AppCurationSet,
    name: 'App Curation Set',
    description: 'Collection of software applications.',
    addressable: true,
    expectedTagNames: ['a'],
    identifierRule: 'required',
  },
  {
    kind: Kind.CalendarSet,
    name: 'Calendar',
    description: 'Set of calendar events.',
    addressable: true,
    expectedTagNames: ['a'],
    identifierRule: 'required',
  },
  {
    kind: Kind.StarterPack,
    name: 'Starter Pack',
    description: 'Named set of profiles to follow together.',
    addressable: true,
    expectedTagNames: ['p'],
    identifierRule: 'required',
  },
  {
    kind: Kind.MediaStarterPack,
    name: 'Media Starter Pack',
    description: 'Named set of multimedia-focused profiles.',
    addressable: true,
    expectedTagNames: ['p'],
    identifierRule: 'required',
  },
] as const

const NIP51_LIST_DEFINITION_BY_KIND = new Map<number, Nip51ListDefinition>(
  NIP51_LIST_DEFINITIONS.map((definition) => [definition.kind, definition]),
)

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function normalizeRelayUrl(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!isValidRelayURL(trimmed)) return undefined

  try {
    const normalized = new URL(trimmed)
    normalized.hash = ''
    normalized.username = ''
    normalized.password = ''
    if (
      (normalized.protocol === 'wss:' && normalized.port === '443')
      || (normalized.protocol === 'ws:' && normalized.port === '80')
    ) {
      normalized.port = ''
    }
    return normalized.toString()
  } catch {
    return undefined
  }
}

function sanitizeValue(value: string | undefined, maxChars = LIST_GENERIC_VALUE_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = sanitizeText(value).replace(/\r\n?/g, '\n').trim().slice(0, maxChars)
  return normalized.length > 0 ? normalized : undefined
}

function sanitizeOptionalName(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = sanitizeName(value).trim().slice(0, LIST_PETNAME_CHARS)
  return normalized.length > 0 ? normalized : undefined
}

function normalizeListTagName(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!LIST_TAG_NAME_PATTERN.test(normalized)) return null
  return normalized
}

function normalizeShortcode(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = sanitizeText(value).trim().replace(/^:+|:+$/g, '').slice(0, LIST_SHORTCODE_CHARS)
  return normalized.length > 0 ? normalized : undefined
}

function normalizeWord(value: string | undefined): string | undefined {
  const normalized = sanitizeValue(value, LIST_WORD_CHARS)?.toLowerCase()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function normalizeGroupId(value: string | undefined): string | undefined {
  return sanitizeValue(value, LIST_GROUP_ID_CHARS)
}

function normalizeListMetadataTitle(value: string | undefined): string | undefined {
  return sanitizeValue(value, LIST_TITLE_CHARS)
}

function normalizeListMetadataDescription(value: string | undefined): string | undefined {
  return sanitizeValue(value, LIST_DESCRIPTION_CHARS)
}

function normalizeListMetadataImage(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return isSafeMediaURL(trimmed) ? trimmed : undefined
}

function normalizeRelayMarker(value: string | undefined): string | undefined {
  const normalized = sanitizeValue(value, 16)?.toLowerCase()
  if (!normalized) return undefined
  return normalized === 'read' || normalized === 'write' ? normalized : undefined
}

function normalizeListItem(
  tagName: string,
  values: string[],
): Nip51ListItem | null {
  const name = normalizeListTagName(tagName)
  if (!name || values.length === 0) return null

  switch (name) {
    case 'p': {
      const pubkey = typeof values[0] === 'string' ? values[0].trim() : ''
      if (!isValidHex32(pubkey)) return null
      const relayUrl = normalizeRelayUrl(values[1])
      const petname = sanitizeOptionalName(values[2])
      const nextValues: string[] = [pubkey]
      if (relayUrl || petname) nextValues.push(relayUrl ?? '')
      if (petname) nextValues.push(petname)
      return { tagName: name, values: nextValues }
    }

    case 'e': {
      const eventId = typeof values[0] === 'string' ? values[0].trim() : ''
      if (!isValidHex32(eventId)) return null
      const relayUrl = normalizeRelayUrl(values[1])
      const third = sanitizeValue(values[2], 128)
      const nextValues: string[] = [eventId]
      if (relayUrl || third) nextValues.push(relayUrl ?? '')
      if (third) nextValues.push(third)
      return { tagName: name, values: nextValues }
    }

    case 'a': {
      const coordinate = typeof values[0] === 'string' ? values[0].trim() : ''
      if (!parseAddressCoordinate(coordinate)) return null
      return { tagName: name, values: [coordinate] }
    }

    case 'relay':
    case 'r': {
      const relayUrl = normalizeRelayUrl(values[0])
      if (!relayUrl) return null
      const marker = normalizeRelayMarker(values[1]) ?? sanitizeValue(values[1], 64)
      const nextValues = [relayUrl]
      if (marker) nextValues.push(marker)
      return { tagName: name, values: nextValues }
    }

    case 't': {
      const hashtag = normalizeHashtag(values[0] ?? '')
      return hashtag ? { tagName: name, values: [hashtag] } : null
    }

    case 'word': {
      const word = normalizeWord(values[0])
      return word ? { tagName: name, values: [word] } : null
    }

    case 'group': {
      const groupId = normalizeGroupId(values[0])
      const relayUrl = normalizeRelayUrl(values[1])
      const label = sanitizeValue(values[2], LIST_TITLE_CHARS)
      if (!groupId || !relayUrl) return null
      const nextValues = [groupId, relayUrl]
      if (label) nextValues.push(label)
      return { tagName: name, values: nextValues }
    }

    case 'emoji': {
      const shortcode = normalizeShortcode(values[0])
      const imageUrl = normalizeListMetadataImage(values[1]) ?? (isSafeURL(values[1] ?? '') ? values[1]!.trim() : undefined)
      if (!shortcode || !imageUrl) return null
      return { tagName: name, values: [shortcode, imageUrl] }
    }

    default: {
      const normalizedValues = values
        .map((value, index) => sanitizeValue(value, index === 0 ? LIST_ITEM_VALUE_CHARS : LIST_GENERIC_VALUE_CHARS))
        .filter((value): value is string => value !== undefined)
      return normalizedValues.length > 0 ? { tagName: name, values: normalizedValues } : null
    }
  }
}

function parseListItemTag(tag: string[]): Nip51ListItem | null {
  const tagName = tag[0]
  if (!tagName || LIST_RESERVED_TAGS.has(tagName)) return null
  return normalizeListItem(tagName, tag.slice(1))
}

function isAllowedAddressItemForDefinition(
  definition: Nip51ListDefinition,
  item: Nip51ListItem,
): boolean {
  if (item.tagName !== 'a') return true

  const coordinate = item.values[0]
  if (!coordinate) return false

  const parsed = parseAddressCoordinate(coordinate)
  if (!parsed) return false

  switch (definition.kind) {
    case Kind.Bookmarks:
    case Kind.BookmarkSet:
    case Kind.ArticleCurationSet:
      return parsed.kind === Kind.LongFormContent
    case Kind.AppCurationSet:
      return parsed.kind === Kind.SoftwareApplication
    default:
      return true
  }
}

function isAllowedListItemForDefinition(
  definition: Nip51ListDefinition,
  item: Nip51ListItem,
): boolean {
  if (!definition.expectedTagNames.includes(item.tagName)) return false
  return isAllowedAddressItemForDefinition(definition, item)
}

function buildTagFromListItem(item: Nip51ListItem): string[] {
  return [item.tagName, ...item.values]
}

function detectPrivateListEncryption(content: string): 'nip44' | 'nip04' {
  return content.includes('iv=') || content.includes('?iv=') ? 'nip04' : 'nip44'
}

function getListDefinition(kind: number): Nip51ListDefinition | null {
  return NIP51_LIST_DEFINITION_BY_KIND.get(kind) ?? null
}

function getAddressRoute(kind: number, pubkey: string, identifier: string): string {
  try {
    const naddr = naddrEncode({ kind, pubkey, identifier })
    return `/a/${naddr}`
  } catch {
    return ''
  }
}

function getListMetadataTag(event: NostrEvent, tagName: 'title' | 'image' | 'description'): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== tagName) continue

    switch (tagName) {
      case 'title':
        return normalizeListMetadataTitle(tag[1]) ?? undefined
      case 'description':
        return normalizeListMetadataDescription(tag[1]) ?? undefined
      case 'image':
        return normalizeListMetadataImage(tag[1]) ?? undefined
    }
  }
  return undefined
}

function getListIdentifier(event: NostrEvent, definition: Nip51ListDefinition): string | undefined {
  if (!definition.addressable) return undefined

  for (const tag of event.tags) {
    if (tag[0] !== 'd') continue
    const identifier = normalizeAddressIdentifier(tag[1] ?? '')
    if (!identifier) continue
    return identifier
  }

  return undefined
}

function parsePublicItems(event: NostrEvent, definition: Nip51ListDefinition): Nip51ListItem[] {
  const items: Nip51ListItem[] = []

  for (const tag of event.tags) {
    const item = parseListItemTag(tag)
    if (!item) continue
    if (!isAllowedListItemForDefinition(definition, item)) continue
    items.push(item)
    if (items.length >= MAX_PUBLIC_ITEMS) break
  }

  return items
}

function parsePrivateItemsPayload(
  payload: string,
  definition: Nip51ListDefinition,
): Nip51ListItem[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }

  if (!Array.isArray(parsed)) return null

  const items: Nip51ListItem[] = []
  for (const rawTag of parsed) {
    if (!Array.isArray(rawTag) || rawTag.some((value) => typeof value !== 'string')) {
      return null
    }

    const item = parseListItemTag(rawTag as string[])
    if (!item) continue
    if (!isAllowedListItemForDefinition(definition, item)) continue
    items.push({ ...item, isPrivate: true })
    if (items.length >= MAX_PRIVATE_ITEMS) break
  }

  return items
}

async function pickNewestStandardListEvent(events: Iterable<NDKFetchedEvent>): Promise<NostrEvent | null> {
  const parsed = [...events]
    .map((event) => event.rawEvent() as unknown as NostrEvent)
    .filter((event) => getListDefinition(event.kind) !== null)
    .sort((left, right) => compareReplaceableEvents(
      { eventId: right.id, createdAt: right.created_at },
      { eventId: left.id, createdAt: left.created_at },
    ))

  return parsed[0] ?? null
}

export function getNip51ListDefinitions(): readonly Nip51ListDefinition[] {
  return NIP51_LIST_DEFINITIONS
}

export function isNip51ListKind(kind: number): boolean {
  return getListDefinition(kind) !== null
}

export function isNip51AddressableListKind(kind: number): boolean {
  return getListDefinition(kind)?.addressable === true
}

export function getNip51ListDefinition(kind: number): Nip51ListDefinition | null {
  return getListDefinition(kind)
}

export function getNip51ListLabel(kind: number): string {
  return getListDefinition(kind)?.name ?? `Kind ${kind} List`
}

export function isNip51ProfilePackKind(kind: number): boolean {
  return kind === Kind.FollowSet
    || kind === Kind.StarterPack
    || kind === Kind.MediaStarterPack
}

export function parseNip51ListEvent(event: NostrEvent): ParsedNip51ListEvent | null {
  const definition = getListDefinition(event.kind)
  if (!definition) return null

  const identifier = getListIdentifier(event, definition)
  if (definition.addressable && !identifier) return null
  if (definition.identifierRule === 'kind-string' && identifier && !/^\d{1,10}$/.test(identifier)) {
    return null
  }

  const route = identifier
    ? getAddressRoute(event.kind, event.pubkey, identifier)
    : `/note/${event.id}`
  const title = getListMetadataTag(event, 'title')
  const description = getListMetadataTag(event, 'description')
  const image = getListMetadataTag(event, 'image')

  const parsed: ParsedNip51ListEvent = {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    kind: event.kind,
    definition,
    ...(identifier ? { identifier } : {}),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(identifier
      ? (() => {
        try {
          return { naddr: naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier }) }
        } catch {
          return {}
        }
      })()
      : {}),
    route: route || `/note/${event.id}`,
    publicItems: parsePublicItems(event, definition),
    hasPrivateItems: event.content.trim().length > 0,
    ...(event.content.trim().length > 0 ? { privateEncryption: detectPrivateListEncryption(event.content) } : {}),
  }

  return parsed
}

export function canDecryptNip51PrivateItems(
  event: NostrEvent,
  viewerPubkey: string | null | undefined,
): boolean {
  if (viewerPubkey !== event.pubkey || event.content.trim().length === 0) return false
  const encryption = detectPrivateListEncryption(event.content)
  return encryption === 'nip44' ? hasNip44Support() : hasNip04Support()
}

export async function decryptNip51PrivateItems(
  event: NostrEvent,
  viewerPubkey: string | null | undefined,
): Promise<Nip51ListItem[]> {
  if (viewerPubkey !== event.pubkey) {
    throw new Error('Private NIP-51 items can only be decrypted by the list author.')
  }

  const payload = event.content.trim()
  if (!payload) return []

  const encryption = detectPrivateListEncryption(payload)
  const plaintext = encryption === 'nip44'
    ? await decryptNip44(event.pubkey, payload)
    : await decryptNip04(event.pubkey, payload)
  const parsed = parseNip51ListEvent(event)
  if (!parsed) {
    throw new Error('Event is not a supported NIP-51 list.')
  }
  const items = parsePrivateItemsPayload(plaintext, parsed.definition)
  if (!items) {
    throw new Error('Decrypted private list payload is not a valid tag array.')
  }
  return items
}

function buildMetadataTags(options: PublishNip51ListOptions, definition: Nip51ListDefinition): string[][] {
  if (!definition.addressable) return []

  const identifier = normalizeAddressIdentifier(options.identifier ?? '')
  if (!identifier) {
    throw new Error(`${definition.name} requires a non-empty "d" identifier.`)
  }
  if (definition.identifierRule === 'kind-string' && !/^\d{1,10}$/.test(identifier)) {
    throw new Error(`${definition.name} requires a numeric "d" identifier naming the muted kind.`)
  }

  const title = normalizeListMetadataTitle(options.title)
  const description = normalizeListMetadataDescription(options.description)
  const image = normalizeListMetadataImage(options.image)

  return [
    ['d', identifier],
    ...(title ? [['title', title]] : []),
    ...(image ? [['image', image]] : []),
    ...(description ? [['description', description]] : []),
  ]
}

function normalizePublishItems(
  definition: Nip51ListDefinition,
  items: Nip51ListItem[] | undefined,
  maxItems: number,
  markPrivate: boolean,
): Nip51ListItem[] {
  if (!Array.isArray(items) || items.length === 0) return []

  const normalized: Nip51ListItem[] = []
  for (const item of items) {
    const candidate = normalizeListItem(item.tagName, item.values)
    if (!candidate) continue
    if (!isAllowedListItemForDefinition(definition, candidate)) continue
    normalized.push(markPrivate ? { ...candidate, isPrivate: true } : candidate)
    if (normalized.length >= maxItems) break
  }
  return normalized
}

function serializePrivateItems(items: Nip51ListItem[]): string {
  return JSON.stringify(items.map((item) => buildTagFromListItem(item)))
}

export async function publishNip51List(options: PublishNip51ListOptions): Promise<NostrEvent> {
  const definition = getListDefinition(options.kind)
  if (!definition) {
    throw new Error('Unsupported NIP-51 list kind.')
  }

  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install and unlock a NIP-07 extension to publish NIP-51 lists.')
  }

  const currentUser = await getCurrentUser()
  if (!currentUser) {
    throw new Error('No signer available — install and unlock a NIP-07 extension to publish NIP-51 lists.')
  }

  const publicItems = normalizePublishItems(definition, options.publicItems, MAX_PUBLIC_ITEMS, false)
  const privateItems = normalizePublishItems(definition, options.privateItems, MAX_PRIVATE_ITEMS, true)

  let content = ''
  if (privateItems.length > 0) {
    content = await encryptNip44(currentUser.pubkey, serializePrivateItems(privateItems))
  } else if (typeof options.preservedPrivateContent === 'string' && options.preservedPrivateContent.trim().length > 0) {
    content = options.preservedPrivateContent.trim()
  }

  const tags = [
    ...buildMetadataTags(options, definition),
    ...publicItems.map((item) => buildTagFromListItem(item)),
  ]

  const event = new NDKEvent(ndk)
  event.kind = options.kind
  event.content = content
  event.tags = await withOptionalClientTag(tags, options.signal)

  throwIfAborted(options.signal)
  await event.sign()
  throwIfAborted(options.signal)

  await withRetry(
    async () => {
      throwIfAborted(options.signal)
      await event.publish()
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

export async function getLatestLocalNip51ListEvent(
  pubkey: string,
  kind: number,
  identifier?: string,
): Promise<NostrEvent | null> {
  const definition = getListDefinition(kind)
  if (!definition || !isValidHex32(pubkey)) return null

  if (definition.addressable) {
    const normalizedIdentifier = normalizeAddressIdentifier(identifier ?? '')
    if (!normalizedIdentifier) return null
    return getLatestAddressableEvent(pubkey, kind, normalizedIdentifier)
  }

  const events = await queryEvents({
    authors: [pubkey],
    kinds: [kind],
    limit: 1,
  })

  return events[0] ?? null
}

export async function syncNip51ListFromRelays(
  pubkey: string,
  kind: number,
  options: {
    identifier?: string
    signal?: AbortSignal
  } = {},
): Promise<NostrEvent | null> {
  const definition = getListDefinition(kind)
  if (!definition || !isValidHex32(pubkey)) return null

  let ndk
  try {
    ndk = getNDK()
  } catch {
    return getLatestLocalNip51ListEvent(pubkey, kind, options.identifier)
  }

  const filter: NDKFilter = definition.addressable
    ? {
      authors: [pubkey],
      kinds: [kind],
      '#d': [normalizeAddressIdentifier(options.identifier ?? '') ?? ''],
      limit: LIST_FETCH_LIMIT,
    }
    : {
      authors: [pubkey],
      kinds: [kind],
      limit: LIST_FETCH_LIMIT,
    }

  const newest = await withRetry(
    async () => {
      throwIfAborted(options.signal)
      const events = await ndk.fetchEvents(filter)
      throwIfAborted(options.signal)
      return definition.addressable
        ? ([...events]
          .map((event) => event.rawEvent() as unknown as NostrEvent)
          .sort((left, right) => compareReplaceableEvents(
            { eventId: right.id, createdAt: right.created_at },
            { eventId: left.id, createdAt: left.created_at },
          ))[0] ?? null)
        : await pickNewestStandardListEvent(events)
    },
    {
      maxAttempts: 2,
      baseDelayMs: 1_000,
      maxDelayMs: 3_000,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  )

  if (!newest) {
    return getLatestLocalNip51ListEvent(pubkey, kind, options.identifier)
  }

  await insertEvent(newest)
  return getLatestLocalNip51ListEvent(pubkey, kind, options.identifier)
}

export async function getFreshNip51ListEvent(
  pubkey: string,
  kind: number,
  options: {
    identifier?: string
    maxAgeSeconds?: number
    signal?: AbortSignal
  } = {},
): Promise<NostrEvent | null> {
  const local = await getLatestLocalNip51ListEvent(pubkey, kind, options.identifier)
  const maxAgeSeconds = options.maxAgeSeconds ?? LIST_STALE_SECONDS
  const now = Math.floor(Date.now() / 1000)

  if (local && now - local.created_at < maxAgeSeconds) {
    return local
  }

  try {
    const synced = await syncNip51ListFromRelays(pubkey, kind, {
      ...(options.identifier ? { identifier: options.identifier } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    return synced ?? local
  } catch {
    return local
  }
}

function compareParsedListEvents(left: ParsedNip51ListEvent, right: ParsedNip51ListEvent): number {
  return compareReplaceableEvents(
    { eventId: right.id, createdAt: right.createdAt },
    { eventId: left.id, createdAt: left.createdAt },
  )
}

function dedupeLatestParsedLists(
  events: ParsedNip51ListEvent[],
): ParsedNip51ListEvent[] {
  const sorted = [...events].sort(compareParsedListEvents)
  const deduped: ParsedNip51ListEvent[] = []
  const seen = new Set<string>()

  for (const event of sorted) {
    const key = event.definition.addressable
      ? `${event.kind}:${event.pubkey}:${event.identifier ?? ''}`
      : `${event.kind}:${event.pubkey}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(event)
  }

  return deduped
}

export async function getFreshNip51ListEvents(
  pubkey: string,
  kind: number,
  options: {
    signal?: AbortSignal
    limit?: number
  } = {},
): Promise<ParsedNip51ListEvent[]> {
  const definition = getListDefinition(kind)
  if (!definition || !isValidHex32(pubkey)) return []

  const limit = Math.min(options.limit ?? LIST_COLLECTION_FETCH_LIMIT, LIST_COLLECTION_FETCH_LIMIT)

  const loadLocal = async () => dedupeLatestParsedLists(
    (await queryEvents({
      authors: [pubkey],
      kinds: [kind],
      limit,
    }))
      .map(parseNip51ListEvent)
      .filter((value): value is ParsedNip51ListEvent => value !== null),
  )

  const local = await loadLocal()

  let ndk
  try {
    ndk = getNDK()
  } catch {
    return local
  }

  try {
    await withRetry(
      async () => {
        throwIfAborted(options.signal)
        await ndk.fetchEvents({
          authors: [pubkey],
          kinds: [kind],
          limit,
        })
        throwIfAborted(options.signal)
      },
      {
        maxAttempts: 2,
        baseDelayMs: 1_000,
        maxDelayMs: 3_000,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    )
    return loadLocal()
  } catch {
    return local
  }
}

function getBookmarkTargetItem(event: NostrEvent): Nip51ListItem | null {
  if (event.kind === Kind.ShortNote) {
    return { tagName: 'e', values: [event.id] }
  }

  const article = parseLongFormEvent(event)
  if (article) {
    const coordinate = getEventAddressCoordinate(event)
    return coordinate ? { tagName: 'a', values: [coordinate] } : null
  }

  return null
}

function areListItemsEqual(left: Nip51ListItem, right: Nip51ListItem): boolean {
  return left.tagName === right.tagName
    && left.values.length === right.values.length
    && left.values.every((value, index) => value === right.values[index])
}

export function canBookmarkEvent(event: NostrEvent): boolean {
  return getBookmarkTargetItem(event) !== null
}

export function isEventInBookmarkList(
  event: NostrEvent,
  listEvent: NostrEvent | null | undefined,
): boolean {
  if (!listEvent) return false
  const list = parseNip51ListEvent(listEvent)
  const target = getBookmarkTargetItem(event)
  if (!list || !target) return false
  return list.publicItems.some((item) => areListItemsEqual(item, target))
}

export async function toggleGlobalBookmark(
  event: NostrEvent,
  signal?: AbortSignal,
): Promise<ToggleBookmarkResult> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('No signer available — install and unlock a NIP-07 extension to manage bookmarks.')
  }

  const target = getBookmarkTargetItem(event)
  if (!target) {
    throw new Error('This event cannot be added to the global NIP-51 bookmark list.')
  }

  const current = await getFreshNip51ListEvent(user.pubkey, Kind.Bookmarks, {
    ...(signal ? { signal } : {}),
  })
  const parsed = current ? parseNip51ListEvent(current) : null
  const existingPublicItems = parsed?.publicItems ?? []
  const alreadyBookmarked = existingPublicItems.some((item) => areListItemsEqual(item, target))

  const nextPublicItems = alreadyBookmarked
    ? existingPublicItems.filter((item) => !areListItemsEqual(item, target))
    : [...existingPublicItems, target]

  const published = await publishNip51List({
    kind: Kind.Bookmarks,
    publicItems: nextPublicItems,
    preservedPrivateContent: current?.content ?? '',
    ...(signal ? { signal } : {}),
  })

  return {
    event: published,
    bookmarked: !alreadyBookmarked,
  }
}

export function getNip51ListPreviewText(event: NostrEvent): string {
  const parsed = parseNip51ListEvent(event)
  if (!parsed) return `Shared list kind ${event.kind}.`

  const itemCount = parsed.publicItems.length
  if (parsed.kind === Kind.StarterPack) {
    return `${parsed.title ?? parsed.definition.name} with ${itemCount} profile${itemCount === 1 ? '' : 's'} to follow together.`
  }
  if (parsed.kind === Kind.MediaStarterPack) {
    return `${parsed.title ?? parsed.definition.name} with ${itemCount} media-focused profile${itemCount === 1 ? '' : 's'} to follow together.`
  }
  const title = parsed.title ?? parsed.definition.name
  const privateLabel = parsed.hasPrivateItems ? ' with encrypted private items' : ''

  return `${title} with ${itemCount} public item${itemCount === 1 ? '' : 's'}${privateLabel}.`
}
