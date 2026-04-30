import { NDKEvent } from '@nostr-dev-kit/ndk'
import { naddrEncode } from 'nostr-tools/nip19'
import {
  getEventReadRelayHints,
  getFollows,
  getLatestAddressableEvent,
  insertEvent,
  queryEvents,
} from '@/lib/db/nostr'
import { parseAddressCoordinate } from '@/lib/nostr/addressable'
import { compareReplaceableEvents } from '@/lib/nostr/contactList'
import { isDvmEventKind } from '@/lib/nostr/dvm'
import { parseNip21Reference } from '@/lib/nostr/nip21'
import { getCurrentUser, getNDK } from '@/lib/nostr/ndk'
import { publishEventWithNip65Outbox } from '@/lib/nostr/outbox'
import { withRetry } from '@/lib/retry'
import { resolveAppBaseUrl } from '@/lib/runtime/baseUrl'
import {
  isSafeMediaURL,
  isSafeURL,
  isValidHex32,
  isValidRelayURL,
  normalizeNip05Identifier,
  sanitizeAbout,
  sanitizeName,
} from '@/lib/security/sanitize'
import type {
  NostrEvent,
  ProfileMetadata,
} from '@/types'
import { Kind } from '@/types'

const MAX_AUTHOR_RECOMMENDATIONS = 128
const DEFAULT_HANDLER_FETCH_LIMIT = 24
const MAX_RESOLVED_HANDLERS = 24
const HANDLER_PLATFORM_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/i
const HANDLER_PLACEHOLDER_PATTERN = /<bech32>|\{bech32\}|\bbech32\b/u
const HANDLER_PLACEHOLDER_SENTINEL = '__NOSTR_PAPER_BECH32__'
const NIP89_BECH32_TYPES = ['note', 'nevent', 'npub', 'nprofile', 'naddr'] as const
const KNOWN_TAG_NAMES = new Set(['d', 'k', 'alt', 'client'])

export const NIP89_CLIENT_TAG_PREFERENCE_KEY = 'nostr-paper:nip89-client-tag-enabled'
export const NOSTR_PAPER_CLIENT_NAME = 'Nostr Paper'
export const NOSTR_PAPER_HANDLER_IDENTIFIER = 'nostr-paper-web'
export const NOSTR_PAPER_SUPPORTED_KINDS = [
  Kind.Metadata,
  Kind.ShortNote,
  Kind.Contacts,
  Kind.MuteList,
  Kind.PinnedNotes,
  Kind.RelayList,
  Kind.Bookmarks,
  Kind.CommunitiesList,
  Kind.PublicChatsList,
  Kind.BlockedRelays,
  Kind.SearchRelays,
  Kind.SimpleGroupsList,
  Kind.RelayFeeds,
  Kind.InterestsList,
  Kind.MediaFollows,
  Kind.EmojisList,
  Kind.DmRelays,
  Kind.GoodWikiAuthors,
  Kind.GoodWikiRelays,
  Kind.EventDeletion,
  Kind.Repost,
  Kind.Reaction,
  Kind.BadgeAward,
  Kind.Thread,
  Kind.PollVote,
  Kind.Poll,
  Kind.Comment,
  Kind.GenericRepost,
  Kind.Video,
  Kind.ShortVideo,
  Kind.FileMetadata,
  Kind.Report,
  Kind.LongFormContent,
  Kind.UserStatus,
  Kind.HandlerRecommendation,
  Kind.HandlerInformation,
  Kind.FollowSet,
  Kind.RelaySet,
  Kind.BookmarkSet,
  Kind.ArticleCurationSet,
  Kind.VideoCurationSet,
  Kind.PictureCurationSet,
  Kind.KindMuteSet,
  Kind.InterestSet,
  Kind.EmojiSet,
  Kind.ReleaseArtifactSet,
  Kind.AppCurationSet,
  Kind.CalendarSet,
  Kind.StarterPack,
  Kind.MediaStarterPack,
  Kind.AddressableVideo,
  Kind.AddressableShortVideo,
  Kind.Highlight,
] as const

export type Nip89EntityType = typeof NIP89_BECH32_TYPES[number]

export interface HandlerPlatformLink {
  platform: string
  urlTemplate: string
  entityType?: Nip89EntityType
}

export interface ParsedHandlerInformationEvent {
  id: string
  pubkey: string
  createdAt: number
  identifier: string
  address: string
  naddr?: string
  metadata?: ProfileMetadata
  supportedKinds: number[]
  links: HandlerPlatformLink[]
}

