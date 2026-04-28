export const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g
export const HASHTAG_PATTERN = /#([a-zA-Z][a-zA-Z0-9_]{0,100})/g
export const CASHTAG_PATTERN = /\$([a-zA-Z][a-zA-Z0-9]{0,15})/g
export const NOSTR_PATTERN = /(?:nostr:)?(?:npub1|nprofile1|note1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+/g

export function isNostrReferenceToken(value: string): boolean {
  return /^(?:nostr:)?(?:npub1|nprofile1|note1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]+$/i.test(value.trim())
}

const ENTITY_PRECEDING_CHAR = /[A-Za-z0-9_]/

export function hasEntityBoundaryBefore(text: string, index: number): boolean {
  if (index <= 0) return true
  return !ENTITY_PRECEDING_CHAR.test(text[index - 1] ?? '')
}
