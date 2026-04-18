import { useMemo } from 'react'
import { useLinkPreview } from '@/hooks/useLinkPreview'
import { rankVideoPlaybackCandidates } from '@/lib/media/playback'
import { parseContentWarning } from '@/lib/nostr/contentWarning'
import { getEventMediaAttachments, getImetaHiddenUrls, getMediaAttachmentPreviewUrl } from '@/lib/nostr/imeta'
import { parseLongFormEvent } from '@/lib/nostr/longForm'
import { parsePollEvent } from '@/lib/nostr/polls'
import { getQuotePostBody, getRepostPreviewText, parseQuoteTags, parseRepostEvent } from '@/lib/nostr/repost'
import {
  getPrimaryStorySourceUrl,
  getStoryHostname,
  isArticleStoryKind,
  isVideoStoryKind,
  pickStorySummary,
} from '@/lib/nostr/storyPreview'
import { parseThreadEvent } from '@/lib/nostr/thread'
import { sanitizeText } from '@/lib/security/sanitize'
import { getVideoPreviewImage, parseVideoEvent } from '@/lib/nostr/video'
import type { NostrEvent } from '@/types'

interface UseStoryCardPreviewOptions {
  ogEnabled?: boolean
}

export function useStoryCardPreview(
  event: NostrEvent,
  options: UseStoryCardPreviewOptions = {},
) {
  const article = useMemo(() => parseLongFormEvent(event), [event])
  const poll = useMemo(() => parsePollEvent(event), [event])
  const video = useMemo(() => parseVideoEvent(event), [event])
  const repost = useMemo(() => parseRepostEvent(event), [event])
  const thread = useMemo(() => parseThreadEvent(event), [event])
  const contentWarning = useMemo(() => parseContentWarning(event), [event])
  const quoteBody = useMemo(() => getQuotePostBody(event), [event])
  const quoteCount = useMemo(() => parseQuoteTags(event).length, [event])
  const attachments = useMemo(() => getEventMediaAttachments(event), [event])
  const hiddenUrls = useMemo(() => getImetaHiddenUrls(event), [event])
  const isArticleStory = article !== null || isArticleStoryKind(event.kind)
  const isVideoStory = video !== null || isVideoStoryKind(event.kind)
  const isStoryCard = isArticleStory || isVideoStory
  const storySourceUrl = useMemo(
    () => getPrimaryStorySourceUrl(event, video),
    [event, video],
  )

  const shouldFetchStoryMeta = Boolean(options.ogEnabled ?? true) && isStoryCard && Boolean(storySourceUrl)
  const { data: storyMeta, loading: storyMetaLoading } = useLinkPreview(storySourceUrl, {
    enabled: shouldFetchStoryMeta,
  })

  const attachmentPreview = useMemo(
    () => attachments
      .map((attachment) => getMediaAttachmentPreviewUrl(attachment))
      .find((url): url is string => typeof url === 'string'),
    [attachments],
  )
  const videoPlaybackPlan = useMemo(
    () => (video ? rankVideoPlaybackCandidates(video.variants)[0] : undefined),
    [video],
  )

  const articlePreview = isArticleStory
    ? article?.image ?? storyMeta?.image ?? attachmentPreview
    : undefined
  const videoPoster = isVideoStory
    ? (video ? getVideoPreviewImage(video) : undefined) ?? storyMeta?.image ?? attachmentPreview
    : undefined
  const primaryMedia = isArticleStory
    ? articlePreview
    : isVideoStory
      ? videoPoster ?? attachmentPreview ?? storyMeta?.image
      : attachmentPreview
  const storyTitle = article?.title ?? video?.title ?? thread?.title ?? storyMeta?.title ?? ''
  const storySummary = pickStorySummary(
    article?.summary ?? video?.summary ?? (isStoryCard ? '' : thread?.content ?? ''),
    storySourceUrl,
    storyMeta?.description,
  )
  const storyAuthor = storyMeta?.author
  const storyNostrCreator = storyMeta?.nostrCreator
  const storyNostrNip05 = storyMeta?.nostrNip05
  const storyHostname = getStoryHostname(storyMeta?.url ?? storySourceUrl)
  const storySiteName = storyMeta?.siteName ?? getStoryHostname(storyMeta?.url ?? storySourceUrl)
  const previewText = pickStorySummary(
    (article?.summary ?? video?.summary ?? thread?.content) ?? (
      repost
        ? getRepostPreviewText(event)
        : (sanitizeText(quoteBody).trim() || (quoteCount > 0 ? 'Quoted an event' : sanitizeText(event.content)))
    ),
    storySourceUrl,
    storyMeta?.description,
  )
    .replace(/https?:\/\/\S+/g, '')
    .trim()
    .slice(0, 180)

  return {
    article,
    poll,
    video,
    repost,
    thread,
    attachments,
    hiddenUrls,
    quoteBody,
    contentWarning,
    isArticleStory,
    isVideoStory,
    isStoryCard,
    storySourceUrl,
    storyMeta,
    storyMetaLoading,
    articlePreview,
    attachmentPreview,
    videoPoster,
    videoPlaybackPlan,
    primaryMedia,
    storyTitle,
    storySummary,
    storyAuthor,
    storyNostrCreator,
    storyNostrNip05,
    storyHostname,
    storySiteName,
    previewText,
  }
}
