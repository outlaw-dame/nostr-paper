/**
 * Nostr Page Meta Tags
 *
 * Computes <head> tag descriptors for Nostr content pages.
 *
 * Introduces the `nostr:creator` meta tag — a direct analogue of Mastodon's
 * `fediverse:creator`. When a web page carries this tag, Nostr-aware browser
 * extensions, relay crawlers, and future social clients can attribute the
 * content to its Nostr author without needing to parse the full event.
 *
 * Tag vocabulary:
 *
 *   <meta name="nostr:creator" content="npub1..." />
 *     The author's NIP-19 npub — primary attribution tag.
 *
 *   <meta name="nostr:creator:nip05" content="user@domain" />
 *     Author's NIP-05 identifier when available and verified.
 *     Human-readable, discoverable via /.well-known/nostr.json.
 *
 *   <meta name="nostr:naddr" content="naddr1..." />
 *     NIP-19 naddr of the article itself. Lets any Nostr client open
 *     the canonical event by scanning the page.
 *
 *   <link rel="author" href="nostr:npub1..." />
 *     W3C standard author link relation pointing to the Nostr URI.
 *
 * Combined with standard Open Graph and article:* tags this gives the
 * richest possible metadata for sharing, archiving, and attribution.
 */

import { npubEncode, neventEncode } from 'nostr-tools/nip19'
import type { MetaTagDescriptor } from '@/hooks/usePageHead'
import type { LongFormArticle } from '@/lib/nostr/longForm'
import {
  getPreferredVideoVariant,
  getVideoPreviewImage,
  type ParsedVideoEvent,
} from '@/lib/nostr/video'
import type { NostrEvent, Profile } from '@/types'

const APP_NAME = 'Nostr Paper'

// ── Helpers ──────────────────────────────────────────────────

function toIso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString()
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

// ── Article Meta Tags ────────────────────────────────────────

export interface ArticleMetaOptions {
  article: LongFormArticle
  profile: Profile | null
}

/**
 * Build the full set of <head> tag descriptors for a NIP-23 article page.
 *
 * Returns an array of MetaTagDescriptors ready to pass to usePageHead().
 */
export function buildArticleMetaTags({
  article,
  profile,
}: ArticleMetaOptions): MetaTagDescriptor[] {
  const tags: MetaTagDescriptor[] = []

  const title       = article.title ?? 'Untitled Article'
  const description = article.summary ? truncate(article.summary, 200) : undefined
  const image       = article.image

  // ── Core description ────────────────────────────────────────
  if (description) {
    tags.push({ tag: 'meta', name: 'description', content: description })
  }

  // ── nostr:creator — new Nostr attribution standard ──────────
  //
  // Primary: npub (always available when we have the pubkey)
  let npub: string | null = null
  try {
    npub = npubEncode(article.pubkey)
  } catch {
    // Malformed pubkey — skip Nostr-specific tags
  }

  if (npub) {
    tags.push({ tag: 'meta', name: 'nostr:creator', content: npub })

    // NIP-05 identifier if the profile has one that has been verified
    const nip05 = profile?.nip05
    if (nip05 && profile?.nip05Verified) {
      tags.push({ tag: 'meta', name: 'nostr:creator:nip05', content: nip05 })
    }

    // The article's NIP-19 address — lets any Nostr client open the event
    tags.push({ tag: 'meta', name: 'nostr:naddr', content: article.naddr })

    // W3C author link relation pointing at the Nostr URI
    tags.push({ tag: 'link', rel: 'author', href: `nostr:${npub}` })
  }

  // ── Open Graph ──────────────────────────────────────────────
  tags.push({ tag: 'meta', property: 'og:type',  content: 'article' })
  tags.push({ tag: 'meta', property: 'og:title', content: title })
  if (description) {
    tags.push({ tag: 'meta', property: 'og:description', content: description })
  }
  if (image) {
    tags.push({ tag: 'meta', property: 'og:image', content: image })
  }

  // ── Article metadata ────────────────────────────────────────
  const publishedTime = article.publishedAt ?? article.updatedAt
  tags.push({
    tag: 'meta',
    property: 'article:published_time',
    content: toIso(publishedTime),
  })
  if (article.publishedAt && article.updatedAt !== article.publishedAt) {
    tags.push({
      tag: 'meta',
      property: 'article:modified_time',
      content: toIso(article.updatedAt),
    })
  }
  for (const hashtag of article.hashtags) {
    tags.push({ tag: 'meta', property: 'article:tag', content: hashtag })
  }

  // Author name as OG article:author when profile is available
  const authorName = profile?.display_name ?? profile?.name
  if (authorName) {
    tags.push({ tag: 'meta', property: 'article:author', content: authorName })
  }

  // ── Twitter / X Card ────────────────────────────────────────
  tags.push({
    tag: 'meta',
    name: 'twitter:card',
    content: image ? 'summary_large_image' : 'summary',
  })
  tags.push({ tag: 'meta', name: 'twitter:title', content: title })
  if (description) {
    tags.push({ tag: 'meta', name: 'twitter:description', content: description })
  }
  if (image) {
    tags.push({ tag: 'meta', name: 'twitter:image', content: image })
  }

  return tags
}