export interface HandlerRecommendationReference {
  address: string
  relayHint?: string
  platform?: string
}

export interface ParsedHandlerRecommendationEvent {
  id: string
  pubkey: string
  createdAt: number
  supportedKind: number
  recommendations: HandlerRecommendationReference[]
}

export interface ParsedClientTag {
  name: string
  address: string
  relayHint?: string
}

export interface ResolvedHandlerRecommendation {
  handler: ParsedHandlerInformationEvent
  recommendedBy: string
  trustRank: number
  relayHint?: string
  platform?: string
}

export interface NostrPaperHandlerOrigin {
  origin: string | null
  publishable: boolean
  source: 'env' | 'window' | null
}

type RawHandlerMetadata = Record<string, unknown> & {
  displayName?: unknown
  username?: unknown
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function isNip89EntityType(value: string | undefined): value is Nip89EntityType {
  return typeof value === 'string' && (NIP89_BECH32_TYPES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSupportedKind(value: string | number | null | undefined): number | null {
  const raw = typeof value === 'number' ? String(value) : value
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function normalizeSupportedKinds(values: Iterable<string | number>): number[] {
  const deduped = new Set<number>()
  for (const value of values) {
    const normalized = normalizeSupportedKind(value)
    if (normalized === null) continue
    deduped.add(normalized)
  }
  return [...deduped].sort((a, b) => a - b)
}

function normalizePlatform(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = sanitizeName(value).trim().toLowerCase()
  return HANDLER_PLATFORM_PATTERN.test(normalized) ? normalized : undefined
}

function normalizeHandlerUrlTemplate(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!HANDLER_PLACEHOLDER_PATTERN.test(trimmed)) return undefined

  const candidate = trimmed.replace(HANDLER_PLACEHOLDER_PATTERN, HANDLER_PLACEHOLDER_SENTINEL)
  if (!isSafeURL(candidate)) return undefined

  try {
    const parsed = new URL(candidate)
    parsed.hash = ''
    parsed.username = ''
    parsed.password = ''
    return parsed.toString().replace(HANDLER_PLACEHOLDER_SENTINEL, '<bech32>')
  } catch {
    return undefined
  }
}

function encodeAddressCoordinate(address: string, relayHint?: string): string | undefined {
  const parsed = parseAddressCoordinate(address)
  if (!parsed) return undefined

  try {
    return naddrEncode({
      kind: parsed.kind,
      pubkey: parsed.pubkey,
      identifier: parsed.identifier,
      ...(relayHint ? { relays: [relayHint] } : {}),
    })
  } catch {
    return undefined
  }
}

export function encodeHandlerAddressNaddr(address: string, relayHint?: string): string | undefined {
  return encodeAddressCoordinate(address, relayHint)
}

function parseHandlerMetadataContent(content: string): ProfileMetadata | undefined {
  if (content.trim().length === 0) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return undefined
  }

  return normalizeHandlerMetadata(parsed) ?? undefined
}

function getIdentifierTag(event: NostrEvent): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== 'd' || typeof tag[1] !== 'string') continue
    const normalized = tag[1].trim()
    if (normalized.length > 0) return normalized
  }
  return null
}

