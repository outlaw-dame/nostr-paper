import { NDKEvent } from '@nostr-dev-kit/ndk'
import { getDefaultRelayUrls, getNDK } from '@/lib/nostr/ndk'
import { getEventReadRelayHints, insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { getEventAddressCoordinate, parseAddressCoordinate } from '@/lib/nostr/addressable'
import { buildQuoteTagsFromContent, parseQuoteTags } from '@/lib/nostr/repost'
import { decodeProfileReference } from '@/lib/nostr/nip21'
import { withRetry } from '@/lib/retry'
import {
  LIMITS,
  extractHashtags,
  extractNostrURIs,
  isValidHex32,
  isValidRelayURL,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

const MAX_THREAD_TITLE_CHARS = 160

export interface ParsedThreadEvent {
  id: string
  pubkey: string
  createdAt: number
  title?: string
  content: string
}

export interface NumberedThreadMarker {
  index: number
  total: number
}

export interface ParsedTextNoteReply {
  id: string
  pubkey: string
  createdAt: number
  rootEventId: string
  parentEventId: string
  rootRelayHint?: string
  parentRelayHint?: string
  rootAuthorPubkey?: string
  parentAuthorPubkey?: string
  mentionedPubkeys: string[]
}

export interface ParsedCommentEvent {
  id: string
  pubkey: string
  createdAt: number
  content: string
  rootKind: string
  parentKind: string
  rootEventId?: string
  rootAddress?: string
  rootRelayHint?: string
  rootAuthorPubkey?: string
  parentEventId?: string
  parentAddress?: string
  parentRelayHint?: string
  parentAuthorPubkey?: string
}

export interface ConversationRootReference {
  kind: number | null
  eventId?: string
  address?: string
}

export interface PublishThreadOptions {
  title: string
  body?: string
  signal?: AbortSignal
}

export interface PublishReplyOptions {
  target: NostrEvent
  body?: string
  signal?: AbortSignal
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0 || value.length === 0) return ''

  let low = 0
  let high = value.length

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (utf8ByteLength(value.slice(0, mid)) <= maxBytes) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return value.slice(0, low)
}

function normalizePlainTextContent(body: string | undefined): string {
  if (typeof body !== 'string') return ''

  let normalized = sanitizeText(body).replace(/\r\n?/g, '\n').trim()
  if (utf8ByteLength(normalized) > LIMITS.CONTENT_BYTES) {
    normalized = truncateUtf8(normalized, LIMITS.CONTENT_BYTES).trim()
  }
  return normalized
}

function normalizeThreadTitle(value: string | undefined): string {
  if (typeof value !== 'string') return ''
  return sanitizeText(value).replace(/\r\n?/g, ' ').trim().slice(0, MAX_THREAD_TITLE_CHARS)
}

function normalizeRelayHint(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
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

function dedupeTags(tags: string[][]): string[][] {
  const seen = new Set<string>()
  const deduped: string[][] = []

  for (const tag of tags) {
    const key = tag.join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(tag)
  }

  return deduped
}

function buildHashtagTags(content: string): string[][] {
  return extractHashtags(content).map((tag) => ['t', tag])
}

function buildContentMentionTags(content: string): string[][] {
  const pubkeys = new Set<string>()
  const quoteTags = buildQuoteTagsFromContent(content)

  for (const tag of quoteTags) {
    const pubkey = tag[3]
    if (typeof pubkey === 'string' && isValidHex32(pubkey)) {
      pubkeys.add(pubkey)
    }
  }

  for (const uri of extractNostrURIs(content)) {
    const profile = decodeProfileReference(uri)
    if (profile?.pubkey) {
      pubkeys.add(profile.pubkey)
    }
  }

  return [...pubkeys].map((pubkey) => ['p', pubkey])
}

function preparePlainConversationContent(body: string | undefined): {
  content: string
  tags: string[][]
} {
  const content = normalizePlainTextContent(body)
  if (content.length === 0) {
    throw new Error('Replies and threads cannot be empty.')
  }

  return {
    content,
    tags: dedupeTags([
      ...buildContentMentionTags(content),
      ...buildHashtagTags(content),
      ...buildQuoteTagsFromContent(content),
    ]),
  }
}

function parseMarkedEReference(tag: string[]): {
  eventId: string
  relayHint?: string
  marker?: string
  authorPubkey?: string
} | null {
  const [name, eventId, rawRelayHint, rawMarker, rawAuthorPubkey] = tag
  if (name !== 'e' || typeof eventId !== 'string' || !isValidHex32(eventId)) return null

  const relayHint = normalizeRelayHint(rawRelayHint)
  const marker = typeof rawMarker === 'string' && rawMarker.length > 0 ? rawMarker : undefined
  const authorPubkey = typeof rawAuthorPubkey === 'string' && isValidHex32(rawAuthorPubkey)
    ? rawAuthorPubkey
    : undefined
  return {
    eventId,
    ...(relayHint ? { relayHint } : {}),
    ...(marker ? { marker } : {}),
    ...(authorPubkey ? { authorPubkey } : {}),
  }
}

function isMarkedEReference(tag: NonNullable<ReturnType<typeof parseMarkedEReference>>): boolean {
  return tag.marker === 'root' || tag.marker === 'reply'
}

function getLastTagValue(event: NostrEvent, name: string): string | undefined {
  let value: string | undefined
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string') {
      value = tag[1]
    }
  }
  return value
}

