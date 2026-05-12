import { describe, expect, it } from 'vitest'
import { getProfileReportPublishedMessage } from './profileReportMessage'

describe('getProfileReportPublishedMessage', () => {
  it('returns public destination copy', () => {
    expect(getProfileReportPublishedMessage({ destination: 'public', mutedAuthor: false }))
      .toBe('Kind-1984 report published to your write relays.')
  })

  it('returns private destination copy', () => {
    expect(getProfileReportPublishedMessage({ destination: 'private', mutedAuthor: false }))
      .toBe('Private report published to your configured relay list.')
  })

  it('returns moderator destination copy', () => {
    expect(getProfileReportPublishedMessage({ destination: 'moderator', mutedAuthor: false }))
      .toBe('Encrypted moderation request sent to the configured moderator service.')
  })

  it('appends muted copy when author is muted after publish', () => {
    expect(getProfileReportPublishedMessage({ destination: 'moderator', mutedAuthor: true }))
      .toBe('Encrypted moderation request sent to the configured moderator service. Author muted locally.')
  })
})