/**
 * Build the document <title> string for an article page.
 *   "Article Title — Nostr Paper"
 */
export function buildArticleTitle(article: LongFormArticle): string {
  const title = article.title ? truncate(article.title, 80) : 'Untitled Article'
  return `${title} — ${APP_NAME}`
}

// ── Video Meta Tags ──────────────────────────────────────────

export interface VideoMetaOptions {
  video: ParsedVideoEvent
  profile: Profile | null
}

export function buildVideoMetaTags({
  video,
  profile,
}: VideoMetaOptions): MetaTagDescriptor[] {
  const tags: MetaTagDescriptor[] = []
  const title = video.title
  const description = video.summary ? truncate(video.summary, 200) : undefined
  const image = getVideoPreviewImage(video)
  const primaryVariant = getPreferredVideoVariant(video)

  if (description) {
    tags.push({ tag: 'meta', name: 'description', content: description })
  }

  let npub: string | null = null
  try {
    npub = npubEncode(video.pubkey)
  } catch {
    npub = null
  }

  if (npub) {
    tags.push({ tag: 'meta', name: 'nostr:creator', content: npub })

    if (profile?.nip05 && profile.nip05Verified) {
      tags.push({ tag: 'meta', name: 'nostr:creator:nip05', content: profile.nip05 })
    }

    if (video.naddr) {
      tags.push({ tag: 'meta', name: 'nostr:naddr', content: video.naddr })
    }

    tags.push({ tag: 'link', rel: 'author', href: `nostr:${npub}` })
  }

  tags.push({ tag: 'meta', property: 'og:type', content: 'video.other' })
  tags.push({ tag: 'meta', property: 'og:title', content: title })
  if (description) {
    tags.push({ tag: 'meta', property: 'og:description', content: description })
  }
  if (image) {
    tags.push({ tag: 'meta', property: 'og:image', content: image })
  }
  if (primaryVariant?.url) {
    tags.push({ tag: 'meta', property: 'og:video', content: primaryVariant.url })
    if (primaryVariant.mimeType) {
      tags.push({ tag: 'meta', property: 'og:video:type', content: primaryVariant.mimeType })
    }
  }
  if (video.durationSeconds !== undefined) {
    tags.push({ tag: 'meta', property: 'video:duration', content: String(Math.round(video.durationSeconds)) })
  }

  tags.push({
    tag: 'meta',
    name: 'twitter:card',
    content: image ? 'summary_large_image' : 'summary',
  })
  tags.push({ tag: 'meta', name: 'twitter:title', content: title })
  if (description) {
    tags.push({ tag: 'meta', name: 'twitter:description', content: description })
  }
  if (image) {
    tags.push({ tag: 'meta', name: 'twitter:image', content: image })
  }

  return tags
}

export function buildVideoTitle(video: ParsedVideoEvent): string {
  return `${truncate(video.title, 80)} — ${APP_NAME}`
}

// ── Short Note Meta Tags ──────────────────────────────────────

export interface NoteMetaOptions {
  event: NostrEvent
  profile: Profile | null
  /** First image attachment URL, if available. */
  imageUrl?: string | null
}

function deriveNoteHeadline(event: NostrEvent, profile: Profile | null): string {
  const firstLine = event.content.split('\n').find((l) => l.trim().length > 0)?.trim()
  const authorName = profile?.display_name ?? profile?.name
  if (firstLine && firstLine.length >= 10) return truncate(firstLine, 80)
  if (authorName) return `Note by ${truncate(authorName, 60)}`
  return 'Note'
}

export function buildNoteTitle(event: NostrEvent, profile: Profile | null): string {
  return `${deriveNoteHeadline(event, profile)} — ${APP_NAME}`
}

