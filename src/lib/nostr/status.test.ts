import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { naddrEncode, neventEncode, nprofileEncode } from 'nostr-tools/nip19'
import {
  buildStatusReferenceTags,
  getUserStatusRoute,
  isActiveUserStatus,
  normalizeStatusReferenceUri,
  parseUserStatusEvent,
} from './status'
import type { NostrEvent, UnsignedEvent } from '@/types'
import { Kind } from '@/types'

type TestUnsignedEvent = Omit<UnsignedEvent, 'pubkey'> & { pubkey?: string }

function signEvent(event: TestUnsignedEvent): NostrEvent {
  const secretKey = generateSecretKey()
  return finalizeEvent({
    pubkey: 'f'.repeat(64),
    ...event,
  }, secretKey) as NostrEvent
}

describe('parseUserStatusEvent', () => {
  it('parses a compliant music status with a safe r tag and expiration', () => {
    const event = signEvent({
      kind: Kind.UserStatus,
      created_at: 1_720_000_000,
      tags: [
        ['d', 'music'],
        ['r', 'spotify:track:4uLU6hMCjMI75M1A2tKUQC'],
        ['expiration', '1720000180'],
      ],
      content: 'Never Gonna Give You Up',
    })

    expect(parseUserStatusEvent(event, 1_720_000_100)).toEqual(expect.objectContaining({
      identifier: 'music',
      content: 'Never Gonna Give You Up',
      referenceUri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
      expiresAt: 1_720_000_180,
      isExpired: false,
      isCleared: false,
    }))
  })

  it('treats empty content as a clear event', () => {
    const event = signEvent({
      kind: Kind.UserStatus,
      created_at: 1_720_000_000,
      tags: [['d', 'music']],
      content: '',
    })

    const parsed = parseUserStatusEvent(event)
    expect(parsed?.isCleared).toBe(true)
    expect(isActiveUserStatus(parsed)).toBe(false)
  })
})

describe('normalizeStatusReferenceUri', () => {
  it('normalizes safe https urls and strips unsafe fragments and credentials', () => {
    expect(normalizeStatusReferenceUri('https://user:pass@example.com/track?id=1#frag')).toBe('https://example.com/track?id=1')
  })

  it('rejects blocked URI schemes', () => {
    expect(normalizeStatusReferenceUri('javascript:alert(1)')).toBeNull()
    expect(normalizeStatusReferenceUri('data:text/plain,hi')).toBeNull()
  })
})

describe('buildStatusReferenceTags', () => {
  it('uses e and p tags for event references', () => {
    const tags = buildStatusReferenceTags(`nostr:${neventEncode({
      id: '1'.repeat(64),
      author: '2'.repeat(64),
      kind: Kind.FileMetadata,
      relays: ['wss://relay.example.com'],
    })}`)

    expect(tags).toEqual([
      ['e', '1'.repeat(64), 'wss://relay.example.com'],
      ['p', '2'.repeat(64)],
    ])
  })

  it('uses a and p tags for addressable references and routes them as naddr links', () => {
    const reference = `nostr:${naddrEncode({
      kind: Kind.LongFormContent,
      pubkey: '3'.repeat(64),
      identifier: 'cover-art',
      relays: ['wss://relay.example.com'],
    })}`
    const tags = buildStatusReferenceTags(reference)
    const event = signEvent({
      kind: Kind.UserStatus,
      created_at: 1_720_000_000,
      tags: [['d', 'music'], ...tags],
      content: 'Cover art',
    })
    const parsed = parseUserStatusEvent(event)

    expect(tags).toEqual([
      ['a', `${Kind.LongFormContent}:${'3'.repeat(64)}:cover-art`, 'wss://relay.example.com'],
      ['p', '3'.repeat(64)],
    ])
    expect(getUserStatusRoute(parsed!)).toMatch(/^\/a\/naddr1/)
  })

  it('uses p tags for profile references and r tags for external URIs', () => {
    expect(buildStatusReferenceTags(`nostr:${nprofileEncode({
      pubkey: '4'.repeat(64),
      relays: ['wss://relay.example.com'],
    })}`)).toEqual([
      ['p', '4'.repeat(64), 'wss://relay.example.com'],
    ])

    expect(buildStatusReferenceTags('spotify:track:abc123')).toEqual([
      ['r', 'spotify:track:abc123'],
    ])
  })
})
