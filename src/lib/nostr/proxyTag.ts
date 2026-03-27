/**
 * NIP-48 Proxy Tags
 *
 * Detects posts that were bridged from other protocols (ActivityPub, ATProto,
 * RSS, Web) via the `["proxy", <id>, <protocol>]` event tag.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/48.md
 */

import type { NostrEvent } from '@/types'

export type ProxyProtocol = 'activitypub' | 'atproto' | 'rss' | 'web'

export interface ProxyInfo {
  protocol: ProxyProtocol
  /** Source identifier (URL or AT URI depending on protocol) */
  id: string
}

interface ProtocolMeta {
  /** Human-readable label */
  label: string
  /** Tailwind classes for adaptive light/dark badge (ExpandedNote) */
  badgeClass: string
  /** Inline background for glass-panel dark-context pill (HeroCard) */
  glassBackground: string
  /** Inline text colour for glass-panel dark-context pill (HeroCard) */
  glassColor: string
}

const PROTOCOL_META: Record<ProxyProtocol, ProtocolMeta> = {
  activitypub: {
    label:           'ActivityPub',
    badgeClass:      'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    glassBackground: 'rgba(139,92,246,0.22)',
    glassColor:      'rgba(196,181,253,0.92)',
  },
  atproto: {
    label:           'Bluesky',
    badgeClass:      'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    glassBackground: 'rgba(14,165,233,0.22)',
    glassColor:      'rgba(125,211,252,0.92)',
  },
  rss: {
    label:           'RSS Feed',
    badgeClass:      'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    glassBackground: 'rgba(249,115,22,0.22)',
    glassColor:      'rgba(253,186,116,0.92)',
  },
  web: {
    label:           'Web',
    badgeClass:      'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
    glassBackground: 'rgba(255,255,255,0.14)',
    glassColor:      'rgba(255,255,255,0.82)',
  },
}

/**
 * Extracts NIP-48 proxy tag information from a Nostr event.
 * Returns null if no valid proxy tag is present.
 */
export function getProxyInfo(event: NostrEvent): ProxyInfo | null {
  const tag = event.tags.find(t => t[0] === 'proxy' && t.length >= 3)
  if (!tag) return null
  const id = tag[1]
  const protocol = tag[2]?.toLowerCase()
  if (!id || !protocol) return null
  if (!isProxyProtocol(protocol)) return null
  return { protocol, id }
}

export function getProtocolMeta(protocol: ProxyProtocol): ProtocolMeta {
  return PROTOCOL_META[protocol]
}

function isProxyProtocol(value: string): value is ProxyProtocol {
  return value === 'activitypub' || value === 'atproto' || value === 'rss' || value === 'web'
}