function getMentionedPubkeys(event: NostrEvent): string[] {
  const seen = new Set<string>()
  const pubkeys: string[] = []

  for (const tag of event.tags) {
    const [name, pubkey] = tag
    if (name !== 'p' || typeof pubkey !== 'string' || !isValidHex32(pubkey)) continue
    if (seen.has(pubkey)) continue
    seen.add(pubkey)
    pubkeys.push(pubkey)
  }

  return pubkeys
}

function parseScopedEventTag(tag: string[] | undefined): {
  eventId: string
  relayHint?: string
  authorPubkey?: string
} | null {
  if (!tag) return null
  const [, eventId, rawRelayHint, rawAuthorPubkey] = tag
  if (typeof eventId !== 'string' || !isValidHex32(eventId)) return null

  const relayHint = normalizeRelayHint(rawRelayHint)
  const authorPubkey = typeof rawAuthorPubkey === 'string' && isValidHex32(rawAuthorPubkey)
    ? rawAuthorPubkey
    : undefined
  return {
    eventId,
    ...(relayHint ? { relayHint } : {}),
    ...(authorPubkey ? { authorPubkey } : {}),
  }
}

function parseScopedAddressTag(tag: string[] | undefined): {
  address: string
  relayHint?: string
  authorPubkey?: string
} | null {
  if (!tag) return null
  const [, address, rawRelayHint, rawAuthorPubkey] = tag
  if (typeof address !== 'string' || !parseAddressCoordinate(address)) return null

  const relayHint = normalizeRelayHint(rawRelayHint)
  const authorPubkey = typeof rawAuthorPubkey === 'string' && isValidHex32(rawAuthorPubkey)
    ? rawAuthorPubkey
    : undefined
  return {
    address,
    ...(relayHint ? { relayHint } : {}),
    ...(authorPubkey ? { authorPubkey } : {}),
  }
}

function parseKindTagValue(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseNumericKind(value: string | undefined): number | null {
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) return null
  const kind = Number(value)
  return Number.isSafeInteger(kind) && kind >= 0 ? kind : null
}

async function resolveRelayHint(pubkey: string, fallback?: string): Promise<string> {
  const hints = await getEventReadRelayHints(pubkey, 1)
  if (hints[0]) return hints[0]
  if (fallback && normalizeRelayHint(fallback)) return normalizeRelayHint(fallback)!

  const defaultRelay = getDefaultRelayUrls()[0]
  if (!defaultRelay) {
    throw new Error('No relay hint available for conversation target.')
  }
  return defaultRelay
}

