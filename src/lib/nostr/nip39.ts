import { isSafeURL, sanitizeText } from '@/lib/security/sanitize'
import type { Nip39ExternalIdentity } from '@/types'

const MAX_PLATFORM_CHARS = 64
const MAX_IDENTITY_CHARS = 512
const MAX_IDENTITIES = 20

export function getPlatformDisplayName(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'github':   return 'GitHub'
    case 'twitter':  return 'Twitter'
    case 'mastodon': return 'Mastodon'
    case 'telegram': return 'Telegram'
    default:         return platform.charAt(0).toUpperCase() + platform.slice(1)
  }
}

function normalizePlatform(value: string): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0 || normalized.length > MAX_PLATFORM_CHARS) return null
  if (!/^[a-z0-9-]+$/.test(normalized)) return null
  return normalized
}

function normalizeIdentity(value: string): string | null {
  if (typeof value !== 'string') return null
  const sanitized = sanitizeText(value).trim()
  if (sanitized.length === 0 || sanitized.length > MAX_IDENTITY_CHARS) return null
  return sanitized
}

// Parse NIP-39 "i" tags from a kind-0 event's tag array.
// Format: ["i", "platform:identity", "proof_url"]
export function parseNip39IdentityTags(tags: string[][]): Nip39ExternalIdentity[] {
  const identities: Nip39ExternalIdentity[] = []
  const seen = new Set<string>()

  for (const tag of tags) {
    if (identities.length >= MAX_IDENTITIES) break
    if (!Array.isArray(tag) || tag[0] !== 'i' || typeof tag[1] !== 'string') continue

    const raw = tag[1]
    const colonIndex = raw.indexOf(':')
    if (colonIndex <= 0) continue

    const platform = normalizePlatform(raw.slice(0, colonIndex))
    const identity = normalizeIdentity(raw.slice(colonIndex + 1))
    if (!platform || !identity) continue

    const key = `${platform}:${identity}`
    if (seen.has(key)) continue
    seen.add(key)

    const rawProof = typeof tag[2] === 'string' ? tag[2].trim() : undefined
    const proof = rawProof && rawProof.length > 0 && rawProof.length <= 2048 && isSafeURL(rawProof)
      ? rawProof
      : undefined

    identities.push({ platform, identity, ...(proof ? { proof } : {}) })
  }

  return identities
}

// Build "i" tags for publishing a kind-0 event.
export function buildNip39Tags(identities: Nip39ExternalIdentity[]): string[][] {
  return identities
    .filter((id) => id.platform.length > 0 && id.identity.length > 0)
    .map((id) => {
      const tag = ['i', `${id.platform}:${id.identity}`]
      if (id.proof) tag.push(id.proof)
      return tag
    })
}

// Get a profile URL for a platform identity (for display linking).
export function getIdentityUrl(identity: Nip39ExternalIdentity): string | null {
  const { platform, identity: id } = identity
  switch (platform) {
    case 'github':
      return `https://github.com/${encodeURIComponent(id)}`
    case 'twitter':
      return `https://x.com/${encodeURIComponent(id)}`
    case 'mastodon': {
      const atIndex = id.lastIndexOf('@')
      if (atIndex <= 0) return null
      const user = id.slice(0, atIndex)
      const instance = id.slice(atIndex + 1)
      if (!user || !instance) return null
      return `https://${instance}/@${encodeURIComponent(user)}`
    }
    case 'telegram':
      return `https://t.me/${encodeURIComponent(id)}`
    default:
      return null
  }
}
