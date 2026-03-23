export type SyndicationFormat = 'rss' | 'atom' | 'rdf' | 'json'

export interface SyndicationAttachment {
  url: string
  mimeType?: string
  title?: string
  sizeInBytes?: number
  durationSeconds?: number
}

export interface SyndicationEntry {
  id: string
  url?: string
  externalUrl?: string
  title?: string
  summary?: string
  contentText?: string
  contentHtml?: string
  image?: string
  publishedAt?: string
  updatedAt?: string
  authors: string[]
  tags: string[]
  attachments: SyndicationAttachment[]
}

export interface SyndicationFeed {
  format: SyndicationFormat
  sourceUrl?: string
  feedUrl?: string
  homePageUrl?: string
  title: string
  description?: string
  icon?: string
  favicon?: string
  language?: string
  authors: string[]
  items: SyndicationEntry[]
}

export type SyndicationDocumentFormat = 'rss' | 'atom' | 'json'

export interface SyndicationDocument {
  format: SyndicationDocumentFormat
  mimeType: string
  fileName: string
  content: string
}
