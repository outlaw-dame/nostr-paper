import { naddrEncode, neventEncode, noteEncode, nprofileEncode, npubEncode } from 'nostr-tools/nip19'
import {
  buildEventReferenceUri,
  buildEventReferenceValue,
  decodeAddressReference,
  decodeEventReference,
  decodeProfileReference,
  formatNip21Reference,
  getNip21Route,
  parseNip21Reference,
} from './nip21'
import { Kind } from '@/types'

describe('parseNip21Reference', () => {
  it('parses nostr URIs and raw bech32 references except nsec', () => {
    const npub = npubEncode('a'.repeat(64))

    expect(parseNip21Reference(`nostr:${npub}`)?.decoded.type).toBe('npub')
    expect(parseNip21Reference(npub)?.decoded.type).toBe('npub')
    expect(parseNip21Reference('nostr:nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqf3x5p2')).toBeNull()
  })
})

describe('getNip21Route', () => {
  it('maps note/nevent/npub/nprofile/naddr references to internal routes', () => {
    const note = noteEncode('1'.repeat(64))
    const nevent = neventEncode({
      id: '2'.repeat(64),
      author: '3'.repeat(64),
      relays: ['wss://relay.example.com'],
    })
    const npub = npubEncode('4'.repeat(64))
    const nprofile = nprofileEncode({
      pubkey: '5'.repeat(64),
      relays: ['wss://relay.example.com'],
    })
    const naddr = naddrEncode({
      kind: Kind.LongFormContent,
      pubkey: '6'.repeat(64),
      identifier: 'hello-world',
      relays: ['wss://relay.example.com'],
    })

    expect(getNip21Route(`nostr:${note}`)).toBe(`/note/${note}`)
    expect(getNip21Route(`nostr:${nevent}`)).toBe(`/note/${nevent}`)
    expect(getNip21Route(`nostr:${npub}`)).toBe(`/profile/${npub}`)
    expect(getNip21Route(`nostr:${nprofile}`)).toBe(`/profile/${nprofile}`)
    expect(getNip21Route(`nostr:${naddr}`)).toBe(`/a/${naddr}`)
  })
})

describe('decode reference helpers', () => {
  it('decodes event, profile, and address pointers with relay metadata', () => {
    const nevent = neventEncode({
      id: '2'.repeat(64),
      author: '3'.repeat(64),
      kind: Kind.LongFormContent,
      relays: ['wss://relay.example.com'],
    })
    const nprofile = nprofileEncode({
      pubkey: '5'.repeat(64),
      relays: ['wss://relay.example.com'],
    })
    const naddr = naddrEncode({
      kind: Kind.LongFormContent,
      pubkey: '6'.repeat(64),
      identifier: 'hello-world',
      relays: ['wss://relay.example.com'],
    })

    expect(decodeEventReference(nevent)).toEqual({
      eventId: '2'.repeat(64),
      relays: ['wss://relay.example.com'],
      author: '3'.repeat(64),
      kind: Kind.LongFormContent,
      bech32: nevent,
    })
    expect(decodeProfileReference(nprofile)).toEqual({
      pubkey: '5'.repeat(64),
      relays: ['wss://relay.example.com'],
      bech32: nprofile,
    })
    expect(decodeAddressReference(naddr)).toEqual({
      pubkey: '6'.repeat(64),
      kind: Kind.LongFormContent,
      identifier: 'hello-world',
      relays: ['wss://relay.example.com'],
      bech32: naddr,
    })
  })

  it('formats references safely for compact display', () => {
    const note = noteEncode('1'.repeat(64))
    expect(formatNip21Reference(`nostr:${note}`, 20)).toContain('nostr:')
    expect(formatNip21Reference(`nostr:${note}`, 20).endsWith('…')).toBe(true)
  })

  it('encodes event references for addressable and non-addressable events', () => {
    const noteRef = buildEventReferenceValue({
      id: '1'.repeat(64),
      pubkey: '2'.repeat(64),
      kind: Kind.ShortNote,
      tags: [],
    })

    const articleRef = buildEventReferenceValue({
      id: '3'.repeat(64),
      pubkey: '4'.repeat(64),
      kind: Kind.LongFormContent,
      tags: [['d', 'hello-world']],
    }, ['wss://relay.example.com'])

    expect(noteRef).toMatch(/^nevent1/)
    expect(articleRef).toMatch(/^naddr1/)
    expect(buildEventReferenceUri({
      id: '3'.repeat(64),
      pubkey: '4'.repeat(64),
      kind: Kind.LongFormContent,
      tags: [['d', 'hello-world']],
    }, ['wss://relay.example.com'])).toBe(`nostr:${articleRef}`)
  })
})
