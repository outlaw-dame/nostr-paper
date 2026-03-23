import { NDKEvent } from '@nostr-dev-kit/ndk'
import { insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import {
  isSafeMediaURL,
  isSafeURL,
  normalizeNip05Identifier,
  sanitizeAbout,
  sanitizeName,
  sanitizeText,
} from '@/lib/security/sanitize'
import { buildNip39Tags } from '@/lib/nostr/nip39'
import type { Nip39ExternalIdentity, NostrEvent, ProfileBirthday, ProfileMetadata } from '@/types'
import { Kind } from '@/types'

const MAX_LIGHTNING_CHARS = 256
const LNURL_PATTERN = /^lnurl[0-9a-z]+$/i
const LIGHTNING_ADDRESS_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i
export const PROFILE_UPDATED_EVENT = 'nostr-paper:profile-updated'

type RawProfileMetadata = Record<string, unknown> & {
  displayName?: unknown
  username?: unknown
}

export interface ParsedProfileMetadataEvent {
  id: string
  pubkey: string
  createdAt: number
  metadata: ProfileMetadata
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeOptionalMediaUrl(value: unknown): string | undefined {
  return typeof value === 'string' && isSafeMediaURL(value) ? value.trim() : undefined
}

function normalizeOptionalMediaUrlFromCandidates(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeOptionalMediaUrl(value)
    if (normalized) return normalized
  }
  return undefined
}

function normalizeOptionalUrl(value: unknown): string | undefined {
  return typeof value === 'string' && isSafeURL(value) ? value.trim() : undefined
}

function normalizeLud06(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = sanitizeText(value).trim().toLowerCase().slice(0, MAX_LIGHTNING_CHARS)
  return LNURL_PATTERN.test(normalized) ? normalized : undefined
}

function normalizeLud16(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = sanitizeText(value).trim().toLowerCase().slice(0, MAX_LIGHTNING_CHARS)
  return LIGHTNING_ADDRESS_PATTERN.test(normalized) ? normalized : undefined
}

function daysInMonth(month: number, year?: number): number {
  switch (month) {
    case 2: {
      if (year === undefined) return 29
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      return leap ? 29 : 28
    }
    case 4:
    case 6:
    case 9:
    case 11:
      return 30
    default:
      return 31
  }
}

function normalizeBirthday(value: unknown): ProfileBirthday | undefined {
  if (!isRecord(value)) return undefined

  const year = Number.isSafeInteger(value.year) && Number(value.year) >= 1 && Number(value.year) <= 9_999
    ? Number(value.year)
    : undefined
  const month = Number.isSafeInteger(value.month) && Number(value.month) >= 1 && Number(value.month) <= 12
    ? Number(value.month)
    : undefined
  const maxDay = month ? daysInMonth(month, year) : 31
  const day = Number.isSafeInteger(value.day) && Number(value.day) >= 1 && Number(value.day) <= maxDay
    ? Number(value.day)
    : undefined

  if (year === undefined && month === undefined && day === undefined) return undefined

  return {
    ...(year !== undefined ? { year } : {}),
    ...(month !== undefined ? { month } : {}),
    ...(day !== undefined ? { day } : {}),
  }
}

function buildCanonicalProfileMetadataObject(metadata: ProfileMetadata): ProfileMetadata {
  const canonical: ProfileMetadata = {}

  if (metadata.name) canonical.name = metadata.name
  if (metadata.display_name) canonical.display_name = metadata.display_name
  if (metadata.picture) canonical.picture = metadata.picture
  if (metadata.banner) canonical.banner = metadata.banner
  if (metadata.about) canonical.about = metadata.about
  if (metadata.website) canonical.website = metadata.website
  if (metadata.bot) canonical.bot = true
  if (metadata.birthday) canonical.birthday = metadata.birthday
  if (metadata.nip05) canonical.nip05 = metadata.nip05
  if (metadata.lud06) canonical.lud06 = metadata.lud06
  if (metadata.lud16) canonical.lud16 = metadata.lud16

  return canonical
}

export function normalizeProfileMetadata(input: unknown): ProfileMetadata | null {
  if (!isRecord(input)) return null

  const raw = input as RawProfileMetadata
  const nameFromPrimary = sanitizeName(typeof raw.name === 'string' ? raw.name : '')
  const nameFromDeprecated = sanitizeName(typeof raw.username === 'string' ? raw.username : '')
  const displayNamePrimary = sanitizeName(typeof raw.display_name === 'string' ? raw.display_name : '')
  const displayNameDeprecated = sanitizeName(typeof raw.displayName === 'string' ? raw.displayName : '')

  const display_name = displayNamePrimary || displayNameDeprecated || undefined
  const name = nameFromPrimary || nameFromDeprecated || display_name || undefined
  const about = sanitizeAbout(typeof raw.about === 'string' ? raw.about : '') || undefined
  const birthday = normalizeBirthday(raw.birthday)
  const picture = normalizeOptionalMediaUrlFromCandidates(
    raw.picture,
    raw.picture_url,
    raw.pictureUrl,
    raw.image,
    raw.image_url,
    raw.imageUrl,
    raw.avatar,
    raw.avatarUrl,
    raw.avatar_url,
    raw.icon,
    raw.icon_url,
    raw.iconUrl,
    raw.pfp,
    raw.profile_image,
    raw.profileImage,
    raw.profile_picture,
    raw.profilePicture,
  )
  const banner = normalizeOptionalMediaUrlFromCandidates(
    raw.banner,
    raw.bannerUrl,
    raw.banner_url,
    raw.bannerImage,
    raw.banner_image,
    raw.header,
    raw.headerUrl,
    raw.header_image,
    raw.headerImage,
    raw.cover,
    raw.coverUrl,
    raw.cover_image,
    raw.coverImage,
    raw.cover_photo,
    raw.coverPhoto,
  )

  return buildCanonicalProfileMetadataObject({
    ...(name ? { name } : {}),
    ...(display_name ? { display_name } : {}),
    ...(picture ? { picture } : {}),
    ...(banner ? { banner } : {}),
    ...(about ? { about } : {}),
    ...(normalizeOptionalUrl(raw.website) ? { website: normalizeOptionalUrl(raw.website)! } : {}),
    ...(raw.bot === true ? { bot: true } : {}),
    ...(birthday ? { birthday } : {}),
    ...(typeof raw.nip05 === 'string' && normalizeNip05Identifier(raw.nip05)
      ? { nip05: normalizeNip05Identifier(raw.nip05)! }
      : {}),
    ...(normalizeLud06(raw.lud06) ? { lud06: normalizeLud06(raw.lud06)! } : {}),
    ...(normalizeLud16(raw.lud16) ? { lud16: normalizeLud16(raw.lud16)! } : {}),
  })
}

export function buildProfileMetadataContent(metadata: ProfileMetadata): string {
  const normalized = normalizeProfileMetadata(metadata)
  return JSON.stringify(normalized ?? {})
}

export function parseProfileMetadataEvent(event: NostrEvent): ParsedProfileMetadataEvent | null {
  if (event.kind !== Kind.Metadata) return null

  let parsedContent: unknown
  try {
    parsedContent = JSON.parse(event.content)
  } catch {
    return null
  }

  const metadata = normalizeProfileMetadata(parsedContent)
  if (!metadata) return null

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    metadata,
  }
}

function dispatchProfileUpdated(pubkey: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, {
    detail: { pubkey },
  }))
}

export async function publishProfileMetadata(
  metadata: ProfileMetadata,
  options: { signal?: AbortSignal; externalIdentities?: Nip39ExternalIdentity[] } = {},
): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish profile metadata.')
  }

  const event = new NDKEvent(ndk)
  event.kind = Kind.Metadata
  event.content = buildProfileMetadataContent(metadata)
  const identityTags = buildNip39Tags(options.externalIdentities ?? [])
  event.tags = await withOptionalClientTag(identityTags, options.signal)

  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await withRetry(
    async () => {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
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
  dispatchProfileUpdated(rawEvent.pubkey)
  return rawEvent
}