function dedupeLinks(links: HandlerPlatformLink[]): HandlerPlatformLink[] {
  const seen = new Set<string>()
  const deduped: HandlerPlatformLink[] = []

  for (const link of links) {
    const key = `${link.platform}:${link.urlTemplate}:${link.entityType ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(link)
  }

  return deduped
}

function dedupeRecommendations(
  recommendations: HandlerRecommendationReference[],
): HandlerRecommendationReference[] {
  const seen = new Set<string>()
  const deduped: HandlerRecommendationReference[] = []

  for (const recommendation of recommendations) {
    const key = `${recommendation.address}:${recommendation.platform ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(recommendation)
  }

  return deduped
}

function sanitizeClientTagName(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = sanitizeName(value).trim()
  return normalized.length > 0 ? normalized : undefined
}

function replaceHandlerPlaceholder(urlTemplate: string, bech32: string): string | null {
  if (!HANDLER_PLACEHOLDER_PATTERN.test(urlTemplate)) return null
  return urlTemplate.replace(HANDLER_PLACEHOLDER_PATTERN, bech32)
}

function getBech32EntityType(value: string): Nip89EntityType | null {
  const parsed = parseNip21Reference(value)
  if (!parsed) return null
  return isNip89EntityType(parsed.decoded.type) ? parsed.decoded.type : null
}

function sortHandlerLinks(
  links: HandlerPlatformLink[],
  preferredPlatform: string | undefined,
  entityType: Nip89EntityType | null,
): HandlerPlatformLink[] {
  const preferred = normalizePlatform(preferredPlatform)

  return [...links].sort((a, b) => {
    const aPlatform = a.platform === preferred ? 0 : a.platform === 'web' ? 1 : 2
    const bPlatform = b.platform === preferred ? 0 : b.platform === 'web' ? 1 : 2
    if (aPlatform !== bPlatform) return aPlatform - bPlatform

    const aEntity = a.entityType === entityType ? 0 : a.entityType === undefined ? 1 : 2
    const bEntity = b.entityType === entityType ? 0 : b.entityType === undefined ? 1 : 2
    if (aEntity !== bEntity) return aEntity - bEntity

    return a.urlTemplate.localeCompare(b.urlTemplate)
  })
}

function pickBestHandlerLink(
  handler: ParsedHandlerInformationEvent,
  bech32: string,
  preferredPlatform?: string,
): HandlerPlatformLink | null {
  const entityType = getBech32EntityType(bech32)
  const links = sortHandlerLinks(handler.links, preferredPlatform, entityType)

  for (const link of links) {
    if (link.entityType && entityType && link.entityType !== entityType) continue
    if (link.entityType && entityType === null) continue
    if (replaceHandlerPlaceholder(link.urlTemplate, bech32)) {
      return link
    }
  }

  return null
}

function dedupeLatestRecommendations(
  events: ParsedHandlerRecommendationEvent[],
): ParsedHandlerRecommendationEvent[] {
  const latest = new Map<string, ParsedHandlerRecommendationEvent>()

  for (const event of events) {
    const key = `${event.pubkey}:${event.supportedKind}`
    const current = latest.get(key)
    if (!current || compareReplaceableEvents(
      { eventId: event.id, createdAt: event.createdAt },
      { eventId: current.id, createdAt: current.createdAt },
    ) > 0) {
      latest.set(key, event)
    }
  }

  return [...latest.values()].sort((a, b) => (
    compareReplaceableEvents(
      { eventId: b.id, createdAt: b.createdAt },
      { eventId: a.id, createdAt: a.createdAt },
    )
  ))
}

function dedupeLatestHandlerInfo(
  events: ParsedHandlerInformationEvent[],
): ParsedHandlerInformationEvent[] {
  const latest = new Map<string, ParsedHandlerInformationEvent>()

  for (const event of events) {
    const key = `${event.pubkey}:${event.identifier}`
    const current = latest.get(key)
    if (!current || compareReplaceableEvents(
      { eventId: event.id, createdAt: event.createdAt },
      { eventId: current.id, createdAt: current.createdAt },
    ) > 0) {
      latest.set(key, event)
    }
  }

  return [...latest.values()].sort((a, b) => (
    compareReplaceableEvents(
      { eventId: b.id, createdAt: b.createdAt },
      { eventId: a.id, createdAt: a.createdAt },
    )
  ))
}

function getPublicOriginCandidate(value: string | undefined): string | null {
  if (typeof value !== 'string' || !isSafeURL(value)) return null

  try {
    const parsed = new URL(value)
    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''
    parsed.username = ''
    parsed.password = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function isPublishablePublicOrigin(origin: string | null): boolean {
  if (!origin) return false

  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function fetchAuthorEvents(
  pubkey: string,
  kind: number,
  signal?: AbortSignal,
): Promise<void> {
  let ndk
  try {
    ndk = getNDK()
  } catch {
    return
  }

  await withRetry(
    async () => {
      throwIfAborted(signal)
      await ndk.fetchEvents({
        authors: [pubkey],
        kinds: [kind],
        limit: DEFAULT_HANDLER_FETCH_LIMIT,
      })
    },
    {
      maxAttempts: 2,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      ...(signal ? { signal } : {}),
    },
  )
}

async function fetchTrustedRecommendationsFromRelays(
  supportedKind: number,
  authors: string[],
  signal?: AbortSignal,
): Promise<void> {
  let ndk
  try {
    ndk = getNDK()
  } catch {
    return
  }

  await withRetry(
    async () => {
      throwIfAborted(signal)
      await ndk.fetchEvents({
        authors,
        kinds: [Kind.HandlerRecommendation],
        '#d': [String(supportedKind)],
        limit: Math.min(Math.max(authors.length * 2, 16), 256),
      })
    },
    {
      maxAttempts: 2,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      ...(signal ? { signal } : {}),
    },
  )
}

async function fetchHandlerInformationCoordinates(
  coordinates: HandlerRecommendationReference[],
  signal?: AbortSignal,
): Promise<void> {
  const parsed = coordinates
    .map((item) => parseAddressCoordinate(item.address))
    .filter((value): value is NonNullable<ReturnType<typeof parseAddressCoordinate>> => (
      value !== null && value.kind === Kind.HandlerInformation
    ))

  if (parsed.length === 0) return

  let ndk
  try {
    ndk = getNDK()
  } catch {
    return
  }

  const authors = [...new Set(parsed.map((item) => item.pubkey))]
  const identifiers = [...new Set(parsed.map((item) => item.identifier))]

  await withRetry(
    async () => {
      throwIfAborted(signal)
      await ndk.fetchEvents({
        authors,
        kinds: [Kind.HandlerInformation],
        '#d': identifiers,
        limit: Math.min(Math.max(parsed.length * 2, 12), 256),
      })
    },
    {
      maxAttempts: 2,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      ...(signal ? { signal } : {}),
    },
  )
}

function getAppHandlerMetadata(origin: string): ProfileMetadata {
  const picture = `${origin}/icons/pwa-192x192.png`

  return {
    name: 'nostr-paper',
    display_name: NOSTR_PAPER_CLIENT_NAME,
    about: 'Web client for notes, articles, videos, media, search, and Nostr application-handler discovery.',
    website: origin,
    ...(isSafeMediaURL(picture) ? { picture } : {}),
  }
}

function normalizeHandlerMetadata(input: unknown): ProfileMetadata | null {
  if (!isRecord(input)) return null

  const raw = input as RawHandlerMetadata
  const displayNamePrimary = sanitizeName(typeof raw.display_name === 'string' ? raw.display_name : '')
  const displayNameDeprecated = sanitizeName(typeof raw.displayName === 'string' ? raw.displayName : '')
  const display_name = displayNamePrimary || displayNameDeprecated || undefined
  const name = sanitizeName(
    typeof raw.name === 'string'
      ? raw.name
      : (typeof raw.username === 'string' ? raw.username : ''),
  ) || display_name || undefined
  const about = sanitizeAbout(typeof raw.about === 'string' ? raw.about : '') || undefined
  const picture = typeof raw.picture === 'string' && isSafeMediaURL(raw.picture)
    ? raw.picture
    : undefined
  const banner = typeof raw.banner === 'string' && isSafeMediaURL(raw.banner)
    ? raw.banner
    : undefined
  const website = typeof raw.website === 'string' && isSafeURL(raw.website)
    ? raw.website
    : undefined
  const nip05 = typeof raw.nip05 === 'string'
    ? normalizeNip05Identifier(raw.nip05) ?? undefined
    : undefined

  const normalized: ProfileMetadata = {}
  if (name) normalized.name = name
  if (display_name) normalized.display_name = display_name
  if (about) normalized.about = about
  if (picture) normalized.picture = picture
  if (banner) normalized.banner = banner
  if (website) normalized.website = website
  if (nip05) normalized.nip05 = nip05
  if (raw.bot === true) normalized.bot = true

  return Object.keys(normalized).length > 0 ? normalized : null
}

export function getNostrPaperHandlerOrigin(): NostrPaperHandlerOrigin {
  const envOrigin = getPublicOriginCandidate(import.meta.env.VITE_PUBLIC_APP_ORIGIN as string | undefined)
  if (envOrigin) {
    return {
      origin: envOrigin,
      publishable: isPublishablePublicOrigin(envOrigin),
      source: 'env',
    }
  }

  const runtimeOrigin = getPublicOriginCandidate(resolveAppBaseUrl({ preferPublicOrigin: false }) ?? undefined)
  if (runtimeOrigin) {
    return {
      origin: runtimeOrigin,
      publishable: isPublishablePublicOrigin(runtimeOrigin),
      source: 'window',
    }
  }

  return {
    origin: null,
    publishable: false,
    source: null,
  }
}

export function isClientTagPublishingEnabled(): boolean {
  if (typeof window === 'undefined') return true

  try {
    return window.localStorage.getItem(NIP89_CLIENT_TAG_PREFERENCE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setClientTagPublishingEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(NIP89_CLIENT_TAG_PREFERENCE_KEY, enabled ? 'true' : 'false')
  } catch {
    // Ignore storage failures; publishing falls back to enabled.
  }
}

export function parseHandlerInformationEvent(
  event: NostrEvent,
): ParsedHandlerInformationEvent | null {
  if (event.kind !== Kind.HandlerInformation) return null

  const identifier = getIdentifierTag(event)
  if (!identifier) return null

  const supportedKinds = normalizeSupportedKinds(
    event.tags
      .filter((tag) => tag[0] === 'k')
      .map((tag) => tag[1] ?? ''),
  )

  const links = dedupeLinks(
    event.tags.flatMap((tag) => {
      const platform = normalizePlatform(tag[0])
      if (!platform || KNOWN_TAG_NAMES.has(platform)) return []

      const urlTemplate = normalizeHandlerUrlTemplate(tag[1])
      if (!urlTemplate) return []

      const entityType = isNip89EntityType(tag[2]) ? tag[2] : undefined
      return [{
        platform,
        urlTemplate,
        ...(entityType ? { entityType } : {}),
      }]
    }),
  )

  if (supportedKinds.length === 0 || links.length === 0) return null

  const address = `${Kind.HandlerInformation}:${event.pubkey}:${identifier}`
  const naddr = encodeAddressCoordinate(address)
  const metadata = parseHandlerMetadataContent(event.content)

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    identifier,
    address,
    ...(naddr ? { naddr } : {}),
    ...(metadata ? { metadata } : {}),
    supportedKinds,
    links,
  }
}

export function parseHandlerRecommendationEvent(
  event: NostrEvent,
): ParsedHandlerRecommendationEvent | null {
  if (event.kind !== Kind.HandlerRecommendation) return null

  const supportedKind = normalizeSupportedKind(getIdentifierTag(event))
  if (supportedKind === null) return null

  const recommendations = dedupeRecommendations(
    event.tags.flatMap((tag) => {
      if (tag[0] !== 'a' || typeof tag[1] !== 'string') return []

      const parsed = parseAddressCoordinate(tag[1])
      if (!parsed || parsed.kind !== Kind.HandlerInformation) return []

      const relayHint = tag[2] && isValidRelayURL(tag[2]) ? tag[2] : undefined
      const platform = normalizePlatform(tag[3])

      return [{
        address: tag[1],
        ...(relayHint ? { relayHint } : {}),
        ...(platform ? { platform } : {}),
      }]
    }),
  )

  if (recommendations.length === 0) return null

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    supportedKind,
    recommendations,
  }
}

export function parseClientTag(event: NostrEvent): ParsedClientTag | null {
  for (let index = event.tags.length - 1; index >= 0; index--) {
    const tag = event.tags[index]
    if (tag?.[0] !== 'client') continue

    const name = sanitizeClientTagName(tag[1])
    const address = typeof tag[2] === 'string' ? tag[2] : ''
    const coordinate = parseAddressCoordinate(address)
    if (!name || !coordinate || coordinate.kind !== Kind.HandlerInformation) continue

    const relayHint = tag[3] && isValidRelayURL(tag[3]) ? tag[3] : undefined
    return {
      name,
      address,
      ...(relayHint ? { relayHint } : {}),
    }
  }

  return null
}

export function buildClientTagFromHandlerAddress(
  address: string,
  relayHint?: string,
): string[] | null {
  const coordinate = parseAddressCoordinate(address)
  if (!coordinate || coordinate.kind !== Kind.HandlerInformation) return null

  const tag = [
    'client',
    NOSTR_PAPER_CLIENT_NAME,
    address,
  ]
  if (relayHint && isValidRelayURL(relayHint)) tag.push(relayHint)
  return tag
}

export async function withOptionalClientTag(
  tags: string[][],
  signal?: AbortSignal,
): Promise<string[][]> {
  if (!isClientTagPublishingEnabled()) {
    return tags.filter((tag) => tag[0] !== 'client')
  }

  const user = await getCurrentUser()
  if (!user || !isValidHex32(user.pubkey)) {
    return tags.filter((tag) => tag[0] !== 'client')
  }

  throwIfAborted(signal)

  const handlerEvent = await getLatestAddressableEvent(
    user.pubkey,
    Kind.HandlerInformation,
    NOSTR_PAPER_HANDLER_IDENTIFIER,
  )

  if (!handlerEvent) {
    return tags.filter((tag) => tag[0] !== 'client')
  }

  const relayHint = (await getEventReadRelayHints(user.pubkey, 1))[0]
  const clientTag = buildClientTagFromHandlerAddress(
    `${Kind.HandlerInformation}:${user.pubkey}:${NOSTR_PAPER_HANDLER_IDENTIFIER}`,
    relayHint,
  )

  if (!clientTag) {
    return tags.filter((tag) => tag[0] !== 'client')
  }

  return [
    ...tags.filter((tag) => tag[0] !== 'client'),
    clientTag,
  ]
}

export function buildNostrPaperHandlerTags(
  origin: string,
  supportedKinds: ReadonlyArray<number> = NOSTR_PAPER_SUPPORTED_KINDS,
): string[][] {
  const normalizedKinds = normalizeSupportedKinds(supportedKinds)
  if (normalizedKinds.length === 0) {
    throw new Error('NIP-89 handler information requires at least one supported kind.')
  }

  return [
    ['d', NOSTR_PAPER_HANDLER_IDENTIFIER],
    ...normalizedKinds.map((kind) => ['k', String(kind)]),
    ['web', `${origin}/note/<bech32>`, 'note'],
    ['web', `${origin}/note/<bech32>`, 'nevent'],
    ['web', `${origin}/a/<bech32>`, 'naddr'],
    ['web', `${origin}/profile/<bech32>`, 'npub'],
    ['web', `${origin}/profile/<bech32>`, 'nprofile'],
  ]
}

export function buildNostrPaperHandlerContent(origin: string): string {
  return JSON.stringify(normalizeHandlerMetadata(getAppHandlerMetadata(origin)) ?? {})
}

export async function publishHandlerInformation(
  content: string,
  tags: string[][],
  signal?: AbortSignal,
): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish kind-31990 handler information.')
  }

  const event = new NDKEvent(ndk)
  event.kind = Kind.HandlerInformation
  event.content = content
  event.tags = await withOptionalClientTag(tags, signal)

  throwIfAborted(signal)
  await event.sign()
  throwIfAborted(signal)

  await publishEventWithNip65Outbox(event, signal)

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}

export async function publishNostrPaperHandlerInformation(
  signal?: AbortSignal,
): Promise<NostrEvent> {
  const origin = getNostrPaperHandlerOrigin()
  if (!origin.origin || !origin.publishable) {
    throw new Error(
      'Publishing NIP-89 handler information requires a public HTTPS origin. Set VITE_PUBLIC_APP_ORIGIN for production builds.',
    )
  }

  return publishHandlerInformation(
    buildNostrPaperHandlerContent(origin.origin),
    buildNostrPaperHandlerTags(origin.origin),
    signal,
  )
}

export function buildHandlerRecommendationTags(
  supportedKind: number,
  recommendations: ReadonlyArray<HandlerRecommendationReference>,
): string[][] {
  const normalizedKind = normalizeSupportedKind(supportedKind)
  if (normalizedKind === null) {
    throw new Error('Kind-31989 requires a valid supported event kind in the d tag.')
  }

  const normalizedRecommendations = dedupeRecommendations(
    recommendations.flatMap((recommendation) => {
      const parsed = parseAddressCoordinate(recommendation.address)
      if (!parsed || parsed.kind !== Kind.HandlerInformation) return []

      const relayHint = recommendation.relayHint && isValidRelayURL(recommendation.relayHint)
        ? recommendation.relayHint
        : undefined
      const platform = normalizePlatform(recommendation.platform)

      return [{
        address: recommendation.address,
        ...(relayHint ? { relayHint } : {}),
        ...(platform ? { platform } : {}),
      }]
    }),
  )

  if (normalizedRecommendations.length === 0) {
    throw new Error('Kind-31989 recommendation events require at least one valid handler reference.')
  }

  return [
    ['d', String(normalizedKind)],
    ...normalizedRecommendations.map((recommendation) => {
      const tag = ['a', recommendation.address]
      if (recommendation.relayHint) tag.push(recommendation.relayHint)
      if (recommendation.platform) {
        if (tag.length === 2) tag.push('')
        tag.push(recommendation.platform)
      }
      return tag
    }),
  ]
}

export async function publishHandlerRecommendation(
  supportedKind: number,
  recommendations: ReadonlyArray<HandlerRecommendationReference>,
  signal?: AbortSignal,
): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish kind-31989 recommendations.')
  }

  const event = new NDKEvent(ndk)
  event.kind = Kind.HandlerRecommendation
  event.content = ''
  event.tags = await withOptionalClientTag(
    buildHandlerRecommendationTags(supportedKind, recommendations),
    signal,
  )

  throwIfAborted(signal)
  await event.sign()
  throwIfAborted(signal)

  await publishEventWithNip65Outbox(event, signal)

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}

