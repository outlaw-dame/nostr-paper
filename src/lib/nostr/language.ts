import type { NostrEvent } from '@/types'

const ISO_639_NAMESPACE = 'ISO-639-1'
const LANGUAGE_CODE_RE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/

function normalizeLanguageCode(code: string): string | null {
  const normalized = code.trim()
  if (!normalized) return null
  if (!LANGUAGE_CODE_RE.test(normalized)) return null
  return normalized.toLowerCase()
}

function isSupportedLanguageNamespace(namespace: string | undefined): boolean {
  if (!namespace) return false
  const normalized = namespace.trim().toUpperCase()
  return normalized === ISO_639_NAMESPACE || normalized === 'BCP-47'
}

/**
 * Extracts the first language label from an event's NIP-C7 language tags.
 * Supports:
 * - ["L", "ISO-639-1"] namespace + ["l", "en"] value tags
 * - ["l", "en", "ISO-639-1"] explicit namespace value tags
 */
export function extractEventLanguageTag(event: Pick<NostrEvent, 'tags'> | null | undefined): string | null {
  if (!event?.tags?.length) return null

  const hasIsoNamespaceTag = event.tags.some((tag) => (
    tag[0] === 'L' && typeof tag[1] === 'string' && tag[1].trim().toUpperCase() === ISO_639_NAMESPACE
  ))

  for (const tag of event.tags) {
    if (tag[0] !== 'l' || typeof tag[1] !== 'string') continue

    const namespace = typeof tag[2] === 'string' ? tag[2] : undefined
    if (namespace && !isSupportedLanguageNamespace(namespace)) continue
    if (!namespace && !hasIsoNamespaceTag) continue

    const normalized = normalizeLanguageCode(tag[1])
    if (normalized) return normalized
  }

  return null
}
