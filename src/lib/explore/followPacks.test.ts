import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'
import {
  buildExploreFollowPackCandidates,
  extractFollowPackProfiles,
  getExploreFollowPackSummary,
  rankExploreFollowPacks,
} from './followPacks'
import { parseNip51ListEvent } from '@/lib/nostr/lists'

function makePubkey(seed: string): string {
  return seed.repeat(64).slice(0, 64)
}

function makePackEvent(options: {
  idSeed: string
  pubkeySeed: string
  identifier: string
  createdAt: number
  profiles: Array<{ pubkeySeed: string; relayUrl?: string; petname?: string }>
  kind?: number
  title?: string
  description?: string
}): NostrEvent {
  return {
    id: options.idSeed.repeat(64).slice(0, 64),
    pubkey: makePubkey(options.pubkeySeed),
    created_at: options.createdAt,
    kind: options.kind ?? Kind.StarterPack,
    tags: [
      ['d', options.identifier],
      ...(options.title ? [['title', options.title]] : []),
      ...(options.description ? [['description', options.description]] : []),
      ...options.profiles.map((profile) => [
        'p',
        makePubkey(profile.pubkeySeed),
        ...(profile.relayUrl ? [profile.relayUrl] : []),
        ...(profile.petname ? [profile.petname] : []),
      ]),
    ],
    content: '',
    sig: 'f'.repeat(128),
  }
}

describe('followPacks helpers', () => {
  it('extracts unique profile targets from starter packs', () => {
    const parsed = parseNip51ListEvent(makePackEvent({
      idSeed: '1',
      pubkeySeed: 'a',
      identifier: 'apple-creators',
      createdAt: 1_700_000_000,
      profiles: [
        { pubkeySeed: 'b', relayUrl: 'wss://relay.example', petname: 'Alice' },
        { pubkeySeed: 'b', relayUrl: 'wss://relay.example', petname: 'Alice Again' },
        { pubkeySeed: 'c' },
      ],
    }))

    expect(parsed).not.toBeNull()
    expect(extractFollowPackProfiles(parsed!)).toEqual([
      {
        pubkey: makePubkey('b'),
        relayUrl: 'wss://relay.example/',
        petname: 'Alice',
      },
      {
        pubkey: makePubkey('c'),
      },
    ])
  })

  it('keeps only the newest event for the same pack coordinate', () => {
    const older = makePackEvent({
      idSeed: '1',
      pubkeySeed: 'a',
      identifier: 'nostr-writers',
      createdAt: 10,
      profiles: [{ pubkeySeed: 'b' }],
      title: 'Older pack',
    })
    const newer = makePackEvent({
      idSeed: '2',
      pubkeySeed: 'a',
      identifier: 'nostr-writers',
      createdAt: 20,
      profiles: [{ pubkeySeed: 'c' }],
      title: 'Newer pack',
    })

    const candidates = buildExploreFollowPackCandidates([older, newer])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.parsed.title).toBe('Newer pack')
  })

  it('builds fallback summaries for starter and media packs', () => {
    const starter = parseNip51ListEvent(makePackEvent({
      idSeed: '1',
      pubkeySeed: 'a',
      identifier: 'starter',
      createdAt: 10,
      profiles: [{ pubkeySeed: 'b' }, { pubkeySeed: 'c' }],
    }))
    const media = parseNip51ListEvent(makePackEvent({
      idSeed: '2',
      pubkeySeed: 'd',
      identifier: 'media',
      createdAt: 20,
      kind: Kind.MediaStarterPack,
      profiles: [{ pubkeySeed: 'e' }],
    }))

    expect(getExploreFollowPackSummary(starter!)).toBe('2 profiles to follow together.')
    expect(getExploreFollowPackSummary(media!)).toBe('1 media-focused profile to follow together.')
  })

  it('ranks packs by what is new to you and skips muted or self targets', () => {
    const currentUserPubkey = makePubkey('9')
    const preferred = buildExploreFollowPackCandidates([
      makePackEvent({
        idSeed: '1',
        pubkeySeed: 'a',
        identifier: 'tech',
        createdAt: Math.floor(Date.now() / 1000),
        profiles: [
          { pubkeySeed: 'b' },
          { pubkeySeed: 'c' },
          { pubkeySeed: 'd' },
        ],
        title: 'Tech voices',
      }),
      makePackEvent({
        idSeed: '2',
        pubkeySeed: 'e',
        identifier: 'already-followed',
        createdAt: Math.floor(Date.now() / 1000) - 86_400,
        profiles: [
          { pubkeySeed: 'b' },
          { pubkeySeed: '9' },
          { pubkeySeed: 'f' },
        ],
        title: 'Already followed',
      }),
    ])

    const ranked = rankExploreFollowPacks(preferred, {
      currentUserPubkey,
      followedPubkeys: new Set([makePubkey('a'), makePubkey('b'), makePubkey('f')]),
      isMuted: (pubkey) => pubkey === makePubkey('d'),
    })

    expect(ranked).toHaveLength(2)
    expect(ranked[0]?.parsed.title).toBe('Tech voices')
    expect(ranked[0]?.reason).toBe('1 new from someone you already follow')
    expect(ranked[0]?.missingProfiles.map((profile) => profile.pubkey)).toEqual([
      makePubkey('c'),
    ])
    expect(ranked[0]?.previewProfiles.map((profile) => profile.pubkey)).toEqual([
      makePubkey('c'),
      makePubkey('b'),
    ])

    expect(ranked[1]?.missingProfiles.map((profile) => profile.pubkey)).toEqual([])
    expect(ranked[1]?.overlapProfiles.map((profile) => profile.pubkey)).toEqual([
      makePubkey('b'),
      makePubkey('f'),
    ])
    expect(ranked[1]?.reason).toBe('2 already in your network')
  })
})