export async function publishNostrPaperHandlerRecommendations(
  signal?: AbortSignal,
): Promise<NostrEvent[]> {
  const user = await getCurrentUser()
  if (!user || !isValidHex32(user.pubkey)) {
    throw new Error('No signer available — install a NIP-07 extension to publish kind-31989 recommendations.')
  }

  throwIfAborted(signal)

  let handlerEvent = await getLatestAddressableEvent(
    user.pubkey,
    Kind.HandlerInformation,
    NOSTR_PAPER_HANDLER_IDENTIFIER,
  )

  if (!handlerEvent) {
    handlerEvent = await publishNostrPaperHandlerInformation(signal)
  }

  const relayHint = (await getEventReadRelayHints(user.pubkey, 1))[0]
  const address = `${Kind.HandlerInformation}:${user.pubkey}:${NOSTR_PAPER_HANDLER_IDENTIFIER}`

  const published: NostrEvent[] = []
  for (const supportedKind of NOSTR_PAPER_SUPPORTED_KINDS) {
    throwIfAborted(signal)
    const event = await publishHandlerRecommendation(
      supportedKind,
      [{
        address,
        ...(relayHint ? { relayHint } : {}),
        platform: 'web',
      }],
      signal,
    )
    published.push(event)
  }

  return published
}

