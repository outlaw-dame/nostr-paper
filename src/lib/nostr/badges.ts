import { NDKEvent } from '@nostr-dev-kit/ndk'
import {
  getLatestAddressableEvent,
  insertEvent,
  queryEvents,
} from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import {
  getEventAddressCoordinate,
  parseAddressCoordinate,
} from '@/lib/nostr/addressable'
import { getNDK } from '@/lib/nostr/ndk'
import { buildQuoteTagsFromContent } from '@/lib/nostr/repost'
import { withRetry } from '@/lib/retry'
import {
  isSafeMediaURL,
  isValidHex32,
  isValidRelayURL,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const MAX_BADGE_NAME_CHARS = 120
const MAX_BADGE_DESCRIPTION_CHARS = 600
const MAX_BADGE_NOTE_CHARS = 500
const PROFILE_BADGES_IDENTIFIER = 'profile_badges'

export interface BadgeAsset {
  url: string
  width?: number
  height?: number
}

export interface BadgeDefinition {
  id: string
  pubkey: string
  createdAt: number
  identifier: string
  coordinate: string
  name?: string
  description?: string
  image?: BadgeAsset
  thumbnails: BadgeAsset[]
}

export interface BadgeAwardRecipient {
  pubkey: string
  relayHint?: string
}

export interface BadgeAward {
  id: string
  pubkey: string
  createdAt: number
  badgeCoordinate: string
  recipients: BadgeAwardRecipient[]
  note?: string
}

export interface ProfileBadgeReference {
  badgeCoordinate: string
  awardEventId: string
  relayHint?: string
}

export interface ProfileBadges {
  id: string
  pubkey: string
  createdAt: number
  references: ProfileBadgeReference[]
}

export interface DisplayedProfileBadge {
  badgeCoordinate: string
  awardEventId: string
  award: BadgeAward
  definition: BadgeDefinition
}

export interface PublishBadgeAwardOptions {
  note?: string
}

export interface PublishProfileBadgesReference {
  badgeCoordinate: string
  awardEventId: string
  relayHint?: string
}

const inflightProfileBadgeLoads = new Map<string, Promise<DisplayedProfileBadge[]>>()

function sanitizeOptionalText(value: string | undefined, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const sanitized = sanitizeText(value).trim().slice(0, maxChars)
  return sanitized.length > 0 ? sanitized : undefined
}

function parseDimensions(value: string | undefined): Pick<BadgeAsset, 'width' | 'height'> {
  if (typeof value !== 'string') return {}
  const match = value.match(/^(\d{1,5})x(\d{1,5})$/)
  if (!match) return {}

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return {}
  }

  return { width, height }
}

function parseBadgeAsset(tag: string[] | undefined): BadgeAsset | undefined {
  if (!tag?.[1] || !isSafeMediaURL(tag[1])) return undefined
  return {
    url: tag[1],
    ...parseDimensions(tag[2]),
  }
}

function normalizeRelayHint(value: string | undefined): string | undefined {
  if (!value || !isValidRelayURL(value)) return undefined
  try {
    const normalized = new URL(value)
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

function getFirstTag(event: NostrEvent, name: string): string[] | undefined {
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string') return tag
  }
  return undefined
}

function getTags(event: NostrEvent, name: string): string[][] {
  return event.tags.filter(tag => tag[0] === name && typeof tag[1] === 'string')
}

export function parseBadgeDefinitionEvent(event: NostrEvent): BadgeDefinition | null {
  if (event.kind !== Kind.BadgeDefinition) return null

  const coordinate = getEventAddressCoordinate(event)
  const parsedCoordinate = coordinate ? parseAddressCoordinate(coordinate) : null
  if (!coordinate || !parsedCoordinate || parsedCoordinate.kind !== Kind.BadgeDefinition) {
    return null
  }

  const image = parseBadgeAsset(getFirstTag(event, 'image'))
  const name = sanitizeOptionalText(getFirstTag(event, 'name')?.[1], MAX_BADGE_NAME_CHARS)
  const description = sanitizeOptionalText(
    getFirstTag(event, 'description')?.[1],
    MAX_BADGE_DESCRIPTION_CHARS,
  )
  const thumbnails = getTags(event, 'thumb')
    .map(parseBadgeAsset)
    .filter((asset): asset is BadgeAsset => asset !== undefined)

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    identifier: parsedCoordinate.identifier,
    coordinate,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    thumbnails,
  }
}

