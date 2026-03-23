import { neventEncode, nprofileEncode } from 'nostr-tools/nip19'
import { prepareNoteContent } from './note'
import type { Nip94Tags } from '@/types'

const mediaAttachment: Nip94Tags = {
  url: 'https://cdn.example.com/photo.jpg',
  mimeType: 'image/jpeg',
  fileHash: '5'.repeat(64),
  alt: 'Cover image',
}

describe('prepareNoteContent', () => {
  it('builds a quote post with matching p, t, and q tags', () => {
    const quoteReferenceUri = `nostr:${neventEncode({
      id: '1'.repeat(64),
      author: '2'.repeat(64),
      kind: 1,
      relays: ['wss://relay.example.com'],
    })}`

    const prepared = prepareNoteContent({
      body: 'Worth reading #Nostr',
      quoteReferenceUri,
      quoteAuthorPubkey: '2'.repeat(64),
    })

    expect(prepared.content).toBe(`Worth reading #Nostr\n\n${quoteReferenceUri}`)
    expect(prepared.tags).toEqual(expect.arrayContaining([
      ['p', '2'.repeat(64)],
      ['t', 'nostr'],
      ['q', '1'.repeat(64), 'wss://relay.example.com', '2'.repeat(64)],
    ]))
  })

  it('allows quote-only posts', () => {
    const quoteReferenceUri = `nostr:${neventEncode({
      id: '3'.repeat(64),
      author: '4'.repeat(64),
      kind: 1,
    })}`

    const prepared = prepareNoteContent({ quoteReferenceUri })

    expect(prepared.content).toBe(quoteReferenceUri)
    expect(prepared.tags).toEqual([
      ['p', '4'.repeat(64)],
      ['q', '3'.repeat(64), '', '4'.repeat(64)],
    ])
  })

  it('rejects empty notes with no quote reference', () => {
    expect(() => prepareNoteContent({ body: '   ' })).toThrow('Notes cannot be empty.')
  })

  it('appends media URLs and matching imeta tags', () => {
    const prepared = prepareNoteContent({
      body: 'Photo drop #Nostr',
      media: [mediaAttachment],
    })

    expect(prepared.content).toBe('Photo drop #Nostr\n\nhttps://cdn.example.com/photo.jpg')
    expect(prepared.tags).toEqual(expect.arrayContaining([
      ['t', 'nostr'],
      [
        'imeta',
        'url https://cdn.example.com/photo.jpg',
        'm image/jpeg',
        `x ${'5'.repeat(64)}`,
        'alt Cover image',
      ],
    ]))
  })

  it('adds p tags for inline NIP-27 profile mentions', () => {
    const profileReference = `nostr:${nprofileEncode({
      pubkey: '6'.repeat(64),
      relays: ['wss://relay.example.com'],
    })}`

    const prepared = prepareNoteContent({
      body: `Hi ${profileReference}`,
    })

    expect(prepared.tags).toEqual(expect.arrayContaining([
      ['p', '6'.repeat(64)],
    ]))
  })

  it('adds an expiration tag when requested', () => {
    const prepared = prepareNoteContent({
      body: 'Story time',
      media: [mediaAttachment],
      expiresAt: 1_710_000_000,
    })

    expect(prepared.tags).toEqual(expect.arrayContaining([
      ['expiration', '1710000000'],
    ]))
  })
})
