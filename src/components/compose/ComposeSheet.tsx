import { useEffect, useMemo, useRef, useState } from 'react'
import { Sheet } from 'konsta/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BlossomUpload } from '@/components/blossom/BlossomUpload'
import { GifPicker } from '@/components/compose/GifPicker'
import { NoteContent } from '@/components/cards/NoteContent'
import { LinkPreviewCard } from '@/components/links/LinkPreviewCard'
import { useApp } from '@/contexts/app-context'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { useAddressableEvent } from '@/hooks/useAddressableEvent'
import { useConversationThread } from '@/hooks/useConversationThread'
import { useEvent } from '@/hooks/useEvent'
import { useHideNsfwTaggedPosts } from '@/hooks/useHideNsfwTaggedPosts'
import { useHashtagSuggestions } from '@/hooks/useHashtagSuggestions'
import { useKeywordFilters } from '@/hooks/useKeywordFilters'
import { useMuteList } from '@/hooks/useMuteList'
import { useTrendingTopics } from '@/hooks/useTrendingTopics'
import { buildComposeFallbackSuggestion } from '@/lib/ai/insights'
import { generateAssistText, type AiAssistProvider, type AiAssistSource } from '@/lib/ai/gemmaAssist'
import { AI_ASSIST_PROVIDER_UPDATED_EVENT, getAiAssistProvider, setAiAssistProvider } from '@/lib/ai/provider'
import { applyHashtagSuggestion } from '@/lib/compose/hashtags'
import { readDraft, writeDraft, clearDraft, type DraftContext } from '@/lib/compose/drafts'
import { usePublishEvent } from '@/hooks/usePublishEvent'
import {
  clearComposeSearch,
  getComposeQuoteReference,
  getComposeReplyReference,
  getComposeStoryMode,
  isComposeOpen,
} from '@/lib/compose'
import { normalizeNip94Tags } from '@/lib/nostr/fileMetadata'
import { decodeAddressReference, decodeEventReference } from '@/lib/nostr/nip21'
import { publishNote } from '@/lib/nostr/note'
import { URL_PATTERN } from '@/lib/text/entities'
import { STORY_EXPIRATION_SECONDS } from '@/lib/nostr/stories'
import {
  parseCommentEvent,
  publishComment,
  publishTextReply,
  publishThread,
} from '@/lib/nostr/thread'
import { normalizeHashtag, stripUrlTrailingPunct, isSafeURL } from '@/lib/security/sanitize'
import { isTenorConfigured, type TenorGif } from '@/lib/tenor/client'
import type { BlossomBlob } from '@/types'
import { Kind } from '@/types'

type ToneTemperature = 'caution' | 'supportive' | 'neutral'

interface ToneInsight {
  temperature: ToneTemperature
  summary: string
  details: string
}

interface ContextHashtagSuggestion {
  tag: string
  reason: 'relevant' | 'trending' | 'thread'
  usageCount?: number
  latestCreatedAt?: number
}

interface ContextKeywordSuggestion {
  keyword: string
  reason: 'trending' | 'semantic-filter' | 'thread'
}

type ComposeAdviceSource = AiAssistSource | 'fallback'

const SUPPORTIVE_TERMS = [
  'thanks', 'thank you', 'appreciate', 'respect', 'great point', 'well said', 'helpful', 'support',
  'constructive', 'glad', 'happy', 'encourage', 'empathy', 'care',
]

const CAUTION_TERMS = [
  'idiot', 'stupid', 'shut up', 'hate you', 'trash', 'worthless', 'pathetic', 'loser', 'disgusting',
  'attack', 'destroy', 'humiliate', 'rage', 'furious', 'violent',
]

const HIGH_RISK_HARM_TERMS = [
  'kill', 'lynch', 'eradicate', 'wipe out', 'exterminate', 'subhuman', 'vermin',
]

const PROTECTED_GROUP_TERMS = [
  'lgbtq', 'trans', 'gay', 'lesbian', 'bisexual', 'queer', 'black', 'jewish', 'muslim', 'immigrant',
]

const NSFW_TERMS = [
  'nsfw', 'porn', 'gore', 'explicit', 'sexual',
]

function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function hasTokenMatch(value: string, tokens: Set<string>): boolean {
  if (!value) return false
  const normalized = value.toLowerCase().trim()
  if (!normalized) return false

  if (normalized.includes(' ')) {
    return [...tokens].join(' ').includes(normalized)
  }

  return tokens.has(normalized)
}

function getTermTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/[\s_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
}

function includesMutedWord(text: string, mutedWords: Set<string>): boolean {
  if (mutedWords.size === 0) return false
  const textTokens = new Set(tokenizeWords(text))
  for (const mutedWord of mutedWords) {
    const normalized = mutedWord.toLowerCase().trim()
    if (!normalized) continue
    if (normalized.includes(' ')) {
      if (text.toLowerCase().includes(normalized)) return true
      continue
    }
    if (textTokens.has(normalized)) return true
  }
  return false
}

function extractUrlCandidates(text: string): string[] {
  const matches = text.match(URL_PATTERN) ?? []
  const deduped: string[] = []
  const seen = new Set<string>()

  for (const raw of matches) {
    const normalized = stripUrlTrailingPunct(raw)
    if (!isSafeURL(normalized) || seen.has(normalized)) continue
    deduped.push(normalized)
    seen.add(normalized)
  }

  return deduped
}

function extractHashtags(text: string): string[] {
  const matcher = /#([a-zA-Z][a-zA-Z0-9_]{0,100})/g
  const tags = new Set<string>()
  let hit = matcher.exec(text)

  while (hit) {
    const normalized = normalizeHashtag(hit[1] ?? '')
    if (normalized) tags.add(normalized)
    hit = matcher.exec(text)
  }

  return [...tags]
}

function lexicalSimilarity(a: string, b: string): number {
  const setA = new Set(tokenizeWords(a))
  const setB = new Set(tokenizeWords(b))
  if (setA.size === 0 || setB.size === 0) return 0

  let overlap = 0
  for (const token of setA) {
    if (setB.has(token)) overlap += 1
  }

  const union = setA.size + setB.size - overlap
  return union > 0 ? overlap / union : 0
}