async function publishConversationEvent(
  kind: number,
  content: string,
  tags: string[][],
  signal?: AbortSignal,
): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish.')
  }

  const event = new NDKEvent(ndk)
  event.kind = kind
  event.content = content
  event.tags = await withOptionalClientTag(dedupeTags(tags), signal)

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

function buildRootScopeTagsFromEvent(
  event: NostrEvent,
  relayHint: string,
): string[][] {
  const address = getEventAddressCoordinate(event)
  if (address) {
    return [
      ['A', address, relayHint],
      ['K', String(event.kind)],
      ['P', event.pubkey, relayHint],
    ]
  }

  return [
    ['E', event.id, relayHint, event.pubkey],
    ['K', String(event.kind)],
    ['P', event.pubkey, relayHint],
  ]
}

function buildParentScopeTagsFromEvent(
  event: NostrEvent,
  relayHint: string,
): string[][] {
  const address = getEventAddressCoordinate(event)
  const tags: string[][] = []

  if (address) {
    tags.push(['a', address, relayHint, event.pubkey])
  }

  tags.push(
    ['e', event.id, relayHint, event.pubkey],
    ['k', String(event.kind)],
    ['p', event.pubkey, relayHint],
  )

  return tags
}

function buildRootScopeTagsFromParsedComment(comment: ParsedCommentEvent): string[][] {
  if (comment.rootAddress) {
    const parsed = parseAddressCoordinate(comment.rootAddress)
    const pubkey = comment.rootAuthorPubkey ?? parsed?.pubkey
    return dedupeTags([
      ['A', comment.rootAddress, comment.rootRelayHint ?? ''],
      ['K', comment.rootKind],
      ...(pubkey ? [['P', pubkey, comment.rootRelayHint ?? '']] : []),
    ])
  }

  if (!comment.rootEventId) {
    throw new Error('Comment root reference is missing.')
  }

  return dedupeTags([
    ['E', comment.rootEventId, comment.rootRelayHint ?? '', comment.rootAuthorPubkey ?? ''],
    ['K', comment.rootKind],
    ...(comment.rootAuthorPubkey ? [['P', comment.rootAuthorPubkey, comment.rootRelayHint ?? '']] : []),
  ])
}

function buildParentScopeTagsFromParsedComment(comment: ParsedCommentEvent): string[][] {
  const tags: string[][] = []

  if (comment.parentAddress) {
    const parsed = parseAddressCoordinate(comment.parentAddress)
    const author = comment.parentAuthorPubkey ?? parsed?.pubkey ?? ''
    tags.push(['a', comment.parentAddress, comment.parentRelayHint ?? '', author])
  }

  if (comment.parentEventId) {
    tags.push(['e', comment.parentEventId, comment.parentRelayHint ?? '', comment.parentAuthorPubkey ?? ''])
  }

  if (tags.length === 0) {
    throw new Error('Comment parent reference is missing.')
  }

  tags.push(['k', comment.parentKind])
  if (comment.parentAuthorPubkey) {
    tags.push(['p', comment.parentAuthorPubkey, comment.parentRelayHint ?? ''])
  }

  return dedupeTags(tags)
}

function buildNip10ReplyTags(
  target: NostrEvent,
  relayHint: string,
): string[][] {
  const parsedTargetReply = parseTextNoteReply(target)
  const rootEventId = parsedTargetReply?.rootEventId ?? target.id
  const rootRelayHint = parsedTargetReply?.rootRelayHint ?? relayHint
  const rootAuthorPubkey = parsedTargetReply?.rootAuthorPubkey ?? target.pubkey

  const pTags = new Set<string>([
    target.pubkey,
    ...getMentionedPubkeys(target),
    ...(rootAuthorPubkey ? [rootAuthorPubkey] : []),
  ])

  const replyTags: string[][] = rootEventId === target.id
    ? [['e', target.id, relayHint, 'root', target.pubkey]]
    : [
        ['e', rootEventId, rootRelayHint, 'root', rootAuthorPubkey ?? ''],
        ['e', target.id, relayHint, 'reply', target.pubkey],
      ]

  return dedupeTags([
    ...replyTags,
    ...[...pTags].map((pubkey) => ['p', pubkey]),
  ])
}

