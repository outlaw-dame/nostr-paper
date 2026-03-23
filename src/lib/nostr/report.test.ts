import {
  buildReportDraft,
  getReportSummary,
  parseReportEvent,
  parseReportLabelsInput,
} from './report'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: Kind.Report,
    tags: [
      ['p', 'c'.repeat(64), 'spam'],
    ],
    content: '',
    sig: 'd'.repeat(128),
    ...overrides,
  }
}

describe('parseReportEvent', () => {
  it('parses a profile report with matching NIP-32 labels', () => {
    const parsed = parseReportEvent(baseEvent({
      tags: [
        ['p', 'c'.repeat(64), 'nudity'],
        ['L', 'social.nos.ontology'],
        ['l', 'NS-nud', 'social.nos.ontology'],
      ],
      content: '  <b>profile photo is explicit</b>  ',
    }))

    expect(parsed).not.toBeNull()
    expect(parsed?.profileTargets).toEqual([
      { pubkey: 'c'.repeat(64), reportType: 'nudity' },
    ])
    expect(parsed?.labels).toEqual([
      { value: 'NS-nud', namespace: 'social.nos.ontology' },
    ])
    expect(parsed?.reason).toBe('profile photo is explicit')
  })

  it('parses note reports with typed e-tags and contextual pubkeys', () => {
    const parsed = parseReportEvent(baseEvent({
      tags: [
        ['e', 'e'.repeat(64), 'illegal'],
        ['p', 'c'.repeat(64)],
      ],
      content: "He's insulting the king!",
    }))

    expect(parsed).not.toBeNull()
    expect(parsed?.eventTargets).toEqual([
      { eventId: 'e'.repeat(64), reportType: 'illegal' },
    ])
    expect(parsed?.profileTargets).toEqual([
      { pubkey: 'c'.repeat(64) },
    ])
    expect(getReportSummary(parsed!)).toBe('Reported an event for illegal content.')
  })

  it('parses blob reports and safe server tags', () => {
    const parsed = parseReportEvent(baseEvent({
      tags: [
        ['x', 'f'.repeat(64), 'malware'],
        ['e', 'e'.repeat(64), 'malware'],
        ['p', 'c'.repeat(64)],
        ['server', 'https://cdn.example.com/blob.exe'],
        ['server', 'javascript:alert(1)'],
      ],
      content: 'malicious binary',
    }))

    expect(parsed).not.toBeNull()
    expect(parsed?.blobTargets).toEqual([
      { hash: 'f'.repeat(64), reportType: 'malware' },
    ])
    expect(parsed?.serverUrls).toEqual([
      'https://cdn.example.com/blob.exe',
    ])
  })

  it('treats unlabeled l-tags as ugc when no namespaces are declared', () => {
    const parsed = parseReportEvent(baseEvent({
      tags: [
        ['p', 'c'.repeat(64), 'other'],
        ['l', 'needs-review'],
      ],
    }))

    expect(parsed?.labels).toEqual([
      { value: 'needs-review', namespace: 'ugc' },
    ])
  })
})

describe('parseReportLabelsInput', () => {
  it('normalizes comma and newline separated labels into one namespace', () => {
    expect(parseReportLabelsInput('spam,\n hate speech , spam', 'ugc')).toEqual([
      { value: 'spam', namespace: 'ugc' },
      { value: 'hate speech', namespace: 'ugc' },
    ])
  })
})

describe('buildReportDraft', () => {
  it('builds a compliant profile report draft with NIP-32 labels', () => {
    const draft = buildReportDraft(
      { type: 'profile', pubkey: 'c'.repeat(64) },
      {
        reportType: 'impersonation',
        reason: 'Pretending to be the official account.',
        labels: [
          { value: 'acct-impersonation', namespace: 'ugc' },
        ],
      },
    )

    expect(draft.kind).toBe(Kind.Report)
    expect(draft.tags).toEqual([
      ['p', 'c'.repeat(64), 'impersonation'],
      ['L', 'ugc'],
      ['l', 'acct-impersonation', 'ugc'],
    ])
    expect(draft.content).toBe('Pretending to be the official account.')
  })

  it('builds event report drafts with typed e-tags and untyped p-tags', () => {
    const targetEvent: NostrEvent = {
      id: 'e'.repeat(64),
      pubkey: 'c'.repeat(64),
      created_at: 1_700_000_001,
      kind: Kind.ShortNote,
      tags: [],
      content: 'spam',
      sig: 'f'.repeat(128),
    }

    const draft = buildReportDraft(
      { type: 'event', event: targetEvent },
      { reportType: 'spam', reason: 'Repeated scam links.' },
    )

    expect(draft.tags).toEqual([
      ['e', 'e'.repeat(64), 'spam'],
      ['p', 'c'.repeat(64)],
    ])
  })

  it('builds blob report drafts from kind-1063 metadata', () => {
    const fileEvent: NostrEvent = {
      id: 'e'.repeat(64),
      pubkey: 'c'.repeat(64),
      created_at: 1_700_000_001,
      kind: Kind.FileMetadata,
      tags: [
        ['url', 'https://cdn.example.com/blob.jpg'],
        ['m', 'image/jpeg'],
        ['x', 'f'.repeat(64)],
        ['fallback', 'https://backup.example.com/blob.jpg'],
      ],
      content: 'Suspicious file',
      sig: 'f'.repeat(128),
    }

    const draft = buildReportDraft(
      { type: 'event', event: fileEvent },
      { reportType: 'malware' },
    )

    expect(draft.tags).toEqual([
      ['x', 'f'.repeat(64), 'malware'],
      ['e', 'e'.repeat(64), 'malware'],
      ['p', 'c'.repeat(64)],
      ['server', 'https://cdn.example.com/blob.jpg'],
      ['server', 'https://backup.example.com/blob.jpg'],
    ])
  })
})
