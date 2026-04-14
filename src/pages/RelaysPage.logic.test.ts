import { describe, expect, it } from 'vitest'
import { isRemoteImportEnabled } from './relaysPageLogic'

describe('RelaysPage logic', () => {
  it('enables remote import only when a pubkey is present', () => {
    expect(isRemoteImportEnabled('a'.repeat(64))).toBe(true)
    expect(isRemoteImportEnabled('')).toBe(false)
    expect(isRemoteImportEnabled(null)).toBe(false)
    expect(isRemoteImportEnabled(undefined)).toBe(false)
  })
})
