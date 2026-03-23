export const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g
export const HASHTAG_PATTERN = /#([a-zA-Z][a-zA-Z0-9_]{0,100})/g
export const CASHTAG_PATTERN = /\$([a-zA-Z][a-zA-Z0-9]{0,15})/g
export const NOSTR_PATTERN = /nostr:[a-zA-Z0-9]+/g

const ENTITY_PRECEDING_CHAR = /[A-Za-z0-9_]/

export function hasEntityBoundaryBefore(text: string, index: number): boolean {
  if (index <= 0) return true
  return !ENTITY_PRECEDING_CHAR.test(text[index - 1] ?? '')
}