export function parseThreadEvent(event: NostrEvent): ParsedThreadEvent | null {
  if (event.kind !== Kind.Thread) return null

  const title = normalizeThreadTitle(getLastTagValue(event, 'title'))
  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    ...(title ? { title } : {}),
    content: normalizePlainTextContent(event.content),
  }
}

/**
 * Parse numbered thread markers commonly used by clients, e.g.:
 * - "Thread 1/4"
 * - "1/4"
 * - "🧵 2/8"
 */
export function parseNumberedThreadMarker(content: string): NumberedThreadMarker | null {
  if (typeof content !== 'string' || content.length === 0) return null

  const matches = content.matchAll(/(?:\bthread\b\s*)?(\d{1,3})\s*\/\s*(\d{1,3})(?!\d)/gi)
  for (const match of matches) {
    const index = Number(match[1])
    const total = Number(match[2])
    if (!Number.isInteger(index) || !Number.isInteger(total)) continue
    if (total < 2 || total > 200) continue
    if (index < 1 || index > total) continue
    return { index, total }
  }

  return null
}

export function parseTextNoteReply(event: NostrEvent): ParsedTextNoteReply | null {
  if (event.kind !== Kind.ShortNote) return null

  const eTags = event.tags
    .map(parseMarkedEReference)
    .filter((tag): tag is NonNullable<typeof tag> => tag !== null)
  const unmarkedTags = eTags.filter((tag) => !isMarkedEReference(tag))

  const rootTag = [...eTags].reverse().find((tag) => tag.marker === 'root')
  const replyTag = [...eTags].reverse().find((tag) => tag.marker === 'reply')
  const trailingUnmarkedTag = unmarkedTags.length > 0 ? unmarkedTags[unmarkedTags.length - 1] : undefined

  let rootEventId: string | undefined
  let parentEventId: string | undefined
  let rootRelayHint: string | undefined
  let parentRelayHint: string | undefined
  let rootAuthorPubkey: string | undefined
  let parentAuthorPubkey: string | undefined

  if (rootTag || replyTag) {
    // Real-world clients sometimes mix marked and unmarked e-tags.
    // Prefer explicit markers, but use trailing unmarked e-tags as parent fallback.
    rootEventId = rootTag?.eventId ?? unmarkedTags[0]?.eventId ?? replyTag?.eventId
    rootRelayHint = rootTag?.relayHint ?? unmarkedTags[0]?.relayHint ?? replyTag?.relayHint
    rootAuthorPubkey = rootTag?.authorPubkey ?? unmarkedTags[0]?.authorPubkey ?? replyTag?.authorPubkey

    parentEventId = replyTag?.eventId
      ?? trailingUnmarkedTag?.eventId
      ?? rootEventId
    parentRelayHint = replyTag?.relayHint
      ?? trailingUnmarkedTag?.relayHint
      ?? rootRelayHint
    parentAuthorPubkey = replyTag?.authorPubkey
      ?? trailingUnmarkedTag?.authorPubkey
      ?? rootAuthorPubkey
  } else if (eTags.length === 1) {
    const only = eTags[0]!
    rootEventId = only.eventId
    parentEventId = only.eventId
    rootRelayHint = only.relayHint
    parentRelayHint = only.relayHint
    rootAuthorPubkey = only.authorPubkey
    parentAuthorPubkey = only.authorPubkey
  } else if (eTags.length >= 2) {
    const first = eTags[0]!
    const last = eTags[eTags.length - 1]!
    rootEventId = first.eventId
    parentEventId = last.eventId
    rootRelayHint = first.relayHint
    parentRelayHint = last.relayHint
    rootAuthorPubkey = first.authorPubkey
    parentAuthorPubkey = last.authorPubkey
  }

  if (!rootEventId || !parentEventId) return null

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    rootEventId,
    parentEventId,
    ...(rootRelayHint ? { rootRelayHint } : {}),
    ...(parentRelayHint ? { parentRelayHint } : {}),
    ...(rootAuthorPubkey ? { rootAuthorPubkey } : {}),
    ...(parentAuthorPubkey ? { parentAuthorPubkey } : {}),
    mentionedPubkeys: getMentionedPubkeys(event),
  }
}