export function parseBadgeAwardEvent(event: NostrEvent): BadgeAward | null {
  if (event.kind !== Kind.BadgeAward) return null

  const aTags = getTags(event, 'a')
    .map(tag => tag[1])
    .filter((value): value is string => typeof value === 'string')
    .filter((value) => parseAddressCoordinate(value)?.kind === Kind.BadgeDefinition)

  if (aTags.length !== 1) return null

  const seenRecipients = new Set<string>()
  const recipients: BadgeAwardRecipient[] = []
  for (const tag of getTags(event, 'p')) {
    const pubkey = tag[1]
    if (!pubkey || !isValidHex32(pubkey) || seenRecipients.has(pubkey)) continue

    seenRecipients.add(pubkey)
    const relayHint = normalizeRelayHint(tag[2])
    recipients.push({
      pubkey,
      ...(relayHint ? { relayHint } : {}),
    })
  }

  if (recipients.length === 0) return null

  const note = sanitizeOptionalText(event.content, MAX_BADGE_NOTE_CHARS)

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    badgeCoordinate: aTags[0]!,
    recipients,
    ...(note ? { note } : {}),
  }
}

export function parseProfileBadgesEvent(event: NostrEvent): ProfileBadges | null {
  if (event.kind !== Kind.ProfileBadges) return null

  const coordinate = getEventAddressCoordinate(event)
  const parsedCoordinate = coordinate ? parseAddressCoordinate(coordinate) : null
  if (
    !coordinate ||
    !parsedCoordinate ||
    parsedCoordinate.kind !== Kind.ProfileBadges ||
    parsedCoordinate.identifier !== PROFILE_BADGES_IDENTIFIER
  ) {
    return null
  }

  const references: ProfileBadgeReference[] = []

  for (let index = 0; index < event.tags.length - 1; index++) {
    const badgeTag = event.tags[index]
    const awardTag = event.tags[index + 1]
    if (badgeTag?.[0] !== 'a' || awardTag?.[0] !== 'e') continue
    if (!badgeTag[1] || !awardTag[1] || !isValidHex32(awardTag[1])) continue
    if (parseAddressCoordinate(badgeTag[1])?.kind !== Kind.BadgeDefinition) continue

    const relayHint = normalizeRelayHint(awardTag[2])
    references.push({
      badgeCoordinate: badgeTag[1],
      awardEventId: awardTag[1],
      ...(relayHint ? { relayHint } : {}),
    })
    index += 1
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    references,
  }
}

export function pickBadgeAsset(
  definition: BadgeDefinition,
  preferredSize = 64,
): BadgeAsset | undefined {
  const assets = [...definition.thumbnails]
  if (definition.image) assets.push(definition.image)
  if (assets.length === 0) return undefined

  return assets
    .slice()
    .sort((left, right) => {
      const leftScore = Math.abs((left.width ?? preferredSize) - preferredSize)
      const rightScore = Math.abs((right.width ?? preferredSize) - preferredSize)
      if (leftScore !== rightScore) return leftScore - rightScore
      return (right.width ?? 0) - (left.width ?? 0)
    })[0]
}

export async function getBadgeDefinitionByCoordinate(
  coordinate: string,
): Promise<BadgeDefinition | null> {
  const parsed = parseAddressCoordinate(coordinate)
  if (!parsed || parsed.kind !== Kind.BadgeDefinition) return null

  const event = await getLatestAddressableEvent(parsed.pubkey, parsed.kind, parsed.identifier)
  return event ? parseBadgeDefinitionEvent(event) : null
}

export async function getFreshBadgeDefinition(
  coordinate: string,
  signal?: AbortSignal,
): Promise<BadgeDefinition | null> {
  const local = await getBadgeDefinitionByCoordinate(coordinate)
  if (local) return local

  const parsed = parseAddressCoordinate(coordinate)
  if (!parsed || parsed.kind !== Kind.BadgeDefinition) return null

  let ndk
  try {
    ndk = getNDK()
  } catch {
    return null
  }

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const events = await ndk.fetchEvents({
        authors: [parsed.pubkey],
        kinds: [Kind.BadgeDefinition],
        '#d': [parsed.identifier],
        limit: 10,
      })
    },
    {
      maxAttempts: 2,
      baseDelayMs: 1_000,
      maxDelayMs: 3_000,
      ...(signal ? { signal } : {}),
    },
  ).catch(() => {})

  return getBadgeDefinitionByCoordinate(coordinate)
}

