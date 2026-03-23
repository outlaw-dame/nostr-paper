import { markdownToPlainText } from '@/lib/translation/text'
import type {
  SyndicationAttachment,
  SyndicationEntry,
  SyndicationFeed,
} from '@/lib/syndication/types'

export interface ImportedArticleDraft {
  title: string
  summary?: string
  content: string
  image?: string
  hashtags: string[]
  sourceUrl?: string
}

export interface ImportedVideoDraft {
  title: string
  summary?: string
  previewImage?: string
  sourceUrl?: string
  hashtags: string[]
  attachments: SyndicationAttachment[]
}

function cleanText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d{1,6});/g, (_match, digits: string) => {
      const codePoint = Number.parseInt(digits, 10)
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ''
    })
}

function htmlToPlainText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '- ')
      .replace(/<\/(p|div|section|article|blockquote|li|ul|ol|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' '),
  ).trim()
}

function isLikelyVideoOrAudioAttachment(attachment: SyndicationAttachment): boolean {
  const mimeType = attachment.mimeType?.toLowerCase() ?? ''
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return true

  try {
    const extension = new URL(attachment.url).pathname.toLowerCase().split('.').pop() ?? ''
    return ['mp4', 'm4v', 'mov', 'webm', 'm3u8', 'mp3', 'm4a', 'ogg', 'oga', 'wav'].includes(extension)
  } catch {
    return false
  }
}

function buildEntryText(entry: SyndicationEntry): string {
  const fromText = cleanText(entry.contentText)
  if (fromText) return fromText

  const fromHtml = cleanText(entry.contentHtml)
  if (fromHtml) {
    const plainText = htmlToPlainText(fromHtml)
    if (plainText) return markdownToPlainText(plainText)
  }

  const fromSummary = cleanText(entry.summary)
  if (fromSummary) return fromSummary

  return ''
}

export function buildImportedArticleDraft(
  feed: SyndicationFeed,
  entry: SyndicationEntry,
): ImportedArticleDraft | null {
  const title = cleanText(entry.title) ?? cleanText(feed.title)
  if (!title) return null

  const content = buildEntryText(entry)
  const summary = cleanText(entry.summary) ?? cleanText(feed.description)

  return {
    title,
    ...(summary ? { summary } : {}),
    content: content || summary || title,
    ...(entry.image ? { image: entry.image } : {}),
    hashtags: entry.tags,
    ...(entry.url || entry.externalUrl || feed.homePageUrl
      ? { sourceUrl: entry.url ?? entry.externalUrl ?? feed.homePageUrl }
      : {}),
  }
}

export function buildImportedVideoDraft(
  feed: SyndicationFeed,
  entry: SyndicationEntry,
): ImportedVideoDraft | null {
  const title = cleanText(entry.title) ?? cleanText(feed.title)
  if (!title) return null

  const summary = cleanText(entry.summary) ?? cleanText(feed.description)
  const mediaAttachments = entry.attachments.filter(isLikelyVideoOrAudioAttachment)

  return {
    title,
    ...(summary ? { summary } : {}),
    ...(entry.image ? { previewImage: entry.image } : {}),
    ...(entry.url || entry.externalUrl || feed.homePageUrl
      ? { sourceUrl: entry.url ?? entry.externalUrl ?? feed.homePageUrl }
      : {}),
    hashtags: entry.tags,
    attachments: mediaAttachments,
  }
}
