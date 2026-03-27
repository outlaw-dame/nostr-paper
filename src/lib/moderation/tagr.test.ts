import { describe, expect, it } from 'vitest'
import { Kind, type NostrEvent } from '@/types'
import { getTagrReason, isTagrModerationEvent } from './tagr'

const TAGR_PUBKEY = '56d4b3d6310fadb7294b7f041aab469c5ffc8991b1b1b331981b96a246f6ae65'

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'f'.repeat(64),
    pubkey: TAGR_PUBKEY,
    created_at: 1_700_000_000,
    kind: Kind.Report,
    tags: [['e', 'e'.repeat(64), 'spam']],
    content: '',
    sig: 'a'.repeat(128),
    ...overrides,
  }
}

describe('tagr moderation parsing', () => {
  it('accepts tagr report events as moderation signals', () => {
    const event = makeEvent({
      kind: Kind.Report,
      tags: [['e', 'e'.repeat(64), 'spam']],
    })

    expect(isTagrModerationEvent(event)).toBe(true)
    expect(getTagrReason(event)).toBe('spam')
  })

  it('accepts tagr label events with MOD> codes', () => {
    const event = makeEvent({
      kind: Kind.Label,
      tags: [
        ['L', 'social.nos.ontology'],
        ['l', 'MOD>NS-nud', 'social.nos.ontology'],
        ['e', 'e'.repeat(64)],
      ],
    })

    expect(isTagrModerationEvent(event)).toBe(true)
    expect(getTagrReason(event)).toBe('NS-nud')
  })

  it('ignores non-tagr authors', () => {
    const event = makeEvent({
      pubkey: '1'.repeat(64),
      kind: Kind.Report,
      tags: [['e', 'e'.repeat(64), 'spam']],
    })

    expect(isTagrModerationEvent(event)).toBe(false)
  })

  it('ignores non-moderation labels', () => {
    const event = makeEvent({
      kind: Kind.Label,
      tags: [
        ['L', 'license'],
        ['l', 'MIT', 'license'],
        ['e', 'e'.repeat(64)],
      ],
    })

    expect(isTagrModerationEvent(event)).toBe(false)
  })
})
