export type SyndicationFormat = 'rss' | 'atom' | 'rdf' | 'json'

export interface SyndicationPodcastFunding {
  url: string
  value?: string
}

export interface SyndicationPodcastPerson {
  name: string
  role?: string
  group?: string
  href?: string
  image?: string
}

export interface SyndicationPodcastTranscript {
  url: string
  type?: string
  language?: string
  rel?: string
}

export interface SyndicationPodcastChapters {
  url: string
  type?: string
}

export interface SyndicationPodcastSoundbite {
  startTime: number
  duration: number
  title?: string
}

export interface SyndicationPodcastValueRecipient {
  name?: string
  type?: string
  address: string
  split?: number
  customKey?: string
  customValue?: string
}

export interface SyndicationPodcastValue {
  type?: string
  method?: string
  currency?: string
  suggested?: number
  recipients: SyndicationPodcastValueRecipient[]
}

export interface SyndicationPodcastSocialInteract {
  url?: string
  protocol?: string
  accountId?: string
  priority?: number
}

export interface SyndicationPodcastMeta {
  guid?: string
  medium?: string
  episode?: number
  season?: number
  episodeType?: string
  image?: string
  trailer?: boolean
  explicit?: boolean
  complete?: boolean
  block?: boolean
  locked?: boolean
  funding: SyndicationPodcastFunding[]
  persons: SyndicationPodcastPerson[]
  transcripts: SyndicationPodcastTranscript[]
  chapters?: SyndicationPodcastChapters
  soundbites: SyndicationPodcastSoundbite[]
  value?: SyndicationPodcastValue
  social: SyndicationPodcastSocialInteract[]
}

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
  podcast?: SyndicationPodcastMeta
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
  podcast?: SyndicationPodcastMeta
}

export type SyndicationDocumentFormat = 'rss' | 'atom' | 'json'

export interface SyndicationDocument {
  format: SyndicationDocumentFormat
  mimeType: string
  fileName: string
  content: string
}
