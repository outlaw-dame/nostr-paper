import { neventEncode } from 'nostr-tools/nip19'
import {
  buildClientTagFromHandlerAddress,
  buildHandlerLaunchUrl,
  getHandlerDisplayName,
  getHandlerRecommendationSummary,
  getHandlerSummary,
  isNostrPaperSupportedKind,
  parseHandlerInformationEvent,
  parseHandlerRecommendationEvent,
} from './appHandlers'
import { Kind, type NostrEvent } from '@/types'

function baseEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: '1'.repeat(64),
    pubkey: '2'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.ShortNote,
    tags: [],
    content: '',
    sig: '3'.repeat(128),
    ...overrides,
  }
}

describe('parseHandlerInformationEvent', () => {
  it('parses compliant kind-31990 handler information', () => {
    const parsed = parseHandlerInformationEvent(baseEvent({
      kind: Kind.HandlerInformation,
      content: JSON.stringify({
        display_name: 'Nostr Paper',
        about: 'A structured web handler.',
        website: 'https://paper.example',
        picture: 'https://paper.example/icon.png',
      }),
      tags: [
        ['d', 'nostr-paper-web'],
        ['k', '1'],
        ['k', '30023'],
        ['web', 'https://paper.example/note/<bech32>', 'nevent'],
        ['web', 'https://paper.example/a/<bech32>', 'naddr'],
      ],
    }))

    expect(parsed).toMatchObject({
      identifier: 'nostr-paper-web',
      address: `31990:${'2'.repeat(64)}:nostr-paper-web`,
      supportedKinds: [1, 30023],
      metadata: expect.objectContaining({
        display_name: 'Nostr Paper',
        website: 'https://paper.example',
      }),
    })
    expect(parsed?.links).toEqual(expect.arrayContaining([
      {
        platform: 'web',
        urlTemplate: 'https://paper.example/note/<bech32>',
        entityType: 'nevent',
      },
      {
        platform: 'web',
        urlTemplate: 'https://paper.example/a/<bech32>',
        entityType: 'naddr',
      },
    ]))
    expect(parsed?.naddr).toMatch(/^naddr1/)
    expect(getHandlerDisplayName(parsed!)).toBe('Nostr Paper')
    expect(getHandlerSummary(parsed!)).toBe('A structured web handler.')
  })
})

describe('parseHandlerRecommendationEvent', () => {
  it('parses compliant kind-31989 recommendations', () => {
    const parsed = parseHandlerRecommendationEvent(baseEvent({
      kind: Kind.HandlerRecommendation,
      tags: [
        ['d', '31337'],
        ['a', `31990:${'4'.repeat(64)}:app-one`, 'wss://relay.example.com', 'web'],
        ['a', `31990:${'5'.repeat(64)}:app-two`, '', 'ios'],
      ],
    }))

    expect(parsed).toEqual({
      id: '1'.repeat(64),
      pubkey: '2'.repeat(64),
      createdAt: 1_700_000_000,
      supportedKind: 31337,
      recommendations: [
        {
          address: `31990:${'4'.repeat(64)}:app-one`,
          relayHint: 'wss://relay.example.com',
          platform: 'web',
        },
        {
          address: `31990:${'5'.repeat(64)}:app-two`,
          platform: 'ios',
        },
      ],
    })
    expect(getHandlerRecommendationSummary(parsed!)).toBe('Recommends 2 handlers for kind 31337.')
  })
})

describe('buildHandlerLaunchUrl', () => {
  it('prefers the exact entity handler for the encoded reference', () => {
    const handler = parseHandlerInformationEvent(baseEvent({
      kind: Kind.HandlerInformation,
      tags: [
        ['d', 'nostr-paper-web'],
        ['k', '1'],
        ['web', 'https://paper.example/generic/<bech32>'],
        ['web', 'https://paper.example/note/<bech32>', 'nevent'],
      ],
    }))

    const nevent = neventEncode({
      id: '9'.repeat(64),
      author: '8'.repeat(64),
      kind: 31337,
    })

    expect(buildHandlerLaunchUrl(handler!, nevent, 'web')).toBe(`https://paper.example/note/${nevent}`)
  })
})

describe('client tags and supported kinds', () => {
  it('builds a compliant client tag from a handler address', () => {
    expect(buildClientTagFromHandlerAddress(
      `31990:${'a'.repeat(64)}:nostr-paper-web`,
      'wss://relay.example.com',
    )).toEqual([
      'client',
      'Nostr Paper',
      `31990:${'a'.repeat(64)}:nostr-paper-web`,
      'wss://relay.example.com',
    ])
  })

  it('tracks the kinds this client actually handles', () => {
    expect(isNostrPaperSupportedKind(Kind.HandlerInformation)).toBe(true)
    expect(isNostrPaperSupportedKind(Kind.HandlerRecommendation)).toBe(true)
    expect(isNostrPaperSupportedKind(Kind.UserStatus)).toBe(true)
    expect(isNostrPaperSupportedKind(Kind.Thread)).toBe(true)
    expect(isNostrPaperSupportedKind(Kind.Comment)).toBe(true)
    expect(isNostrPaperSupportedKind(Kind.Poll)).toBe(true)
    expect(isNostrPaperSupportedKind(Kind.PollVote)).toBe(true)
    expect(isNostrPaperSupportedKind(Kind.Bookmarks)).toBe(true)
    expect(isNostrPaperSupportedKind(Kind.RelaySet)).toBe(true)
    expect(isNostrPaperSupportedKind(Kind.StarterPack)).toBe(true)
    expect(isNostrPaperSupportedKind(5000)).toBe(true)
    expect(isNostrPaperSupportedKind(5999)).toBe(true)
    expect(isNostrPaperSupportedKind(6000)).toBe(true)
    expect(isNostrPaperSupportedKind(6999)).toBe(true)
    expect(isNostrPaperSupportedKind(Kind.DvmJobFeedback)).toBe(true)
    expect(isNostrPaperSupportedKind(31337)).toBe(false)
  })
})