function toSnippet(text: string, max = 140): string {
  const compact = text.trim().replace(/\s+/g, ' ')
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1)}…`
}

function shortPubkey(pubkey: string): string {
  if (pubkey.length < 16) return pubkey
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`
}

function applyKeywordSuggestion(draft: string, keyword: string): string {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return draft

  const bodyTokens = new Set(tokenizeWords(draft))
  if (bodyTokens.has(normalized)) return draft

  const trimmed = draft.trimEnd()
  if (trimmed.length === 0) return `${normalized} `
  const separator = /[\n\s]$/.test(draft) ? '' : ' '
  return `${draft}${separator}${normalized} `
}

function analyzeTone(body: string): ToneInsight {
  const lower = body.toLowerCase()
  const supportiveCount = SUPPORTIVE_TERMS.filter((term) => lower.includes(term)).length
  const cautionCount = CAUTION_TERMS.filter((term) => lower.includes(term)).length
  const highRisk = HIGH_RISK_HARM_TERMS.some((term) => lower.includes(term))

  if (highRisk || cautionCount >= 2) {
    return {
      temperature: 'caution',
      summary: 'Orange caution',
      details: 'This draft may read as inflammatory. Consider tightening claims and avoiding hostile phrasing.',
    }
  }

  if (supportiveCount >= 2 && cautionCount === 0) {
    return {
      temperature: 'supportive',
      summary: 'Green supportive',
      details: 'Supportive language detected. The message reads constructive and community-safe.',
    }
  }

  return {
    temperature: 'neutral',
    summary: 'Neutral',
    details: 'Tone is mixed/neutral. Add context if you want the intent to feel clearer.',
  }
}

function inferBlobPreviewKind(blob: BlossomBlob): 'image' | 'video' | 'audio' | 'file' {
  const mimeType = blob.nip94?.mimeType ?? blob.type
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'file'
}

function getBlobPreviewUrl(blob: BlossomBlob): string | null {
  const metadata = blob.nip94 ?? normalizeNip94Tags({
    url: blob.url,
    mimeType: blob.type,
    fileHash: blob.sha256,
    size: blob.size,
  })

  if (!metadata) return null

  const candidates = [
    metadata.image,
    metadata.thumb,
    inferBlobPreviewKind(blob) === 'image' ? metadata.url : undefined,
    ...(metadata.fallbacks ?? []),
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate
    }
  }

  return null
}

