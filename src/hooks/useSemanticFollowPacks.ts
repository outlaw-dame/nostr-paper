import { useEffect, useState } from 'react'
import { getProfiles, queryEvents } from '@/lib/db/nostr'
import {
  DISCOVERY_CONTROLS_UPDATED_EVENT,
  loadDiscoveryControls,
} from '@/lib/explore/discoveryControls'
import type { RankedExploreFollowPack } from '@/lib/explore/followPacks'
import type { NostrEvent, Profile } from '@/types'
import { Kind } from '@/types'

type LanguageBucket =
  | 'latin'
  | 'cyrillic'
  | 'cjk'
  | 'arabic'
  | 'other'

type InterestSignal = {
  keywords: Set<string>
  hashtags: Set<string>
  languageTag: string | null
  script: LanguageBucket | null
}

const STOPWORDS = new Set([
  'about', 'after', 'again', 'been', 'being', 'both', 'from', 'have', 'into', 'just',
  'like', 'more', 'most', 'much', 'only', 'over', 'same', 'some', 'such', 'than',
  'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'very', 'want',
  'were', 'what', 'when', 'where', 'will', 'with', 'would', 'your',
])

const USER_POST_SAMPLE_SIZE = 24
const KEYWORD_SAMPLE_SIZE = 8
const HASHTAG_SAMPLE_SIZE = 6
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

function profileText(profile: Profile | null | undefined): string {
  if (!profile) return ''
  return [
    profile.name,
    profile.display_name,
    profile.about,
    profile.nip05,
  ].filter(Boolean).join(' ')
}

function computeSignal(
  texts: string[],
  events: NostrEvent[],
  preferredLanguageTag?: string | null,
): InterestSignal {
  return {
    keywords: collectTopWords(texts, KEYWORD_SAMPLE_SIZE),
    hashtags: collectTopHashtags(events, HASHTAG_SAMPLE_SIZE),
    languageTag: preferredLanguageTag ?? dominantLanguage(events),
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

export function useSemanticFollowPacks(
  packs: RankedExploreFollowPack[],
  viewerPubkey: string | null | undefined,
): {
  packs: RankedExploreFollowPack[]
  semanticApplied: boolean
} {
  const [semanticBoost, setSemanticBoost] = useState(() => loadDiscoveryControls().followPacks.semanticBoost)
  const [state, setState] = useState<{
    packs: RankedExploreFollowPack[]
    semanticApplied: boolean
  }>({
    packs,
    semanticApplied: false,
  })

  useEffect(() => {
    const handleUpdated = () => {
      setSemanticBoost(loadDiscoveryControls().followPacks.semanticBoost)
    }

    window.addEventListener(DISCOVERY_CONTROLS_UPDATED_EVENT, handleUpdated)
    return () => window.removeEventListener(DISCOVERY_CONTROLS_UPDATED_EVENT, handleUpdated)
  }, [])

  useEffect(() => {
    if (!viewerPubkey || packs.length === 0) {
      setState({ packs, semanticApplied: false })
      return
    }

    let cancelled = false

    void (async () => {
      const sourcePacks = packs.slice()
      const pubkeys = new Set<string>([viewerPubkey])

      for (const pack of sourcePacks) {
        pubkeys.add(pack.parsed.pubkey)
        for (const preview of pack.previewProfiles) {
          pubkeys.add(preview.pubkey)
        }
      }

      const [profiles, candidateEvents, viewerEvents] = await Promise.all([
        getProfiles([...pubkeys]).catch(() => new Map<string, Profile>()),
        queryEvents({
          authors: [...pubkeys].filter((pubkey) => pubkey !== viewerPubkey),
          kinds: [Kind.ShortNote, Kind.LongFormContent],
          limit: Math.max(pubkeys.size * 2, 40),
        }).catch(() => [] as NostrEvent[]),
        queryEvents({
          authors: [viewerPubkey],
          kinds: [Kind.ShortNote, Kind.LongFormContent],
          limit: USER_POST_SAMPLE_SIZE,
        }).catch(() => [] as NostrEvent[]),
      ])

      if (cancelled) return

      const eventsByPubkey = new Map<string, NostrEvent[]>()
      for (const event of candidateEvents) {
        const bucket = eventsByPubkey.get(event.pubkey) ?? []
        bucket.push(event)
        eventsByPubkey.set(event.pubkey, bucket)
      }

      const viewerProfile = profiles.get(viewerPubkey) ?? null
      const viewerTexts = [
        ...viewerEvents.map((event) => event.content),
        profileText(viewerProfile),
      ].filter(Boolean)
      const viewerSignal = computeSignal(viewerTexts, viewerEvents)

      const reranked = sourcePacks
        .map((pack) => {
          const packPubkeys = [
            pack.parsed.pubkey,
            ...pack.previewProfiles.map((profile) => profile.pubkey),
          ]

          const packTexts = [
            pack.parsed.title,
            pack.parsed.description,
            ...packPubkeys.map((pubkey) => profileText(profiles.get(pubkey))),
          ].filter((value): value is string => typeof value === 'string' && value.length > 0)

          const packEvents = packPubkeys.flatMap((pubkey) => eventsByPubkey.get(pubkey) ?? [])
          const packSignal = computeSignal(packTexts, packEvents)

          const keywordScore = overlapRatio(viewerSignal.keywords, packSignal.keywords)
          const hashtagScore = overlapRatio(viewerSignal.hashtags, packSignal.hashtags)
          const languageScore = viewerSignal.languageTag && packSignal.languageTag
            ? (viewerSignal.languageTag === packSignal.languageTag ? 1 : 0)
            : (viewerSignal.script && packSignal.script && viewerSignal.script === packSignal.script ? 0.65 : 0)

          const semanticScore = keywordScore * 0.45 + hashtagScore * 0.35 + languageScore * 0.20
          const score = pack.score + semanticScore * semanticBoost
          const reason = semanticScore >= 0.45
            ? `${pack.reason} · aligns with your topics`
            : pack.reason

          return {
            ...pack,
            score,
            reason,
          }
        })
        .sort((left, right) => {
          if (left.score !== right.score) return right.score - left.score
          if (left.parsed.createdAt !== right.parsed.createdAt) return right.parsed.createdAt - left.parsed.createdAt
          return right.parsed.id.localeCompare(left.parsed.id)
        })

      setState({
        packs: reranked,
        semanticApplied: true,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [packs, semanticBoost, viewerPubkey])

  return state
}