export async function getFreshHandlerInformationEvents(
  pubkey: string,
  signal?: AbortSignal,
): Promise<ParsedHandlerInformationEvent[]> {
  if (!isValidHex32(pubkey)) return []

  const localEvents = (await queryEvents({
    authors: [pubkey],
    kinds: [Kind.HandlerInformation],
    limit: DEFAULT_HANDLER_FETCH_LIMIT,
  }))
    .map(parseHandlerInformationEvent)
    .filter((value): value is ParsedHandlerInformationEvent => value !== null)

  try {
    await fetchAuthorEvents(pubkey, Kind.HandlerInformation, signal)
    const refreshed = (await queryEvents({
      authors: [pubkey],
      kinds: [Kind.HandlerInformation],
      limit: DEFAULT_HANDLER_FETCH_LIMIT,
    }))
      .map(parseHandlerInformationEvent)
      .filter((value): value is ParsedHandlerInformationEvent => value !== null)

    return dedupeLatestHandlerInfo(refreshed)
  } catch {
    // Return local cache only on degraded network fetches.
  }

  return dedupeLatestHandlerInfo(localEvents)
}

export async function getFreshHandlerRecommendationEvents(
  pubkey: string,
  signal?: AbortSignal,
): Promise<ParsedHandlerRecommendationEvent[]> {
  if (!isValidHex32(pubkey)) return []

  const localEvents = (await queryEvents({
    authors: [pubkey],
    kinds: [Kind.HandlerRecommendation],
    limit: DEFAULT_HANDLER_FETCH_LIMIT,
  }))
    .map(parseHandlerRecommendationEvent)
    .filter((value): value is ParsedHandlerRecommendationEvent => value !== null)

  try {
    await fetchAuthorEvents(pubkey, Kind.HandlerRecommendation, signal)
    const refreshed = (await queryEvents({
      authors: [pubkey],
      kinds: [Kind.HandlerRecommendation],
      limit: DEFAULT_HANDLER_FETCH_LIMIT,
    }))
      .map(parseHandlerRecommendationEvent)
      .filter((value): value is ParsedHandlerRecommendationEvent => value !== null)

    return dedupeLatestRecommendations(refreshed)
  } catch {
    // Return local cache only on degraded network fetches.
  }

  return dedupeLatestRecommendations(localEvents)
}

