import { useEffect, useState } from 'react'
import { listSuggestedProfiles, queryEvents } from '@/lib/db/nostr'
import {
  DISCOVERY_CONTROLS_UPDATED_EVENT,
  loadDiscoveryControls,
  type SuggestedAccountWeights,
} from '@/lib/explore/discoveryControls'
import type { NostrEvent, Profile } from '@/types'
import { Kind } from '@/types'

export interface SuggestedProfileItem {
  profile: Profile
  reason: string
}

const USER_POST_SAMPLE_SIZE = 36
const KEYWORD_SAMPLE_SIZE = 8
const HASHTAG_SAMPLE_SIZE = 6

const STOPWORDS = new Set([
  'about', 'after', 'again', 'been', 'being', 'both', 'from', 'have', 'into', 'just',
  'like', 'more', 'most', 'much', 'only', 'over', 'same', 'some', 'such', 'than',
  'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'very', 'want',
  'were', 'what', 'when', 'where', 'will', 'with', 'would', 'your',
])

type LanguageBucket =
  | 'latin'
  | 'cyrillic'
  | 'cjk'
  | 'arabic'
  | 'other'

type InterestSignal = {
  keywords: Set<string>
  hashtags: Set<string>
  bioKeywords: Set<string>
  languageTag: string | null
  script: LanguageBucket | null
}

type RankedCandidate = {
  profile: Profile
  mutualCount: number
  followerCount: number
  finalScore: number
  semanticScore: number
  matchedTags: string[]
  matchedBioTerms: string[]
}

function buildReason(
  mutualCount: number,
  followerCount: number,
  matchedTags: string[],
  matchedBioTerms: string[],
  semanticScore: number,
): string {
  if (semanticScore >= 0.45 && matchedTags.length > 0) {
    const topTags = matchedTags.slice(0, 2).map((tag) => `#${tag}`).join(', ')
    if (mutualCount > 0) return `${mutualCount} in your network + matches ${topTags}`
    return `Matches your recent topics ${topTags}`
  }
  if (semanticScore >= 0.4 && matchedBioTerms.length > 0) {
    const bioMatch = matchedBioTerms.slice(0, 2).join(', ')
    if (mutualCount > 0) return `${mutualCount} in your network + bio aligns on ${bioMatch}`
    return `Bio aligns with your interests: ${bioMatch}`
  }
  if (mutualCount > 1) return `${mutualCount} people you follow also follow this account`
  if (mutualCount === 1) return 'Followed by someone in your network'
  if (followerCount > 1) return `Popular with ${followerCount} followers in your local graph`
  return 'Popular in your local graph'
}

function normalizeWord(value: string): string | null {
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .trim()

  if (normalized.length < 4) return null
  if (STOPWORDS.has(normalized)) return null
  return normalized
}

function detectScriptBucket(value: string): LanguageBucket {
  if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(value)) return 'cjk'
  if (/[\u0400-\u04ff]/u.test(value)) return 'cyrillic'
  if (/[\u0600-\u06ff]/u.test(value)) return 'arabic'
  if (/[a-z]/iu.test(value)) return 'latin'
  return 'other'
}

function extractLanguageTag(event: NostrEvent): string | null {
  for (const tag of event.tags) {
    const name = tag[0]?.toLowerCase()
    const value = tag[1]?.trim().toLowerCase()
    if (!name || !value) continue
    if (name === 'l' || name === 'lang' || name === 'language') {
      return value
    }
  }
  return null
}

function collectTopWords(values: string[], limit: number): Set<string> {
  const counts = new Map<string, number>()
  for (const value of values) {
    const tokens = value.split(/\s+/g)
    for (const token of tokens) {
      const word = normalizeWord(token)
      if (!word) continue
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }

  return new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([word]) => word),
  )
}

function collectTopHashtags(events: NostrEvent[], limit: number): Set<string> {
  const counts = new Map<string, number>()

  for (const event of events) {
    for (const tag of event.tags) {
      if (tag[0] !== 't') continue
      const hashtag = tag[1]?.trim().toLowerCase()
      if (!hashtag) continue
      counts.set(hashtag, (counts.get(hashtag) ?? 0) + 1)
    }

    const contentHashtags = event.content.match(/#([\p{L}\p{N}_-]{2,})/gu) ?? []
    for (const contentTag of contentHashtags) {
      const hashtag = contentTag.replace(/^#/, '').toLowerCase().trim()
      if (!hashtag) continue
      counts.set(hashtag, (counts.get(hashtag) ?? 0) + 1)
    }
  }

  return new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([hashtag]) => hashtag),
  )
}