export async function getDisplayedProfileBadges(
  pubkey: string,
): Promise<DisplayedProfileBadge[]> {
  if (!isValidHex32(pubkey)) return []

  const profileBadgesEvent = await getLatestAddressableEvent(
    pubkey,
    Kind.ProfileBadges,
    PROFILE_BADGES_IDENTIFIER,
  )
  const parsedProfileBadges = profileBadgesEvent ? parseProfileBadgesEvent(profileBadgesEvent) : null
  if (!parsedProfileBadges || parsedProfileBadges.references.length === 0) return []

  const awardEvents = await queryEvents({
    ids: [...new Set(parsedProfileBadges.references.map(reference => reference.awardEventId))],
    kinds: [Kind.BadgeAward],
    limit: parsedProfileBadges.references.length,
  })

  const awardsById = new Map(
    awardEvents
      .map(rawEvent => {
        const parsed = parseBadgeAwardEvent(rawEvent)
        return parsed ? [parsed.id, parsed] as const : null
      })
      .filter((entry): entry is readonly [string, BadgeAward] => entry !== null),
  )

  const definitionCoordinates = [...new Set(parsedProfileBadges.references.map(reference => reference.badgeCoordinate))]
  const definitions = await Promise.all(
    definitionCoordinates.map(async (coordinate) => [coordinate, await getBadgeDefinitionByCoordinate(coordinate)] as const),
  )
  const definitionsByCoordinate = new Map(
    definitions.filter((entry): entry is readonly [string, BadgeDefinition] => entry[1] !== null),
  )

  const displayed: DisplayedProfileBadge[] = []
  for (const reference of parsedProfileBadges.references) {
    const award = awardsById.get(reference.awardEventId)
    const definition = definitionsByCoordinate.get(reference.badgeCoordinate)
    if (!award || !definition) continue
    if (award.badgeCoordinate !== reference.badgeCoordinate) continue
    if (award.pubkey !== definition.pubkey) continue
    if (!award.recipients.some(recipient => recipient.pubkey === pubkey)) continue

    displayed.push({
      badgeCoordinate: reference.badgeCoordinate,
      awardEventId: reference.awardEventId,
      award,
      definition,
    })
  }

  return displayed
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function syncProfileBadgeDefinitions(
  coordinates: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (coordinates.length === 0) return

  let ndk
  try {
    ndk = getNDK()
  } catch {
    return
  }

  const grouped = new Map<string, Set<string>>()
  for (const coordinate of coordinates) {
    const parsed = parseAddressCoordinate(coordinate)
    if (!parsed || parsed.kind !== Kind.BadgeDefinition) continue

    const identifiers = grouped.get(parsed.pubkey) ?? new Set<string>()
    identifiers.add(parsed.identifier)
    grouped.set(parsed.pubkey, identifiers)
  }

  for (const [author, identifiers] of grouped) {
    await withRetry(
      async () => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const events = await ndk.fetchEvents({
          authors: [author],
          kinds: [Kind.BadgeDefinition],
          '#d': [...identifiers],
          limit: Math.min(50, identifiers.size * 10),
        })
      },
      {
        maxAttempts: 2,
        baseDelayMs: 1_000,
        maxDelayMs: 3_000,
        ...(signal ? { signal } : {}),
      },
    ).catch(() => {})
  }
}

