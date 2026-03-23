import {
  parsePollEvent,
  parsePollVoteEvent,
  tallyPollVotes,
} from './polls'
import { Kind, type NostrEvent, type UnsignedEvent } from '@/types'

let eventCounter = 0

function makeEvent(event: UnsignedEvent): NostrEvent {
  eventCounter += 1
  return {
    ...event,
    id: eventCounter.toString(16).padStart(64, '0'),
    sig: 'f'.repeat(128),
  }
}

describe('parsePollEvent', () => {
  it('parses a compliant poll and defaults polltype to singlechoice', () => {
    const poll = makeEvent({
      kind: Kind.Poll,
      pubkey: 'a'.repeat(64),
      created_at: 1_720_000_000,
      tags: [
        ['option', 'opt1', 'Yes'],
        ['option', 'opt2', 'No'],
        ['relay', 'wss://relay.example.com/'],
        ['relay', 'wss://relay2.example.com'],
        ['endsAt', '1720003600'],
      ],
      content: 'Ship it?',
    })

    expect(parsePollEvent(poll)).toEqual({
      id: poll.id,
      pubkey: poll.pubkey,
      createdAt: poll.created_at,
      question: 'Ship it?',
      pollType: 'singlechoice',
      options: [
        { optionId: 'opt1', label: 'Yes', index: 0 },
        { optionId: 'opt2', label: 'No', index: 1 },
      ],
      relayUrls: [
        'wss://relay.example.com/',
        'wss://relay2.example.com/',
      ],
      endsAt: 1_720_003_600,
    })
  })
})

describe('parsePollVoteEvent', () => {
  it('uses only the first response for single-choice polls', () => {
    const poll = parsePollEvent(makeEvent({
      kind: Kind.Poll,
      pubkey: 'a'.repeat(64),
      created_at: 1_720_000_000,
      tags: [
        ['option', 'opt1', 'Yes'],
        ['option', 'opt2', 'No'],
        ['relay', 'wss://relay.example.com'],
      ],
      content: 'Ship it?',
    }))!

    const vote = makeEvent({
      kind: Kind.PollVote,
      pubkey: 'b'.repeat(64),
      created_at: 1_720_000_100,
      tags: [
        ['e', poll.id],
        ['response', 'opt2'],
        ['response', 'opt1'],
      ],
      content: '',
    })

    expect(parsePollVoteEvent(vote, poll)?.responses).toEqual(['opt2'])
  })

  it('dedupes valid responses for multiple-choice polls', () => {
    const poll = parsePollEvent(makeEvent({
      kind: Kind.Poll,
      pubkey: 'a'.repeat(64),
      created_at: 1_720_000_000,
      tags: [
        ['option', 'opt1', 'Rust'],
        ['option', 'opt2', 'TypeScript'],
        ['option', 'opt3', 'Go'],
        ['relay', 'wss://relay.example.com'],
        ['polltype', 'multiplechoice'],
      ],
      content: 'Which languages?',
    }))!

    const vote = makeEvent({
      kind: Kind.PollVote,
      pubkey: 'b'.repeat(64),
      created_at: 1_720_000_100,
      tags: [
        ['e', poll.id],
        ['response', 'opt2'],
        ['response', 'opt2'],
        ['response', 'opt3'],
        ['response', 'bogus'],
      ],
      content: '',
    })

    expect(parsePollVoteEvent(vote, poll)?.responses).toEqual(['opt2', 'opt3'])
  })
})

describe('tallyPollVotes', () => {
  it('counts only the latest in-window vote event per pubkey', () => {
    const poll = parsePollEvent(makeEvent({
      kind: Kind.Poll,
      pubkey: 'a'.repeat(64),
      created_at: 1_720_000_000,
      tags: [
        ['option', 'opt1', 'Yes'],
        ['option', 'opt2', 'No'],
        ['relay', 'wss://relay.example.com'],
        ['endsAt', '1720000500'],
      ],
      content: 'Ship it?',
    }))!

    const olderVote = makeEvent({
      kind: Kind.PollVote,
      pubkey: 'b'.repeat(64),
      created_at: 1_720_000_050,
      tags: [['e', poll.id], ['response', 'opt1']],
      content: '',
    })
    const latestVote = makeEvent({
      kind: Kind.PollVote,
      pubkey: 'b'.repeat(64),
      created_at: 1_720_000_100,
      tags: [['e', poll.id], ['response', 'opt2']],
      content: '',
    })
    const secondUserVote = makeEvent({
      kind: Kind.PollVote,
      pubkey: 'c'.repeat(64),
      created_at: 1_720_000_150,
      tags: [['e', poll.id], ['response', 'opt2']],
      content: '',
    })
    const beforePollVote = makeEvent({
      kind: Kind.PollVote,
      pubkey: 'd'.repeat(64),
      created_at: 1_719_999_999,
      tags: [['e', poll.id], ['response', 'opt1']],
      content: '',
    })
    const afterPollVote = makeEvent({
      kind: Kind.PollVote,
      pubkey: 'e'.repeat(64),
      created_at: 1_720_000_501,
      tags: [['e', poll.id], ['response', 'opt1']],
      content: '',
    })

    expect(tallyPollVotes(
      poll,
      [olderVote, latestVote, secondUserVote, beforePollVote, afterPollVote],
      'b'.repeat(64),
    )).toEqual({
      totalVotes: 2,
      optionCounts: {
        opt1: 0,
        opt2: 2,
      },
      winningOptionIds: ['opt2'],
      currentUserResponses: ['opt2'],
      currentUserHasVoted: true,
    })
  })
})