export function buildNoteMetaTags({ event, profile, imageUrl }: NoteMetaOptions): MetaTagDescriptor[] {
  const tags: MetaTagDescriptor[] = []
  const headline    = deriveNoteHeadline(event, profile)
  const description = truncate(event.content.replace(/\s+/g, ' ').trim(), 300)
  const authorName  = profile?.display_name ?? profile?.name

  let npub: string | null = null
  try { npub = npubEncode(event.pubkey) } catch { /* skip */ }

  let nevent: string | null = null
  try { nevent = neventEncode({ id: event.id }) } catch { /* skip */ }

  // ── Nostr attribution ───────────────────────────────────────
  if (npub) {
    tags.push({ tag: 'meta', name: 'nostr:creator', content: npub })
    if (profile?.nip05 && profile.nip05Verified) {
      tags.push({ tag: 'meta', name: 'nostr:creator:nip05', content: profile.nip05 })
    }
    tags.push({ tag: 'link', rel: 'author', href: `nostr:${npub}` })
  }
  if (nevent) {
    tags.push({ tag: 'meta', name: 'nostr:nevent', content: nevent })
  }

  // ── Core description ────────────────────────────────────────
  if (description) {
    tags.push({ tag: 'meta', name: 'description', content: description })
  }

  // ── Open Graph ──────────────────────────────────────────────
  tags.push({ tag: 'meta', property: 'og:type',  content: 'article' })
  tags.push({ tag: 'meta', property: 'og:title', content: headline })
  if (description) {
    tags.push({ tag: 'meta', property: 'og:description', content: description })
  }
  if (imageUrl) {
    tags.push({ tag: 'meta', property: 'og:image', content: imageUrl })
  }
  tags.push({
    tag: 'meta',
    property: 'article:published_time',
    content: toIso(event.created_at),
  })
  if (authorName) {
    tags.push({ tag: 'meta', property: 'article:author', content: authorName })
  }

  // ── Twitter / X Card ────────────────────────────────────────
  tags.push({
    tag: 'meta',
    name: 'twitter:card',
    content: imageUrl ? 'summary_large_image' : 'summary',
  })
  tags.push({ tag: 'meta', name: 'twitter:title',       content: headline })
  if (description) {
    tags.push({ tag: 'meta', name: 'twitter:description', content: description })
  }
  if (imageUrl) {
    tags.push({ tag: 'meta', name: 'twitter:image', content: imageUrl })
  }

  return tags
}

// ── Profile Meta Tags ────────────────────────────────────────

export interface ProfileMetaOptions {
  profile: Profile | null
  pubkey: string
}

export function buildProfileTitle(profile: Profile | null): string {
  const name = profile?.display_name ?? profile?.name ?? 'Nostr Profile'
  return `${truncate(name, 80)} — ${APP_NAME}`
}

export function buildProfileMetaTags({ profile, pubkey }: ProfileMetaOptions): MetaTagDescriptor[] {
  const tags: MetaTagDescriptor[] = []
  const name        = profile?.display_name ?? profile?.name ?? 'Nostr Profile'
  const description = profile?.about ? truncate(profile.about.replace(/\s+/g, ' ').trim(), 300) : undefined
  // Prefer avatar; fall back to banner (it's wider, but better than nothing)
  const imageUrl    = profile?.picture ?? profile?.banner ?? undefined

  let npub: string | null = null
  try { npub = npubEncode(pubkey) } catch { /* skip */ }

  // ── Nostr attribution ───────────────────────────────────────
  if (npub) {
    tags.push({ tag: 'meta', name: 'nostr:creator', content: npub })
    if (profile?.nip05) {
      tags.push({ tag: 'meta', name: 'nostr:creator:nip05', content: profile.nip05 })
    }
    tags.push({ tag: 'link', rel: 'author', href: `nostr:${npub}` })
  }

  // ── Core description ────────────────────────────────────────
  if (description) {
    tags.push({ tag: 'meta', name: 'description', content: description })
  }

  // ── Open Graph ──────────────────────────────────────────────
  tags.push({ tag: 'meta', property: 'og:type',  content: 'profile' })
  tags.push({ tag: 'meta', property: 'og:title', content: name })
  if (description) {
    tags.push({ tag: 'meta', property: 'og:description', content: description })
  }
  if (imageUrl) {
    tags.push({ tag: 'meta', property: 'og:image', content: imageUrl })
  }

  // ── Twitter / X Card ────────────────────────────────────────
  tags.push({ tag: 'meta', name: 'twitter:card',  content: 'summary' })
  tags.push({ tag: 'meta', name: 'twitter:title', content: name })
  if (description) {
    tags.push({ tag: 'meta', name: 'twitter:description', content: description })
  }
  if (imageUrl) {
    tags.push({ tag: 'meta', name: 'twitter:image', content: imageUrl })
  }

  return tags
}