function dominantLanguage(events: NostrEvent[]): string | null {
  const counts = new Map<string, number>()
  for (const event of events) {
    const language = extractLanguageTag(event)
    if (!language) continue
    counts.set(language, (counts.get(language) ?? 0) + 1)
  }

  if (counts.size === 0) return null
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null
}

function dominantScript(events: NostrEvent[], fallbackText: string): LanguageBucket | null {
  const counts = new Map<LanguageBucket, number>()
  const sources = [
    ...events.map((event) => event.content),
    fallbackText,
  ].filter(Boolean)

  if (sources.length === 0) return null

  for (const source of sources) {
    const bucket = detectScriptBucket(source)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function parseMetadataRecord(event: NostrEvent): {
  text: string
  languageTag: string | null
} {
  try {
    const parsed = JSON.parse(event.content) as {
      name?: unknown
      display_name?: unknown
      about?: unknown
      nip05?: unknown
      language?: unknown
      lang?: unknown
      l?: unknown
    }

    const text = [
      typeof parsed.name === 'string' ? parsed.name : null,
      typeof parsed.display_name === 'string' ? parsed.display_name : null,
      typeof parsed.about === 'string' ? parsed.about : null,
      typeof parsed.nip05 === 'string' ? parsed.nip05 : null,
    ].filter(Boolean).join(' ')

    const languageTag = [parsed.language, parsed.lang, parsed.l].find(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    )?.trim().toLowerCase() ?? null

    return { text, languageTag }
  } catch {
    return {
      text: '',
      languageTag: null,
    }
  }
}

function computeInterestSignal(
  events: NostrEvent[],
  userProfileText: string,
  userProfileLanguageTag: string | null,
): InterestSignal {
  const texts = [...events.map((event) => event.content), userProfileText].filter(Boolean)
  return {
    keywords: collectTopWords(texts, KEYWORD_SAMPLE_SIZE),
    hashtags: collectTopHashtags(events, HASHTAG_SAMPLE_SIZE),
    bioKeywords: collectTopWords([userProfileText], Math.max(2, Math.floor(KEYWORD_SAMPLE_SIZE * 0.75))),
    languageTag: userProfileLanguageTag ?? dominantLanguage(events),
    script: dominantScript(events, texts.join(' ')),
  }
}

function overlapRatio(source: Set<string>, target: Set<string>): number {
  if (source.size === 0 || target.size === 0) return 0
  let overlap = 0
  for (const value of source) {
    if (target.has(value)) overlap += 1
  }
  return overlap / source.size
}

function collectCandidateSignals(
  profile: Profile,
  events: NostrEvent[],
): InterestSignal {
  const profileText = [
    profile.name,
    profile.display_name,
    profile.about,
    profile.nip05,
  ].filter(Boolean).join(' ')

  const eventTexts = events.map((event) => event.content)

  return {
    keywords: collectTopWords([...eventTexts, profileText], KEYWORD_SAMPLE_SIZE),
    hashtags: collectTopHashtags(events, HASHTAG_SAMPLE_SIZE),
    bioKeywords: collectTopWords([profile.about ?? ''], Math.max(2, Math.floor(KEYWORD_SAMPLE_SIZE * 0.75))),
    languageTag: dominantLanguage(events),
    script: dominantScript(events, profileText),
  }
}

function rankCandidates(
  rows: Awaited<ReturnType<typeof listSuggestedProfiles>>,
  userSignal: InterestSignal,
  candidateEventsByPubkey: Map<string, NostrEvent[]>,
  weights: SuggestedAccountWeights,
): RankedCandidate[] {
  if (rows.length === 0) return []

  const maxMutual = Math.max(...rows.map((row) => row.mutualCount), 1)
  const maxFollowers = Math.max(...rows.map((row) => row.followerCount), 1)

  return rows.map((row) => {
    const socialScore = (
      (row.mutualCount / maxMutual) * 0.7
      + (row.followerCount / maxFollowers) * 0.3
    )

    const candidateEvents = candidateEventsByPubkey.get(row.profile.pubkey) ?? []
    const candidateSignal = collectCandidateSignals(row.profile, candidateEvents)

    const keywordScore = overlapRatio(userSignal.keywords, candidateSignal.keywords)
    const hashtagScore = overlapRatio(userSignal.hashtags, candidateSignal.hashtags)
    const bioScore = overlapRatio(userSignal.keywords, candidateSignal.bioKeywords)
    const languageScore = userSignal.languageTag && candidateSignal.languageTag
      ? (userSignal.languageTag === candidateSignal.languageTag ? 1 : 0)
      : (userSignal.script && candidateSignal.script && userSignal.script === candidateSignal.script ? 0.65 : 0)

    const semanticScore = keywordScore * weights.keyword
      + hashtagScore * weights.hashtag
      + bioScore * weights.bio
      + languageScore * weights.language
    const finalScore = socialScore * weights.social + semanticScore * weights.semantic

    const matchedTags = [...userSignal.hashtags].filter((tag) => candidateSignal.hashtags.has(tag))
    const matchedBioTerms = [...userSignal.keywords].filter((term) => candidateSignal.bioKeywords.has(term))

    return {
      profile: row.profile,
      mutualCount: row.mutualCount,
      followerCount: row.followerCount,
      finalScore,
      semanticScore,
      matchedTags,
      matchedBioTerms,
    }
  }).sort((a, b) => b.finalScore - a.finalScore)
}

export function useSuggestedProfiles(
  viewerPubkey: string | undefined,
  limit = 8,
): {
  profiles: SuggestedProfileItem[]
  loading: boolean
} {
  const [profiles, setProfiles] = useState<SuggestedProfileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [weights, setWeights] = useState(() => loadDiscoveryControls().suggested)

  useEffect(() => {
    const handleUpdated = () => {
      setWeights(loadDiscoveryControls().suggested)
    }

    window.addEventListener(DISCOVERY_CONTROLS_UPDATED_EVENT, handleUpdated)
    return () => window.removeEventListener(DISCOVERY_CONTROLS_UPDATED_EVENT, handleUpdated)
  }, [])

  useEffect(() => {
    if (!viewerPubkey) {
      setProfiles([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    Promise.all([
      listSuggestedProfiles(viewerPubkey, Math.min(limit * 2, 24)),
      queryEvents({
        authors: [viewerPubkey],
        kinds: [Kind.ShortNote, Kind.LongFormContent],
        limit: USER_POST_SAMPLE_SIZE,
      }).catch(() => [] as NostrEvent[]),
      queryEvents({
        authors: [viewerPubkey],
        kinds: [Kind.Metadata],
        limit: 1,
      }).catch(() => [] as NostrEvent[]),
    ])
      .then(async ([rows, userEvents, userMetadataEvents]) => {
        if (cancelled) return

        const candidatePubkeys = [...new Set(rows.map((row) => row.profile.pubkey))]
        const candidateEvents = candidatePubkeys.length > 0
          ? await queryEvents({
            authors: candidatePubkeys,
            kinds: [Kind.ShortNote, Kind.LongFormContent],
            limit: Math.max(candidatePubkeys.length * 3, 40),
          }).catch(() => [] as NostrEvent[])
          : []

        if (cancelled) return

        const candidateEventsByPubkey = new Map<string, NostrEvent[]>()
        for (const event of candidateEvents) {
          const events = candidateEventsByPubkey.get(event.pubkey) ?? []
          events.push(event)
          candidateEventsByPubkey.set(event.pubkey, events)
        }

        const userMetadata = userMetadataEvents[0] ? parseMetadataRecord(userMetadataEvents[0]) : {
          text: '',
          languageTag: null,
        }

        const userSignal = computeInterestSignal(
          userEvents,
          userMetadata.text,
          userMetadata.languageTag,
        )
        const ranked = rankCandidates(rows, userSignal, candidateEventsByPubkey, weights)

        setProfiles(ranked.slice(0, limit).map((row) => ({
          profile: row.profile,
          reason: buildReason(
            row.mutualCount,
            row.followerCount,
            row.matchedTags,
            row.matchedBioTerms,
            row.semanticScore,
          ),
        })))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setProfiles([])
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [limit, viewerPubkey, weights])

  return { profiles, loading }
}
