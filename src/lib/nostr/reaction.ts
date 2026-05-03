import { NDKEvent } from '@nostr-dev-kit/ndk'
import { getEventReadRelayHints, insertEvent } from '@/lib/db/nostr'
import { withOptionalClientTag } from '@/lib/nostr/appHandlers'
import { getLongFormIdentifier } from '@/lib/nostr/longForm'
import { getDefaultRelayUrls, getNDK } from '@/lib/nostr/ndk'
import { buildQuoteTagsFromContent } from '@/lib/nostr/repost'
import { publishEventWithNip65Outbox } from '@/lib/nostr/outbox'
import {
  isSafeMediaURL,
  isValidHex32,
  sanitizeText,
} from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'

const MAX_REACTION_CONTENT_CHARS = 64
const CUSTOM_EMOJI_PATTERN = /^:([a-zA-Z0-9_+-]{1,64}):$/

export interface ParsedReactionEvent {
  id: string
  pubkey: string
  createdAt: number
  targetEventId: string
  targetPubkey?: string
  targetCoordinate?: string
  targetKind?: number
  content: string
  type: 'like' | 'dislike' | 'emoji' | 'custom-emoji' | 'other'
  emojiName?: string
  emojiUrl?: string
}

export interface PublishReactionOptions {
  content?: string
  emojiUrl?: string
}

function getLastTag(event: NostrEvent, name: string): string[] | undefined {
  let found: string[] | undefined
  for (const tag of event.tags) {
    if (tag[0] === name && typeof tag[1] === 'string') {
      found = tag
    }
  }
  return found
}

function parseTargetKind(event: NostrEvent): number | undefined {
  const tag = getLastTag(event, 'k')
  if (!tag?.[1] || !/^\d{1,10}$/.test(tag[1])) return undefined
  const kind = Number(tag[1])
  return Number.isSafeInteger(kind) && kind >= 0 ? kind : undefined
}

function normalizeReactionContent(content: string): string {
  const sanitized = sanitizeText(content).trim().slice(0, MAX_REACTION_CONTENT_CHARS)
  return sanitized.length > 0 ? sanitized : '+'
}

function parseCustomEmoji(event: NostrEvent, content: string): {
  emojiName: string
  emojiUrl: string
} | null {
  const shortcode = content.match(CUSTOM_EMOJI_PATTERN)?.[1]
  if (!shortcode) return null

  const emojiTags = event.tags.filter(tag => tag[0] === 'emoji')
  if (emojiTags.length !== 1) return null

  const tag = emojiTags[0]
  if (tag?.[1] !== shortcode || !tag[2] || !isSafeMediaURL(tag[2])) return null

  return {
    emojiName: shortcode,
    emojiUrl: tag[2],
  }
}

function classifyReaction(
  event: NostrEvent,
  content: string,
): Pick<ParsedReactionEvent, 'type' | 'emojiName' | 'emojiUrl'> {
  const customEmoji = parseCustomEmoji(event, content)
  if (customEmoji) {
    return {
      type: 'custom-emoji',
      emojiName: customEmoji.emojiName,
      emojiUrl: customEmoji.emojiUrl,
    }
  }

  if (content === '' || content === '+') return { type: 'like' }
  if (content === '-') return { type: 'dislike' }
  if ([...content].length === 1) return { type: 'emoji' }
  return { type: 'other' }
}

function getAddressCoordinate(event: NostrEvent): string | undefined {
  const identifier = getLongFormIdentifier(event)
  if (!identifier) return undefined
  return `${event.kind}:${event.pubkey}:${identifier}`
}

async function resolveRelayHint(target: NostrEvent): Promise<string> {
  const relayHints = await getEventReadRelayHints(target.pubkey, 1)
  if (relayHints[0]) return relayHints[0]

  const defaultRelay = getDefaultRelayUrls()[0]
  if (!defaultRelay) {
    throw new Error('No relay hint available for reaction target.')
  }
  return defaultRelay
}

export function parseReactionEvent(event: NostrEvent): ParsedReactionEvent | null {
  if (event.kind !== 7) return null

  const eTag = getLastTag(event, 'e')
  if (!eTag?.[1] || !isValidHex32(eTag[1])) return null

  const pTag = getLastTag(event, 'p')
  const aTag = getLastTag(event, 'a')
  const targetKind = parseTargetKind(event)
  const content = normalizeReactionContent(event.content)
  const classification = classifyReaction(event, content)

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    targetEventId: eTag[1],
    ...(pTag?.[1] && isValidHex32(pTag[1]) ? { targetPubkey: pTag[1] } : {}),
    ...(aTag?.[1] ? { targetCoordinate: aTag[1] } : {}),
    ...(targetKind !== undefined ? { targetKind } : {}),
    content,
    ...classification,
  }
}

export async function publishReaction(
  target: NostrEvent,
  options: string | PublishReactionOptions = '+',
  signal?: AbortSignal,
): Promise<NostrEvent> {
  const ndk = getNDK()
  if (!ndk.signer) {
    throw new Error('No signer available — install a NIP-07 extension to publish reactions.')
  }

  const relayHint = await resolveRelayHint(target)
  const normalizedContent = normalizeReactionContent(
    typeof options === 'string' ? options : (options.content ?? '+'),
  )
  const customEmojiUrl = typeof options === 'string' ? undefined : options.emojiUrl
  const address = getAddressCoordinate(target)

  const tags: string[][] = [
    ['e', target.id, relayHint, target.pubkey],
    ['p', target.pubkey, relayHint],
    ['k', String(target.kind)],
  ]

  if (address) {
    tags.push(['a', address, relayHint, target.pubkey])
  }

  const customEmoji = normalizedContent.match(CUSTOM_EMOJI_PATTERN)
  if (customEmoji) {
    if (!customEmojiUrl || !isSafeMediaURL(customEmojiUrl)) {
      throw new Error('Custom emoji reactions require a safe emoji media URL.')
    }
    tags.push(['emoji', customEmoji[1]!, customEmojiUrl])
  }

  const event = new NDKEvent(ndk)
  event.kind = 7
  event.content = normalizedContent
  event.tags = await withOptionalClientTag([
    ...tags,
    ...buildQuoteTagsFromContent(normalizedContent),
  ], signal)

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  await event.sign()
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  await publishEventWithNip65Outbox(event, signal)

  const rawEvent = event.rawEvent() as unknown as NostrEvent
  await insertEvent(rawEvent)
  return rawEvent
}

export function getReactionLabel(reaction: ParsedReactionEvent): string {
  switch (reaction.type) {
    case 'like':
      return 'Liked'
    case 'dislike':
      return 'Disliked'
    case 'custom-emoji':
      return `Reacted with :${reaction.emojiName}:`
    case 'emoji':
      return `Reacted with ${reaction.content}`
    default:
      return `Reacted with ${reaction.content}`
  }
}