export async function resolveTrustedHandlerRecommendations(
  supportedKind: number,
  viewerPubkey: string,
  signal?: AbortSignal,
): Promise<ResolvedHandlerRecommendation[]> {
  const normalizedKind = normalizeSupportedKind(supportedKind)
  if (normalizedKind === null || !isValidHex32(viewerPubkey)) return []

  const follows = (await getFollows(viewerPubkey))
    .filter(isValidHex32)
    .filter((pubkey, index, values) => values.indexOf(pubkey) === index)
    .slice(0, Math.max(MAX_AUTHOR_RECOMMENDATIONS - 1, 0))

  const authors = [viewerPubkey, ...follows]
  const trustRanks = new Map<string, number>()
  authors.forEach((author, index) => trustRanks.set(author, index))

  let recommendations = dedupeLatestRecommendations(
    (await queryEvents({
      authors,
      kinds: [Kind.HandlerRecommendation],
      '#d': [String(normalizedKind)],
      limit: Math.min(Math.max(authors.length * 2, 16), 256),
    }))
      .map(parseHandlerRecommendationEvent)
      .filter((value): value is ParsedHandlerRecommendationEvent => value !== null),
  )

  try {
    await fetchTrustedRecommendationsFromRelays(normalizedKind, authors, signal)
    recommendations = dedupeLatestRecommendations(
      (await queryEvents({
        authors,
        kinds: [Kind.HandlerRecommendation],
        '#d': [String(normalizedKind)],
        limit: Math.min(Math.max(authors.length * 2, 16), 256),
      }))
        .map(parseHandlerRecommendationEvent)
        .filter((value): value is ParsedHandlerRecommendationEvent => value !== null),
    )
  } catch {
    // Keep local recommendations only.
  }

  if (recommendations.length === 0) return []

  try {
    await fetchHandlerInformationCoordinates(
      recommendations.flatMap((event) => event.recommendations),
      signal,
    )
  } catch {
    // Proceed with whatever handler info is already cached locally.
  }

  const resolved: ResolvedHandlerRecommendation[] = []
  const seenAddresses = new Set<string>()

  const sortedRecommendations = [...recommendations].sort((a, b) => {
    const rankDiff = (trustRanks.get(a.pubkey) ?? Number.MAX_SAFE_INTEGER)
      - (trustRanks.get(b.pubkey) ?? Number.MAX_SAFE_INTEGER)
    if (rankDiff !== 0) return rankDiff
    return compareReplaceableEvents(
      { eventId: b.id, createdAt: b.createdAt },
      { eventId: a.id, createdAt: a.createdAt },
    )
  })

  for (const recommendationEvent of sortedRecommendations) {
    const trustRank = trustRanks.get(recommendationEvent.pubkey) ?? Number.MAX_SAFE_INTEGER

    for (const recommendation of recommendationEvent.recommendations) {
      if (seenAddresses.has(recommendation.address)) continue

      const coordinate = parseAddressCoordinate(recommendation.address)
      if (!coordinate || coordinate.kind !== Kind.HandlerInformation) continue

      const handlerEvent = await getLatestAddressableEvent(
        coordinate.pubkey,
        Kind.HandlerInformation,
        coordinate.identifier,
      )

      if (!handlerEvent) continue
      const handler = parseHandlerInformationEvent(handlerEvent)
      if (!handler || !handler.supportedKinds.includes(normalizedKind)) continue

      seenAddresses.add(recommendation.address)
      resolved.push({
        handler,
        recommendedBy: recommendationEvent.pubkey,
        trustRank,
        ...(recommendation.relayHint ? { relayHint: recommendation.relayHint } : {}),
        ...(recommendation.platform ? { platform: recommendation.platform } : {}),
      })
    }
  }

  return resolved.slice(0, MAX_RESOLVED_HANDLERS)
}

