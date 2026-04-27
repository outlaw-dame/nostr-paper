import { sanitizeText } from '@/lib/security/sanitize'

const SENTENCE_BREAK_RE = /(?<=[.!?])\s+/g
const HARD_BREAK_RE = /\n+/g

export function normalizeTranslationSourceText(text: string): string {
  return sanitizeText(text).replace(/\r\n?/g, '\n').trim()
}

export function hasMeaningfulTranslationText(text: string): boolean {
  const normalized = normalizeTranslationSourceText(text)
  if (!normalized) return false

  const words = normalized.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? []
  if (words.length === 0) return false

  const letterCount = (normalized.match(/\p{L}/gu) ?? []).length
  if (letterCount === 0) return false

  return words.join('').length >= 2
}

function splitLongSegment(text: string, maxChars: number): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  if (normalized.length <= maxChars) return [normalized]

  const lines = normalized.split(HARD_BREAK_RE).map(line => line.trim()).filter(Boolean)
  const lineSource = lines.length > 1 ? lines : normalized.split(SENTENCE_BREAK_RE).map(line => line.trim()).filter(Boolean)
  const parts = lineSource.length > 0 ? lineSource : [normalized]
  const output: string[] = []
  let current = ''

  for (const part of parts) {
    const next = current ? `${current} ${part}` : part
    if (next.length <= maxChars) {
      current = next
      continue
    }

    if (current) {
      output.push(current)
      current = ''
    }

    if (part.length <= maxChars) {
      current = part
      continue
    }

    for (let index = 0; index < part.length; index += maxChars) {
      const slice = part.slice(index, index + maxChars).trim()
      if (slice) output.push(slice)
    }
  }

  if (current) output.push(current)
  return output
}

export function splitTextForTranslation(text: string, maxChars: number): string[] {
  const normalized = normalizeTranslationSourceText(text)
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) return []

  return paragraphs.flatMap(paragraph => splitLongSegment(paragraph, maxChars))
}

export function batchTranslationSegments(
  segments: string[],
  maxItems: number,
): string[][] {
  if (!Number.isInteger(maxItems) || maxItems < 1) {
    throw new Error('maxItems must be a positive integer.')
  }

  const batches: string[][] = []
  let current: string[] = []

  for (const segment of segments) {
    current.push(segment)
    if (current.length >= maxItems) {
      batches.push(current)
      current = []
    }
  }

  if (current.length > 0) {
    batches.push(current)
  }

  return batches
}

export function joinTranslatedSegments(segments: string[]): string {
  return segments
    .map(segment => segment.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

export function markdownToPlainText(markdown: string): string {
  const normalized = normalizeTranslationSourceText(markdown)
  if (!normalized) return ''

  return normalized
    .replace(/```[^\n]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
