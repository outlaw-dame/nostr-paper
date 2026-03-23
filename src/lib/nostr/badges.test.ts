import {
  parseBadgeAwardEvent,
  parseBadgeDefinitionEvent,
  parseProfileBadgesEvent,
  pickBadgeAsset,
} from './badges'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.BadgeDefinition,
    tags: [
      ['d', 'bravery'],
      ['name', 'Medal of Bravery'],
      ['image', 'https://example.com/badge-1024.png', '1024x1024'],
      ['thumb', 'https://example.com/badge-64.png', '64x64'],
    ],
    content: '',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

describe('parseBadgeDefinitionEvent', () => {
  it('parses compliant badge definitions and image assets', () => {
    const parsed = parseBadgeDefinitionEvent(baseEvent({
      tags: [
        ['d', 'bravery'],
        ['name', 'Medal of Bravery'],
        ['description', 'Awarded for brave work'],
        ['image', 'https://example.com/badge-1024.png', '1024x1024'],
        ['thumb', 'https://example.com/badge-256.png', '256x256'],
        ['thumb', 'https://example.com/badge-64.png', '64x64'],
      ],
    }))

    expect(parsed).not.toBeNull()
    expect(parsed?.coordinate).toBe(`30009:${'b'.repeat(64)}:bravery`)
    expect(parsed?.name).toBe('Medal of Bravery')
    expect(parsed?.description).toBe('Awarded for brave work')
    expect(parsed?.image?.width).toBe(1024)
    expect(pickBadgeAsset(parsed!, 80)?.url).toBe('https://example.com/badge-64.png')
  })
})

describe('parseBadgeAwardEvent', () => {
  it('parses kind-8 awards with one badge coordinate and one or more recipients', () => {
    const parsed = parseBadgeAwardEvent(baseEvent({
      kind: Kind.BadgeAward,
      tags: [
        ['a', `30009:${'b'.repeat(64)}:bravery`],
        ['p', 'd'.repeat(64), 'wss://relay.example.com'],
        ['p', 'e'.repeat(64)],
      ],
      content: 'Well earned.',
    }))

    expect(parsed).not.toBeNull()
    expect(parsed?.badgeCoordinate).toBe(`30009:${'b'.repeat(64)}:bravery`)
    expect(parsed?.recipients.map(recipient => recipient.pubkey)).toEqual([
      'd'.repeat(64),
      'e'.repeat(64),
    ])
    expect(parsed?.note).toBe('Well earned.')
  })

  it('rejects awards with more than one badge coordinate', () => {
    expect(parseBadgeAwardEvent(baseEvent({
      kind: Kind.BadgeAward,
      tags: [
        ['a', `30009:${'b'.repeat(64)}:bravery`],
        ['a', `30009:${'b'.repeat(64)}:honor`],
        ['p', 'd'.repeat(64)],
      ],
    }))).toBeNull()
  })
})

describe('parseProfileBadgesEvent', () => {
  it('keeps ordered adjacent a/e pairs and ignores dangling tags', () => {
    const parsed = parseProfileBadgesEvent(baseEvent({
      kind: Kind.ProfileBadges,
      tags: [
        ['d', 'profile_badges'],
        ['a', `30009:${'f'.repeat(64)}:bravery`],
        ['e', '1'.repeat(64), 'wss://relay.example.com'],
        ['a', `30009:${'f'.repeat(64)}:honor`],
        ['t', 'not-a-pair'],
        ['e', '2'.repeat(64)],
      ],
    }))

    expect(parsed).not.toBeNull()
    expect(parsed?.references).toEqual([
      {
        badgeCoordinate: `30009:${'f'.repeat(64)}:bravery`,
        awardEventId: '1'.repeat(64),
        relayHint: 'wss://relay.example.com/',
      },
    ])
  })
})