export function buildHandlerLaunchUrl(
  handler: ParsedHandlerInformationEvent,
  bech32: string,
  preferredPlatform?: string,
): string | null {
  const link = pickBestHandlerLink(handler, bech32, preferredPlatform)
  if (!link) return null
  return replaceHandlerPlaceholder(link.urlTemplate, bech32)
}

export function getHandlerDisplayName(
  handler: Pick<ParsedHandlerInformationEvent, 'metadata' | 'identifier' | 'pubkey'>,
): string {
  return handler.metadata?.display_name
    ?? handler.metadata?.name
    ?? `Handler ${handler.identifier}`
}

export function getHandlerSummary(
  handler: Pick<ParsedHandlerInformationEvent, 'metadata' | 'supportedKinds'>,
): string {
  const about = handler.metadata?.about?.trim()
  if (about) return about

  if (handler.supportedKinds.length === 1) {
    return `Supports kind ${handler.supportedKinds[0]}.`
  }

  return `Supports ${handler.supportedKinds.length} event kinds.`
}

export function getHandlerRecommendationSummary(
  recommendation: Pick<ParsedHandlerRecommendationEvent, 'supportedKind' | 'recommendations'>,
): string {
  const count = recommendation.recommendations.length
  return `Recommends ${count} handler${count === 1 ? '' : 's'} for kind ${recommendation.supportedKind}.`
}

export function isNostrPaperSupportedKind(kind: number): boolean {
  return isDvmEventKind(kind) || (NOSTR_PAPER_SUPPORTED_KINDS as readonly number[]).includes(kind)
}