export function parseCommentEvent(event: NostrEvent): ParsedCommentEvent | null {
  if (event.kind !== Kind.Comment) return null

  const rootKind = parseKindTagValue(getLastTagValue(event, 'K'))
  const parentKind = parseKindTagValue(getLastTagValue(event, 'k'))
  if (!rootKind || !parentKind) return null

  const rootEvent = [...event.tags].reverse().find((tag) => tag[0] === 'E')
  const rootAddress = [...event.tags].reverse().find((tag) => tag[0] === 'A')
  const parentEvent = [...event.tags].reverse().find((tag) => tag[0] === 'e')
  const parentAddress = [...event.tags].reverse().find((tag) => tag[0] === 'a')
  const rootAuthorTag = [...event.tags].reverse().find((tag) => tag[0] === 'P')
  const parentAuthorTag = [...event.tags].reverse().find((tag) => tag[0] === 'p')

  const parsedRootEvent = parseScopedEventTag(rootEvent)
  const parsedRootAddress = parseScopedAddressTag(rootAddress)
  const parsedParentEvent = parseScopedEventTag(parentEvent)
  const parsedParentAddress = parseScopedAddressTag(parentAddress)

  if (!parsedRootEvent && !parsedRootAddress) return null

  const rootAuthorPubkey = isValidHex32(rootAuthorTag?.[1] ?? '')
    ? rootAuthorTag?.[1]
    : parsedRootEvent?.authorPubkey ?? parsedRootAddress?.authorPubkey

  let parentEventId = parsedParentEvent?.eventId
  let parentAddressValue = parsedParentAddress?.address
  let parentRelayHint = parsedParentEvent?.relayHint ?? parsedParentAddress?.relayHint
  let parentAuthorPubkey = isValidHex32(parentAuthorTag?.[1] ?? '')
    ? parentAuthorTag?.[1]
    : parsedParentEvent?.authorPubkey ?? parsedParentAddress?.authorPubkey

  if (!parentEventId && !parentAddressValue) {
    parentEventId = parsedRootEvent?.eventId
    parentAddressValue = parsedRootAddress?.address
    parentRelayHint = parsedRootEvent?.relayHint ?? parsedRootAddress?.relayHint
    parentAuthorPubkey = rootAuthorPubkey
  }

  const rootRelayHint = parsedRootEvent?.relayHint ?? parsedRootAddress?.relayHint

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    content: normalizePlainTextContent(event.content),
    rootKind,
    parentKind,
    ...(parsedRootEvent?.eventId ? { rootEventId: parsedRootEvent.eventId } : {}),
    ...(parsedRootAddress?.address ? { rootAddress: parsedRootAddress.address } : {}),
    ...(rootRelayHint ? { rootRelayHint } : {}),
    ...(rootAuthorPubkey ? { rootAuthorPubkey } : {}),
    ...(parentEventId ? { parentEventId } : {}),
    ...(parentAddressValue ? { parentAddress: parentAddressValue } : {}),
    ...(parentRelayHint ? { parentRelayHint } : {}),
    ...(parentAuthorPubkey ? { parentAuthorPubkey } : {}),
  }
}

export function getConversationRootReference(event: NostrEvent): ConversationRootReference | null {
  if (event.kind === Kind.ShortNote) {
    const reply = parseTextNoteReply(event)
    return reply
      ? { kind: Kind.ShortNote, eventId: reply.rootEventId }
      : { kind: Kind.ShortNote, eventId: event.id }
  }

  if (event.kind === Kind.Comment) {
    const comment = parseCommentEvent(event)
    if (!comment) return null

    return {
      kind: parseNumericKind(comment.rootKind),
      ...(comment.rootEventId ? { eventId: comment.rootEventId } : {}),
      ...(comment.rootAddress ? { address: comment.rootAddress } : {}),
    }
  }

  const address = getEventAddressCoordinate(event)
  return {
    kind: event.kind,
    ...(address ? { address } : { eventId: event.id }),
  }
}

