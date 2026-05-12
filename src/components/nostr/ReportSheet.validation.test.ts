import { describe, expect, it } from 'vitest'
import { isValidModeratorPubkey } from '@/lib/moderation/reportValidation'

describe('ReportSheet moderator validation', () => {
  it('accepts a 64-char hex pubkey', () => {
    expect(isValidModeratorPubkey('a'.repeat(64))).toBe(true)
    expect(isValidModeratorPubkey('A'.repeat(64))).toBe(true)
  })

  it('rejects non-hex or wrong-length pubkeys', () => {
    expect(isValidModeratorPubkey('z'.repeat(64))).toBe(false)
    expect(isValidModeratorPubkey('a'.repeat(63))).toBe(false)
    expect(isValidModeratorPubkey('a'.repeat(65))).toBe(false)
    expect(isValidModeratorPubkey('')).toBe(false)
  })
})