export function ComposeSheet() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser } = useApp()

  const open = isComposeOpen(location.search)
  const quoteReference = getComposeQuoteReference(location.search)
  const replyReference = getComposeReplyReference(location.search)
  const storyIntent = getComposeStoryMode(location.search)
  const targetReference = replyReference ?? quoteReference

  const eventReference = useMemo(
    () => decodeEventReference(targetReference),
    [targetReference],
  )
  const addressReference = useMemo(
    () => decodeAddressReference(targetReference),
    [targetReference],
  )

  const { event: quotedEvent, loading: quoteEventLoading } = useEvent(eventReference?.eventId)
  const {
    event: quotedAddressEvent,
    loading: quoteAddressLoading,
  } = useAddressableEvent({
    pubkey: addressReference?.pubkey,
    kind: addressReference?.kind,
    identifier: addressReference?.identifier,
  })

  const targetEvent = quotedEvent ?? quotedAddressEvent
  const quoteTarget = quoteReference ? targetEvent : null
  const replyTarget = replyReference ? targetEvent : null
  const targetLoading = Boolean(targetReference) && (quoteEventLoading || quoteAddressLoading)
  const targetInvalid = Boolean(
    targetReference &&
    !eventReference &&
    !addressReference,
  )
  const [publishMode, setPublishMode] = useState<'note' | 'thread'>('note')
  const [storyMode, setStoryMode] = useState(false)
  const [threadTitle, setThreadTitle] = useState('')

  const [body,          setBody]          = useState('')
  const [media,         setMedia]         = useState<BlossomBlob[]>([])
  const [selectedGifs,  setSelectedGifs]  = useState<TenorGif[]>([])
  const [showGifPicker, setShowGifPicker] = useState(false)
  const { isPublishing: publishing, error: publishError, publish: publishEvent, reset: resetPublish } = usePublishEvent()
  const [validationError, setValidationError] = useState<string | null>(null)
  const error = publishError ?? validationError
  const [altTexts,      setAltTexts]      = useState<Record<string, string>>({})
  const [editingAltFor, setEditingAltFor] = useState<string | null>(null)
  const [composeAdvice, setComposeAdvice] = useState('')
  const [composeAdviceSource, setComposeAdviceSource] = useState<ComposeAdviceSource>('fallback')
  const [composeAdviceLoading, setComposeAdviceLoading] = useState(false)
  const [composeAdviceError, setComposeAdviceError] = useState<string | null>(null)
  const [aiAssistProvider, setAiAssistProviderState] = useState<AiAssistProvider>(() => getAiAssistProvider())
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const onProviderUpdated = () => {
      setAiAssistProviderState(getAiAssistProvider())
    }

    window.addEventListener(AI_ASSIST_PROVIDER_UPDATED_EVENT, onProviderUpdated)
    window.addEventListener('storage', onProviderUpdated)

    return () => {
      window.removeEventListener(AI_ASSIST_PROVIDER_UPDATED_EVENT, onProviderUpdated)
      window.removeEventListener('storage', onProviderUpdated)
    }
  }, [])
  const tenorEnabled = isTenorConfigured()
  const replyingToKind1 = replyTarget?.kind === Kind.ShortNote
  const replyingToThread = replyTarget?.kind === Kind.Thread || (
    replyTarget?.kind === Kind.Comment &&
    parseCommentEvent(replyTarget)?.rootKind === String(Kind.Thread)
  )
  const threadModeAvailable = !quoteReference && !replyReference
  const threadMode = threadModeAvailable && publishMode === 'thread'
  const attachmentsAllowed = !replyReference && !threadMode
  const storyModeAvailable = !replyReference && !quoteReference && !threadMode
  const suggestionContext = useMemo(
    () => (threadMode ? `${threadTitle}\n\n${body}` : body),
    [body, threadMode, threadTitle],
  )
  const {
    suggestions: hashtagSuggestions,
    loading: hashtagSuggestionsLoading,
  } = useHashtagSuggestions(suggestionContext, {
    enabled: open && !publishing,
    limit: 6,
  })
  const { topics: trendingTopics, loading: trendingTopicsLoading } = useTrendingTopics(10, 'today')
  const { filters, loading: keywordFiltersLoading } = useKeywordFilters()
  const {
    mutedPubkeys,
    mutedWords,
    mutedHashtags,
    loading: muteListLoading,
  } = useMuteList()
  const hideNsfwTaggedPosts = useHideNsfwTaggedPosts()
  const {
    rootEvent: threadRootEvent,
    replies: threadReplies,
    loading: threadRepliesLoading,
  } = useConversationThread(replyTarget)

  const draftContext = useMemo((): DraftContext => {
    if (replyReference) return `reply:${replyReference}`
    if (quoteReference) return `quote:${quoteReference}`
    return 'note'
  }, [replyReference, quoteReference])

  const draftTone = useMemo(() => analyzeTone(suggestionContext), [suggestionContext])
  const draftTokens = useMemo(() => new Set(tokenizeWords(suggestionContext)), [suggestionContext])

  const activeKeywordFilters = useMemo(() => {
    const now = Date.now()
    return filters.filter((filter) => filter.enabled && (filter.expiresAt === null || filter.expiresAt > now))
  }, [filters])

  const activeSemanticFilterTerms = useMemo(
    () => activeKeywordFilters
      .filter((filter) => filter.semantic)
      .map((filter) => filter.term.toLowerCase().trim())
      .filter(Boolean),
    [activeKeywordFilters],
  )

  const matchedDraftFilters = useMemo(() => {
    const lower = suggestionContext.toLowerCase()
    return activeKeywordFilters.filter((filter) => {
      const term = filter.term.toLowerCase().trim()
      if (!term) return false
      if (term.includes(' ')) return lower.includes(term)

      const termTokens = getTermTokens(term)
      if (termTokens.length === 0) return false
      return termTokens.some((token) => hasTokenMatch(token, draftTokens))
    })
  }, [activeKeywordFilters, draftTokens, suggestionContext])

  const previewLinks = useMemo(
    () => extractUrlCandidates(suggestionContext).slice(0, 2),
    [suggestionContext],
  )

  const replyDuplicateCandidates = useMemo(() => {
    const draft = body.trim()
    if (!replyReference || draft.length < 12) return []

    return threadReplies
      .filter((reply) => !mutedPubkeys.has(reply.pubkey))
      .filter((reply) => !includesMutedWord(reply.content, mutedWords))
      .filter((reply) => reply.id !== replyTarget?.id)
      .map((reply) => ({
        reply,
        similarity: lexicalSimilarity(draft, reply.content),
      }))
      .filter((entry) => entry.similarity >= 0.42)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)
  }, [body, mutedPubkeys, mutedWords, replyReference, replyTarget?.id, threadReplies])

  const topThreadHighlights = useMemo(
    () => threadReplies
      .filter((reply) => !mutedPubkeys.has(reply.pubkey))
      .filter((reply) => !includesMutedWord(reply.content, mutedWords))
      .filter((reply) => reply.content.trim().length > 0)
      .slice(0, 3),
    [mutedPubkeys, mutedWords, threadReplies],
  )

  const contextualHashtagSuggestions = useMemo(() => {
    const existingInBody = new Set(extractHashtags(suggestionContext))
    const draftTokens = new Set(tokenizeWords(suggestionContext).filter((token) => token.length >= 3))
    const merged = new Map<string, ContextHashtagSuggestion>()

    for (const suggestion of hashtagSuggestions) {
      const normalized = normalizeHashtag(suggestion.tag)
      if (!normalized || existingInBody.has(normalized) || mutedHashtags.has(normalized)) continue
      merged.set(normalized, {
        tag: normalized,
        reason: 'relevant',
        usageCount: suggestion.usageCount,
        latestCreatedAt: suggestion.latestCreatedAt,
      })
    }

    for (const topic of trendingTopics) {
      const normalized = normalizeHashtag(topic.tag)
      if (!normalized || existingInBody.has(normalized) || merged.has(normalized) || mutedHashtags.has(normalized)) continue

      const matchToken = draftTokens.has(normalized)
        || [...draftTokens].some((token) => token.includes(normalized) || normalized.includes(token))
      if (!matchToken && suggestionContext.trim().length > 0) continue

      merged.set(normalized, {
        tag: normalized,
        reason: 'trending',
        usageCount: topic.usageCount,
        latestCreatedAt: topic.latestCreatedAt,
      })
    }

    if (replyReference && threadRootEvent) {
      const threadTags = [
        ...extractHashtags(threadRootEvent.content),
        ...topThreadHighlights.flatMap((reply) => extractHashtags(reply.content)),
      ]

      for (const tag of threadTags) {
        const normalized = normalizeHashtag(tag)
        if (!normalized || existingInBody.has(normalized) || merged.has(normalized) || mutedHashtags.has(normalized)) continue
        merged.set(normalized, { tag: normalized, reason: 'thread' })
      }
    }

    return [...merged.values()].slice(0, 8)
  }, [
    hashtagSuggestions,
    trendingTopics,
    suggestionContext,
    replyReference,
    threadRootEvent,
    topThreadHighlights,
    mutedHashtags,
  ])

  const keywordSuggestions = useMemo(() => {
    const existing = new Set(tokenizeWords(suggestionContext))
    const merged = new Map<string, ContextKeywordSuggestion>()

    for (const topic of trendingTopics) {
      const parts = getTermTokens(topic.tag)
      for (const part of parts) {
        if (existing.has(part) || mutedWords.has(part) || merged.has(part)) continue
        merged.set(part, { keyword: part, reason: 'trending' })
      }
    }

    for (const term of activeSemanticFilterTerms) {
      const parts = getTermTokens(term)
      for (const part of parts) {
        if (existing.has(part) || mutedWords.has(part) || merged.has(part)) continue
        merged.set(part, { keyword: part, reason: 'semantic-filter' })
      }
    }

    for (const reply of topThreadHighlights) {
      const parts = getTermTokens(reply.content)
      for (const part of parts.slice(0, 3)) {
        if (existing.has(part) || mutedWords.has(part) || merged.has(part)) continue
        merged.set(part, { keyword: part, reason: 'thread' })
      }
    }

    return [...merged.values()].slice(0, 8)
  }, [activeSemanticFilterTerms, mutedWords, suggestionContext, topThreadHighlights, trendingTopics])

  const moderationGuidance = useMemo(() => {
    const lower = suggestionContext.toLowerCase()
    const notices: string[] = []
    const hasProtectedGroupContext = PROTECTED_GROUP_TERMS.some((term) => lower.includes(term))
    const hasHostileFraming = CAUTION_TERMS.some((term) => lower.includes(term))
      || HIGH_RISK_HARM_TERMS.some((term) => lower.includes(term))
    const matchedBlockFilters = matchedDraftFilters.filter((filter) => filter.action === 'block')
    const matchedWarnFilters = matchedDraftFilters.filter((filter) => filter.action !== 'block')

    if (replyDuplicateCandidates.length > 0) {
      notices.push('Similar points already appear in this thread. Consider adding a fresh angle instead of repeating replies.')
    }

    if (matchedBlockFilters.length > 0) {
      notices.push(`${matchedBlockFilters.length} active block filter(s) match this draft. Consider rewording before publish.`)
    }

    if (matchedWarnFilters.length > 0) {
      notices.push(`${matchedWarnFilters.length} warn/hide filter(s) overlap this draft. Add additional context to reduce false-positive moderation outcomes.`)
    }

    if (includesMutedWord(suggestionContext, mutedWords)) {
      notices.push('Draft contains terms from your muted-words list; verify intent and wording before posting.')
    }

    if (hideNsfwTaggedPosts && NSFW_TERMS.some((term) => lower.includes(term))) {
      notices.push('Your moderation preference currently hides NSFW-tagged content; add context and proper tags if this is safety-relevant.')
    }

    if (hasProtectedGroupContext && hasHostileFraming) {
      notices.push('This draft references protected groups with potentially harmful framing. Consider safer, specific criticism of ideas/actions instead of identities.')
    }

    if (notices.length === 0) {
      notices.push('Draft is aligned with current moderation preferences. Keep context specific and avoid blanket claims for higher quality discussion.')
    }

    return notices
  }, [
    hideNsfwTaggedPosts,
    matchedDraftFilters,
    mutedWords,
    replyDuplicateCandidates.length,
    suggestionContext,
  ])

  const composeAdviceFallback = useMemo(() => buildComposeFallbackSuggestion({
    draft: suggestionContext,
    tone: draftTone.temperature,
    duplicateReplyCount: replyDuplicateCandidates.length,
    topThreadHighlights: topThreadHighlights.map((reply) => toSnippet(reply.content, 120)),
    hashtagSuggestions: contextualHashtagSuggestions.map((suggestion) => suggestion.tag),
    keywordSuggestions: keywordSuggestions.map((suggestion) => suggestion.keyword),
  }), [
    contextualHashtagSuggestions,
    draftTone.temperature,
    keywordSuggestions,
    replyDuplicateCandidates.length,
    suggestionContext,
    topThreadHighlights,
  ])

  useEffect(() => {
    if (!open || publishing) {
      setComposeAdvice('')
      setComposeAdviceError(null)
      setComposeAdviceLoading(false)
      setComposeAdviceSource('fallback')
      return
    }

    const draft = suggestionContext.trim()
    if (draft.length < 24) {
      setComposeAdvice(composeAdviceFallback)
      setComposeAdviceSource('fallback')
      setComposeAdviceError(null)
      setComposeAdviceLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setComposeAdviceLoading(true)
      setComposeAdviceError(null)

      const prompt = [
        'You are an assistant for short social posts.',
        'Write 2 to 3 sentences of specific, actionable guidance to improve this post.',
        'Address tone, clarity, and one concrete structural change the author could make.',
        'Plain text only, no markdown, no bullet points.',
        'Be direct and specific — reference actual content from the draft.',
        'Each sentence should add a distinct insight, not repeat the same idea.',
        'Do not output markdown or bullets.',
        `Draft: ${JSON.stringify(draft)}`,
        `Tone: ${draftTone.summary}`,
        `Duplicate reply candidates: ${replyDuplicateCandidates.length}`,
        `Top thread highlights: ${JSON.stringify(topThreadHighlights.slice(0, 2).map((reply) => toSnippet(reply.content, 120)))}`,
        `Recommended hashtags: ${JSON.stringify(contextualHashtagSuggestions.slice(0, 5).map((suggestion) => suggestion.tag))}`,
        `Recommended keywords: ${JSON.stringify(keywordSuggestions.slice(0, 5).map((suggestion) => suggestion.keyword))}`,
        `Moderation guidance: ${JSON.stringify(moderationGuidance.slice(0, 3))}`,
      ].join('\n')

      generateAssistText(prompt, {
        signal: controller.signal,
        provider: aiAssistProvider,
        taskType: 'compose_assist_quality',
        moderationGuidance,
      })
        .then((result) => {
          if (controller.signal.aborted) return
          setComposeAdvice(result.text.length > 0 ? result.text : composeAdviceFallback)
          setComposeAdviceSource(result.text.length > 0 ? result.source : 'fallback')
          setComposeAdviceLoading(false)
        })
        .catch((assistError: unknown) => {
          if (controller.signal.aborted) return
          setComposeAdvice(composeAdviceFallback)
          setComposeAdviceSource('fallback')
          setComposeAdviceError(assistError instanceof Error ? assistError.message : 'Gemma compose assist unavailable.')
          setComposeAdviceLoading(false)
        })
    }, 700)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [
    composeAdviceFallback,
    contextualHashtagSuggestions,
    aiAssistProvider,
    draftTone.summary,
    keywordSuggestions,
    moderationGuidance,
    open,
    publishing,
    replyDuplicateCandidates.length,
    suggestionContext,
    topThreadHighlights,
  ])

  useEffect(() => {
    if (!open) {
      resetPublish()
      setValidationError(null)
      setBody('')
      setThreadTitle('')
      setPublishMode('note')
      setStoryMode(false)
      setMedia([])
      setSelectedGifs([])
      setShowGifPicker(false)
      setAltTexts({})
      setEditingAltFor(null)
      return
    }

    resetPublish()
    setValidationError(null)

    const savedDraft = readDraft(
      replyReference ? `reply:${replyReference}` :
      quoteReference ? `quote:${quoteReference}` :
      'note'
    )
    setBody(savedDraft?.body ?? '')
    if (savedDraft?.threadTitle) {
      setThreadTitle(savedDraft.threadTitle)
      setPublishMode('thread')
    } else {
      setThreadTitle('')
      setPublishMode('note')
    }
    setStoryMode(!quoteReference && !replyReference && storyIntent)
    setMedia([])
    setSelectedGifs([])
    setShowGifPicker(false)
    setAltTexts({})
    setEditingAltFor(null)

    const timer = window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 40)

    return () => window.clearTimeout(timer)
  }, [open, quoteReference, replyReference, storyIntent])

  // Auto-save draft as user types (debounced 500 ms).
  useEffect(() => {
    if (!open || publishing) return
    const timer = window.setTimeout(() => {
      if (body.trim().length > 0 || threadTitle.trim().length > 0) {
        writeDraft(draftContext, { body, ...(threadTitle.trim() ? { threadTitle } : {}) })
      } else {
        clearDraft(draftContext)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [open, body, threadTitle, draftContext, publishing])

  const closeComposer = () => {
    if (publishing) return
    navigate(
      {
        pathname: location.pathname,
        search: clearComposeSearch(location.search),
      },
      { replace: true },
    )
  }

  const handlePublish = async () => {
    if (publishing) return

    if (!currentUser) {
      setValidationError('No signer available — install and unlock a NIP-07 extension to publish.')
      return
    }

    if (targetReference && !targetEvent) {
      setValidationError(targetInvalid
        ? (replyReference ? 'Invalid reply target reference.' : 'Invalid quoted event reference.')
        : (replyReference ? 'Reply target is still loading.' : 'Quoted event is still loading.'))
      return
    }

    setValidationError(null)

    const id = await publishEvent((signal) =>
      replyTarget
        ? (replyingToKind1
          ? publishTextReply({ target: replyTarget, body, signal })
          : publishComment({ target: replyTarget, body, signal }))
        : threadMode
          ? publishThread({ title: threadTitle, body, signal })
          : publishNote({
              body,
              quoteTarget,
              media,
              expiresAt: storyMode ? Math.floor(Date.now() / 1000) + STORY_EXPIRATION_SECONDS : null,
              gifUrls: selectedGifs.map((g) => g.gifUrl),
              mediaAlt: altTexts,
              signal,
            })
    )

    if (id) {
      clearDraft(draftContext)
      navigate(`/note/${id}`, { replace: true })
    }
  }

  const publishDisabled = publishing ||
    !currentUser ||
    targetInvalid ||
    (Boolean(targetReference) && !targetEvent) ||
    (threadMode
      ? threadTitle.trim().length === 0 || body.trim().length === 0
      : replyReference
        ? body.trim().length === 0
        : storyMode
          ? (media.length === 0 && selectedGifs.length === 0)
          : (!quoteReference && body.trim().length === 0 && media.length === 0 && selectedGifs.length === 0))

  const handleUploaded = (blob: BlossomBlob) => {
    setMedia((current) => {
      if (current.some((item) => item.sha256 === blob.sha256)) return current
      return [...current, blob]
    })
  }

  const removeMedia = (sha256: string) => {
    if (publishing) return
    setMedia((current) => current.filter((item) => item.sha256 !== sha256))
    setAltTexts((prev) => {
      const next = { ...prev }
      delete next[sha256]
      return next
    })
    if (editingAltFor === sha256) setEditingAltFor(null)
  }

  const handleGifSelect = (gif: TenorGif) => {
    setSelectedGifs((current) => {
      if (current.some((g) => g.id === gif.id)) return current
      return [...current, gif]
    })
    setShowGifPicker(false)
  }

  const removeGif = (id: string) => {
    if (publishing) return
    setSelectedGifs((current) => current.filter((g) => g.id !== id))
  }

  const handleHashtagSuggestion = (tag: string) => {
    if (publishing) return
    setBody((current) => applyHashtagSuggestion(current, tag))
    textareaRef.current?.focus()
  }

  const handleKeywordSuggestion = (keyword: string) => {
    if (publishing) return
    setBody((current) => applyKeywordSuggestion(current, keyword))
    textareaRef.current?.focus()
  }

  const formatSuggestionRecency = (timestamp: number) => {
    if (timestamp <= 0) return 'recent'

    const delta = Math.max(0, Math.floor(Date.now() / 1000) - timestamp)
    if (delta < 3600) return `${Math.max(1, Math.floor(delta / 60) || 1)}m`
    if (delta < 86400) return `${Math.floor(delta / 3600)}h`
    if (delta < 30 * 86400) return `${Math.floor(delta / 86400)}d`

    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }

  if (!open) return null

  return (
    <Sheet
      opened={open}
      onBackdropClick={closeComposer}
      className="rounded-t-[28px]"
    >
      <div className="pb-safe min-h-[44vh] flex flex-col">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-[rgb(var(--color-fill)/0.3)]" />
        </div>

        <div className="px-5 py-4 flex-1 flex flex-col gap-4">
          <div>
            <h2 className="text-headline text-[rgb(var(--color-label))]">
              {replyReference ? 'Reply' : quoteReference ? 'New Quote Post' : threadMode ? 'New Thread' : storyMode ? 'New Story' : 'New Note'}
            </h2>
            <p className="mt-1 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {replyReference
                ? replyingToKind1
                  ? 'This will publish as a kind-1 NIP-10 reply for compatibility with older note threads.'
                  : replyingToThread
                    ? 'This will publish as a kind-1111 comment scoped to the root thread, as required by NIP-7D.'
                    : 'This will publish as a kind-1111 NIP-22 comment on the selected event.'
                : quoteReference
                ? 'Your comment will publish as a kind-1 note with an appended NIP-21 reference and matching q tags.'
                : threadMode
                  ? 'Publish a kind-11 thread root with a title and plaintext content. Replies will use kind-1111 comments.'
                : storyMode
                  ? 'Publish a signed kind-1 note with media and a NIP-40 expiration tag. Story clients should ignore it after 24 hours.'
                  : 'Publish a signed kind-1 note to your write relays. Uploaded media is embedded with NIP-92 imeta tags and its own kind-1063 metadata event.'}
            </p>
          </div>

          {threadModeAvailable && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPublishMode('note')}
                disabled={publishing}
                className={`
                  flex-1 rounded-[14px] border px-3 py-2.5 text-[14px] font-medium transition-colors disabled:opacity-40
                  ${publishMode === 'note'
                    ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                    : 'border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label))]'
                  }
                `}
              >
                Note
              </button>
              <button
                type="button"
                onClick={() => {
                  setPublishMode('thread')
                  setStoryMode(false)
                }}
                disabled={publishing}
                className={`
                  flex-1 rounded-[14px] border px-3 py-2.5 text-[14px] font-medium transition-colors disabled:opacity-40
                  ${publishMode === 'thread'
                    ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                    : 'border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label))]'
                  }
                `}
              >
                Thread
              </button>
            </div>
          )}

          {storyModeAvailable && publishMode === 'note' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStoryMode(false)}
                  disabled={publishing}
                  className={`
                    flex-1 rounded-[14px] border px-3 py-2.5 text-[14px] font-medium transition-colors disabled:opacity-40
                    ${!storyMode
                      ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                      : 'border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label))]'
                    }
                  `}
                >
                  Post
                </button>
                <button
                  type="button"
                  onClick={() => setStoryMode(true)}
                  disabled={publishing}
                  className={`
                    flex-1 rounded-[14px] border px-3 py-2.5 text-[14px] font-medium transition-colors disabled:opacity-40
                    ${storyMode
                      ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                      : 'border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label))]'
                    }
                  `}
                >
                  Story
                </button>
              </div>

              {storyMode && (
                <p className="text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                  Stories require at least one image, video, or GIF and expire 24 hours after publishing.
                </p>
              )}
            </div>
          )}

          {threadMode && (
            <label className="block">
              <span className="sr-only">Thread title</span>
              <input
                value={threadTitle}
                onChange={(event) => setThreadTitle(event.target.value)}
                placeholder="Thread title"
                maxLength={160}
                className="
                  w-full rounded-[18px] border border-[rgb(var(--color-fill)/0.18)]
                  bg-[rgb(var(--color-bg-secondary))] px-4 py-3
                  text-[15px] leading-6 text-[rgb(var(--color-label))]
                  outline-none transition-colors focus:border-[#007AFF]
                  placeholder:text-[rgb(var(--color-label-tertiary))]
                "
              />
            </label>
          )}

          <label className="block">
            <span className="sr-only">Note content</span>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={replyReference ? 'Write your reply…' : quoteReference ? 'Add your comment…' : threadMode ? 'Start the thread…' : storyMode ? 'Add a caption…' : 'Share what is happening…'}
              rows={replyReference || quoteReference ? 5 : 7}
              className="
                w-full resize-none rounded-[18px] border border-[rgb(var(--color-fill)/0.18)]
                bg-[rgb(var(--color-bg-secondary))] px-4 py-3
                text-[15px] leading-7 text-[rgb(var(--color-label))]
                outline-none transition-colors focus:border-[#007AFF]
                placeholder:text-[rgb(var(--color-label-tertiary))]
              "
            />
          </label>

          {(hashtagSuggestionsLoading || trendingTopicsLoading || contextualHashtagSuggestions.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                  Suggested Hashtags
                </p>
                <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                  {hashtagSuggestionsLoading || trendingTopicsLoading ? 'Updating…' : 'Context + trend aware'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {contextualHashtagSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.tag}
                    type="button"
                    onClick={() => handleHashtagSuggestion(suggestion.tag)}
                    disabled={publishing}
                    className="
                      rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                      bg-[rgb(var(--color-bg-secondary))] px-3 py-2 text-left
                      transition-colors active:opacity-80 disabled:opacity-40
                    "
                  >
                    <p className="text-[13px] font-semibold text-[#007AFF]">
                      #{suggestion.tag}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-5 text-[rgb(var(--color-label-tertiary))]">
                      {suggestion.reason === 'thread'
                        ? 'Thread context'
                        : suggestion.reason === 'trending'
                          ? `${suggestion.usageCount ?? 0} uses · trending`
                          : `${suggestion.usageCount ?? 0} use${(suggestion.usageCount ?? 0) === 1 ? '' : 's'} · ${formatSuggestionRecency(suggestion.latestCreatedAt ?? 0)}`}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {keywordSuggestions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                  Suggested Keywords
                </p>
                <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                  Popular + semantic + thread context
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {keywordSuggestions.map((suggestion) => (
                  <button
                    key={`${suggestion.reason}:${suggestion.keyword}`}
                    type="button"
                    onClick={() => handleKeywordSuggestion(suggestion.keyword)}
                    disabled={publishing}
                    className="
                      rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                      bg-[rgb(var(--color-bg-secondary))] px-3 py-2 text-left
                      transition-colors active:opacity-80 disabled:opacity-40
                    "
                  >
                    <p className="text-[13px] font-semibold text-[rgb(var(--color-label))]">
                      {suggestion.keyword}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-5 text-[rgb(var(--color-label-tertiary))]">
                      {suggestion.reason === 'trending'
                        ? 'Trending keyword'
                        : suggestion.reason === 'semantic-filter'
                          ? 'From your semantic filters'
                          : 'From thread context'}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3 rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                AI Assist
              </p>
              <span
                className={
                  `rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    draftTone.temperature === 'caution'
                      ? 'bg-orange-500/15 text-orange-600'
                      : draftTone.temperature === 'supportive'
                        ? 'bg-emerald-500/15 text-emerald-600'
                        : 'bg-[rgb(var(--color-fill)/0.2)] text-[rgb(var(--color-label-secondary))]'
                  }`
                }
              >
                {draftTone.summary}
              </span>
            </div>

            <p className="text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {draftTone.details}
            </p>

            <div className="rounded-[14px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
                  Draft quality guidance
                </p>
                <div className="flex items-center gap-2">
                  <select
                    value={aiAssistProvider}
                    onChange={(event) => {
                      const next = event.target.value as AiAssistProvider
                      setAiAssistProvider(next)
                      setAiAssistProviderState(next)
                    }}
                    className="rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-2 py-1 text-[11px] text-[rgb(var(--color-label-secondary))]"
                    aria-label="AI provider"
                  >
                    <option value="auto">Auto</option>
                    <option value="gemma">Gemma</option>
                    <option value="gemini">Gemini</option>
                  </select>

                  <span className="text-[11px] text-[rgb(var(--color-label-tertiary))]">
                    {composeAdviceLoading ? 'Analyzing…' : composeAdviceSource === 'gemma' ? 'Gemma on-device' : composeAdviceSource === 'gemini' ? 'Gemini API' : 'Fallback'}
                  </span>
                </div>
              </div>
              <p className="mt-1.5 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
                {composeAdvice || composeAdviceFallback}
              </p>
              {composeAdviceError && (
                <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))]">
                  {composeAdviceError}
                </p>
              )}
            </div>

            {replyReference && (
              <div className="space-y-2">
                <p className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
                  Reply context intelligence
                </p>

                {threadRepliesLoading ? (
                  <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                    Scanning thread context…
                  </p>
                ) : (
                  <>
                    {replyDuplicateCandidates.length > 0 && (
                      <div className="rounded-[14px] border border-orange-500/30 bg-orange-500/10 p-2.5">
                        <p className="text-[12px] font-medium text-orange-700">
                          Similar replies detected
                        </p>
                        <div className="mt-1.5 space-y-1.5">
                          {replyDuplicateCandidates.slice(0, 2).map((entry) => (
                            <p key={entry.reply.id} className="text-[12px] leading-5 text-orange-700/95">
                              ~{Math.round(entry.similarity * 100)}% match from {shortPubkey(entry.reply.pubkey)}: {toSnippet(entry.reply.content, 90)}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {topThreadHighlights.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                          High-signal replies in this thread
                        </p>
                        <div className="space-y-1.5">
                          {topThreadHighlights.slice(0, 2).map((reply) => (
                            <p key={reply.id} className="text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
                              {shortPubkey(reply.pubkey)}: {toSnippet(reply.content, 110)}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
                Moderation-aware guidance
              </p>
              <p className="text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
                {keywordFiltersLoading || muteListLoading
                  ? 'Syncing filters and mute preferences…'
                  : `Using ${activeKeywordFilters.length} active filter rule(s) and your mute list to personalize recommendations.`}
              </p>
              {moderationGuidance.map((notice) => (
                <p key={notice} className="text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
                  {notice}
                </p>
              ))}
            </div>
          </div>

          {attachmentsAllowed && (
            <div className="space-y-3">
            {/* Header row */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Media
              </p>
              {(media.length > 0 || selectedGifs.length > 0) && (
                <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                  {media.length + selectedGifs.length} attachment{media.length + selectedGifs.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* Upload row: Blossom uploader + GIF toggle */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <BlossomUpload
                  onUploaded={handleUploaded}
                  disabled={publishing}
                  className="max-w-none"
                />
              </div>

              {tenorEnabled && (
                <button
                  type="button"
                  onClick={() => setShowGifPicker((v) => !v)}
                  disabled={publishing}
                  className={`
                    shrink-0 rounded-[14px] border px-3 py-2
                    text-[13px] font-semibold transition-colors
                    disabled:opacity-40
                    ${showGifPicker
                      ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                      : 'border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label))]'
                    }
                  `}
                >
                  GIF
                </button>
              )}
            </div>

            {/* Tenor GIF picker — inline panel */}
            {showGifPicker && (
              <GifPicker onSelect={handleGifSelect} />
            )}

            {/* Attachment preview grid — Blossom blobs + selected GIFs */}
            {(media.length > 0 || selectedGifs.length > 0) && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((blob) => {
                  const previewKind    = inferBlobPreviewKind(blob)
                  const previewUrl     = getBlobPreviewUrl(blob)
                  const currentAlt     = altTexts[blob.sha256] ?? blob.nip94?.alt ?? ''
                  const isEditingAlt   = editingAltFor === blob.sha256

                  return (
                    <div
                      key={blob.sha256}
                      className="
                        overflow-hidden rounded-[18px] border border-[rgb(var(--color-fill)/0.12)]
                        bg-[rgb(var(--color-bg-secondary))]
                      "
                    >
                      <div className="relative aspect-[4/3] bg-[rgb(var(--color-fill)/0.08)]">
                        {previewKind === 'image' && previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={currentAlt || blob.nip94?.alt || ''}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center px-3 text-center text-[13px] text-[rgb(var(--color-label-secondary))]">
                            {previewKind === 'video' ? 'Video' : previewKind === 'audio' ? 'Audio' : 'File'}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => removeMedia(blob.sha256)}
                          disabled={publishing}
                          className="
                            absolute right-2 top-2 rounded-full bg-black/55 px-2 py-1
                            text-[11px] font-medium text-white transition-opacity active:opacity-70
                            disabled:opacity-40
                          "
                        >
                          Remove
                        </button>
                      </div>

                      {/* Alt text section */}
                      <div className="px-3 py-2.5">
                        {isEditingAlt ? (
                          <div className="space-y-1.5">
                            <textarea
                              value={currentAlt}
                              onChange={(e) =>
                                setAltTexts((prev) => ({ ...prev, [blob.sha256]: e.target.value }))
                              }
                              placeholder="Describe this media for people who can't see it…"
                              rows={3}
                              maxLength={1000}
                              disabled={publishing}
                              autoFocus
                              className="
                                w-full resize-none rounded-[12px]
                                border border-[#007AFF]
                                bg-[rgb(var(--color-bg))] px-3 py-2
                                text-[13px] leading-5 text-[rgb(var(--color-label))]
                                outline-none placeholder:text-[rgb(var(--color-label-tertiary))]
                                disabled:opacity-40
                              "
                            />
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-[rgb(var(--color-label-tertiary))]">
                                {currentAlt.length}/1000
                              </span>
                              <button
                                type="button"
                                onClick={() => setEditingAltFor(null)}
                                className="text-[13px] font-semibold text-[#007AFF]"
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingAltFor(blob.sha256)}
                            disabled={publishing}
                            className="
                              text-[13px] text-[#007AFF] disabled:opacity-40
                              text-left w-full truncate
                            "
                          >
                            {currentAlt
                              ? `"${currentAlt.slice(0, 40)}${currentAlt.length > 40 ? '…' : ''}"`
                              : '+ Add description'
                            }
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}

                {selectedGifs.map((gif) => (
                  <div
                    key={gif.id}
                    className="
                      overflow-hidden rounded-[18px] border border-[rgb(var(--color-fill)/0.12)]
                      bg-[rgb(var(--color-bg-secondary))]
                    "
                  >
                    <div className="relative aspect-[4/3] bg-[rgb(var(--color-fill)/0.08)]">
                      <img
                        src={gif.previewUrl}
                        alt={gif.title}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />

                      <button
                        type="button"
                        onClick={() => removeGif(gif.id)}
                        disabled={publishing}
                        className="
                          absolute right-2 top-2 rounded-full bg-black/55 px-2 py-1
                          text-[11px] font-medium text-white transition-opacity active:opacity-70
                          disabled:opacity-40
                        "
                      >
                        Remove
                      </button>
                    </div>

                    <div className="px-3 py-2.5">
                      <p className="truncate text-[12px] text-[rgb(var(--color-label-tertiary))]">
                        GIF · Tenor
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          )}

          {targetReference && (
            <div className="space-y-2">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                {replyReference ? 'Replying To' : 'Quoting'}
              </p>

              {targetEvent ? (
                <EventPreviewCard event={targetEvent} linked={false} />
              ) : (
                <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
                  <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                    {targetInvalid
                      ? (replyReference ? 'Reply target reference is invalid.' : 'Quoted event reference is invalid.')
                      : targetLoading
                        ? (replyReference ? 'Loading reply target…' : 'Loading quoted event…')
                        : (replyReference ? 'Reply target unavailable.' : 'Quoted event unavailable.')}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Live Preview
            </p>

            <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
              {threadMode && threadTitle.trim().length > 0 && (
                <p className="mb-2 text-[14px] font-semibold text-[rgb(var(--color-label))]">
                  {threadTitle.trim()}
                </p>
              )}

              {body.trim().length > 0 ? (
                <NoteContent
                  content={body}
                  interactive={false}
                  allowTranslation={false}
                  showEntityPreviews={false}
                />
              ) : (
                <p className="text-[13px] text-[rgb(var(--color-label-tertiary))]">
                  Start typing to preview your post.
                </p>
              )}

              {previewLinks.length > 0 && (
                <div className="mt-3 space-y-2">
                  {previewLinks.map((url) => (
                    <LinkPreviewCard key={url} url={url} />
                  ))}
                </div>
              )}

              {(media.length > 0 || selectedGifs.length > 0) && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {media.slice(0, 3).map((blob) => {
                    const previewUrl = getBlobPreviewUrl(blob)
                    const kind = inferBlobPreviewKind(blob)
                    return (
                      <div
                        key={`preview-${blob.sha256}`}
                        className="aspect-square overflow-hidden rounded-[12px] bg-[rgb(var(--color-fill)/0.08)]"
                      >
                        {kind === 'image' && previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={altTexts[blob.sha256] ?? blob.nip94?.alt ?? ''}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] text-[rgb(var(--color-label-secondary))]">
                            {kind.toUpperCase()}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {selectedGifs.slice(0, 2).map((gif) => (
                    <div
                      key={`preview-gif-${gif.id}`}
                      className="aspect-square overflow-hidden rounded-[12px] bg-[rgb(var(--color-fill)/0.08)]"
                    >
                      <img
                        src={gif.previewUrl}
                        alt={gif.title}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {!currentUser && (
            <p className="text-[13px] text-[rgb(var(--color-system-red))]">
              Install and unlock a NIP-07 signer to publish notes.
            </p>
          )}

          {error && (
            <p className="text-[13px] text-[rgb(var(--color-system-red))]">
              {error}
            </p>
          )}

          <div className="mt-auto flex gap-2">
            <button
              type="button"
              onClick={closeComposer}
              disabled={publishing}
              className="
                flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
                text-[14px] font-medium text-[rgb(var(--color-label))]
                transition-opacity active:opacity-75 disabled:opacity-40
              "
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={publishDisabled}
              className="
                flex-1 rounded-[14px] bg-[rgb(var(--color-label))]
                px-4 py-2.5 text-[14px] font-semibold text-[rgb(var(--color-bg))]
                transition-opacity active:opacity-80 disabled:opacity-40
              "
            >
              {publishing ? 'Publishing…' : storyMode ? 'Publish Story' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