export function isThreadComment(comment: ParsedCommentEvent): boolean {
  return parseNumericKind(comment.rootKind) === Kind.Thread
}

/** True if the kind-1 note is a direct or nested NIP-10 reply. */
export function isTextNoteReply(event: NostrEvent): boolean {
  return parseTextNoteReply(event) !== null
}

/**
 * True if the event has at least one NIP-18 q-tag.
 *
 * Note: an event can be both a reply AND have q-tags (a quote-reply).
 * Use alongside isTextNoteReply() to distinguish the two in the UI.
 */
export function hasQuoteTags(event: NostrEvent): boolean {
  return parseQuoteTags(event).length > 0
}

/**
 * True if the kind-1 note is a "pure" quote repost:
 * it has NIP-18 q-tags but no NIP-10 reply e-tags.
 *
 * A quote-reply (both markers present) returns false —
 * use isTextNoteReply() + hasQuoteTags() to detect that case.
 */
export function isQuoteRepost(event: NostrEvent): boolean {
  if (event.kind !== Kind.ShortNote) return false
  return hasQuoteTags(event) && !isTextNoteReply(event)
}

export async function publishThread({
  title,
  body = '',
  signal,
}: PublishThreadOptions): Promise<NostrEvent> {
  const normalizedTitle = normalizeThreadTitle(title)
  if (normalizedTitle.length === 0) {
    throw new Error('Threads must include a title.')
  }

  const prepared = preparePlainConversationContent(body)
  return publishConversationEvent(
    Kind.Thread,
    prepared.content,
    [['title', normalizedTitle], ...prepared.tags],
    signal,
  )
}

export async function publishTextReply({
  target,
  body = '',
  signal,
}: PublishReplyOptions): Promise<NostrEvent> {
  if (target.kind !== Kind.ShortNote) {
    throw new Error('Kind-1 replies can only target kind-1 notes.')
  }

  const prepared = preparePlainConversationContent(body)
  const relayHint = await resolveRelayHint(target.pubkey)

  return publishConversationEvent(
    Kind.ShortNote,
    prepared.content,
    [...buildNip10ReplyTags(target, relayHint), ...prepared.tags],
    signal,
  )
}

export async function publishComment({
  target,
  body = '',
  signal,
}: PublishReplyOptions): Promise<NostrEvent> {
  if (target.kind === Kind.ShortNote) {
    throw new Error('Kind-1111 comments must not reply to kind-1 notes; use NIP-10 replies instead.')
  }

  const prepared = preparePlainConversationContent(body)
  let scopeTags: string[][]

  if (target.kind === Kind.Comment) {
    const parsedTarget = parseCommentEvent(target)
    if (!parsedTarget) {
      throw new Error('Cannot reply to a malformed kind-1111 comment.')
    }

    if (isThreadComment(parsedTarget)) {
      // Root scope = the thread (from parsedTarget's root).
      // Parent scope = the intermediate kind-1111 comment (target itself).
      // The old code incorrectly mapped root scope tags to lowercase, making
      // parent point at the thread instead of the comment being replied to.
      scopeTags = [
        ...buildRootScopeTagsFromParsedComment(parsedTarget),
        ...buildParentScopeTagsFromEvent(
          target,
          await resolveRelayHint(target.pubkey, parsedTarget.rootRelayHint),
        ),
      ]
    } else {
      scopeTags = [
        ...buildRootScopeTagsFromParsedComment(parsedTarget),
        ...buildParentScopeTagsFromEvent(
          target,
          await resolveRelayHint(target.pubkey, parsedTarget.parentRelayHint),
        ),
      ]
    }
  } else {
    const relayHint = await resolveRelayHint(target.pubkey)
    scopeTags = [
      ...buildRootScopeTagsFromEvent(target, relayHint),
      ...buildParentScopeTagsFromEvent(target, relayHint),
    ]
  }

  return publishConversationEvent(
    Kind.Comment,
    prepared.content,
    [...scopeTags, ...prepared.tags],
    signal,
  )
}