export async function getFreshProfileBadges(
  pubkey: string,
  signal?: AbortSignal,
): Promise<DisplayedProfileBadge[]> {
  if (!isValidHex32(pubkey)) return []

  const existing = inflightProfileBadgeLoads.get(pubkey)
  if (existing) return existing

  const promise = (async () => {
    const local = await getDisplayedProfileBadges(pubkey)

    let ndk
    try {
      ndk = getNDK()
    } catch {
      return local
    }

    await withRetry(
      async () => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const events = await ndk.fetchEvents({
          authors: [pubkey],
          kinds: [Kind.ProfileBadges],
          '#d': [PROFILE_BADGES_IDENTIFIER],
          limit: 10,
        })
      },
      {
        maxAttempts: 2,
        baseDelayMs: 1_000,
        maxDelayMs: 3_000,
        ...(signal ? { signal } : {}),
      },
    ).catch(() => {})

    const profileBadgesEvent = await getLatestAddressableEvent(
      pubkey,
      Kind.ProfileBadges,
      PROFILE_BADGES_IDENTIFIER,
    )
    const parsedProfileBadges = profileBadgesEvent ? parseProfileBadgesEvent(profileBadgesEvent) : null
    if (!parsedProfileBadges || parsedProfileBadges.references.length === 0) {
      return getDisplayedProfileBadges(pubkey)
    }

    const awardIds = [...new Set(parsedProfileBadges.references.map(reference => reference.awardEventId))]
    for (const ids of chunk(awardIds, 40)) {
      await withRetry(
        async () => {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
          const events = await ndk.fetchEvents({
            ids,
            kinds: [Kind.BadgeAward],
            limit: ids.length,
          })
        },
        {
          maxAttempts: 2,
          baseDelayMs: 1_000,
          maxDelayMs: 3_000,
          ...(signal ? { signal } : {}),
        },
      ).catch(() => {})
    }

    const localAwards = await queryEvents({
      ids: awardIds,
      kinds: [Kind.BadgeAward],
      limit: awardIds.length,
    })

    const definitionCoordinates = [...new Set(
      localAwards
        .map(parseBadgeAwardEvent)
        .filter((award): award is BadgeAward => award !== null)
        .filter((award) => award.recipients.some(recipient => recipient.pubkey === pubkey))
        .map(award => award.badgeCoordinate),
    )]

    await syncProfileBadgeDefinitions(definitionCoordinates, signal)
    return getDisplayedProfileBadges(pubkey)
  })().finally(() => {
    inflightProfileBadgeLoads.delete(pubkey)
  })

  inflightProfileBadgeLoads.set(pubkey, promise)
  return promise
}

export async function publishBadgeAward(
  badgeCoordinate: string,
  recipients: Array<string | BadgeAwardRecipient>,
  options: PublishBadgeAwardOptions = {},
  signal?: AbortSignal,
): Promise<NostrEvent> {
  const badge = parseAddressCoordinate(badgeCoordinate)
  if (!badge || badge.kind !== Kind.BadgeDefinition) {
    throw new Error('Badge awards require a valid kind-30009 badge coordinate.')
  }

  const normalizedRecipients = recipients
    .reduce<BadgeAwardRecipient[]>((acc, recipient) => {
      if (typeof recipient === 'string') {
        if (!isValidHex32(recipient) || acc.some(entry => entry.pubkey === recipient)) {
          return acc
        }
        acc.push({ pubkey: recipient })
        return acc
      }

      if (!isValidHex32(recipient.pubkey) || acc.some(entry => entry.pubkey === recipient.pubkey)) {
        return acc
      }

      const relayHint = normalizeRelayHint(recipient.relayHint)
      acc.push({
        pubkey: recipient.pubkey,
        ...(relayHint ? { relayHint } : {}),
      })
      return acc
    }, [])

  if (normalizedRecipients.length === 0) {
    throw new Error('Badge awards require at least one valid recipient pubkey.')
  }

  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish badge awards.')
  }

  const event = new NDKEvent(ndk)
  event.kind = Kind.BadgeAward
  const note = sanitizeOptionalText(options.note, MAX_BADGE_NOTE_CHARS) ?? ''
  event.content = note
  event.tags = await withOptionalClientTag([
    ['a', badgeCoordinate],
    ...normalizedRecipients.map((recipient) => (
      recipient.relayHint
        ? ['p', recipient.pubkey, recipient.relayHint]
        : ['p', recipient.pubkey]
    )),
    ...buildQuoteTagsFromContent(note),
  ], signal)

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await event.publish()
    },
    {
      maxAttempts: 2,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      ...(signal ? { signal } : {}),
    },
  )

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}

export async function publishProfileBadges(
  references: PublishProfileBadgesReference[],
  signal?: AbortSignal,
): Promise<NostrEvent> {
  const normalizedReferences = references.filter((reference) => (
    parseAddressCoordinate(reference.badgeCoordinate)?.kind === Kind.BadgeDefinition &&
    isValidHex32(reference.awardEventId)
  ))

  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish profile badges.')
  }

  const event = new NDKEvent(ndk)
  event.kind = Kind.ProfileBadges
  event.content = ''
  event.tags = await withOptionalClientTag([
    ['d', PROFILE_BADGES_IDENTIFIER],
    ...normalizedReferences.flatMap((reference) => [
      ['a', reference.badgeCoordinate],
      reference.relayHint
        ? ['e', reference.awardEventId, reference.relayHint]
        : ['e', reference.awardEventId],
    ]),
  ], signal)

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await withRetry(
    async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      await event.publish()
    },
    {
      maxAttempts: 2,
      baseDelayMs: 750,
      maxDelayMs: 2_500,
      ...(signal ? { signal } : {}),
    },
  )

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}
