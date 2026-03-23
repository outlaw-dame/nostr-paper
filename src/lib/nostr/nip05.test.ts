import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatNip05Identifier,
  parseNip05Identifier,
  resolveNip05Identifier,
} from './nip05'

const originalFetch = globalThis.fetch

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
})

describe('parseNip05Identifier', () => {
  it('normalizes valid identifiers', () => {
    expect(parseNip05Identifier(' Alice@Example.COM ')).toEqual({
      identifier: 'alice@example.com',
      localPart: 'alice',
      domain: 'example.com',
    })
  })

  it('rejects invalid identifiers', () => {
    expect(parseNip05Identifier('not-an-identifier')).toBeNull()
  })
})

describe('formatNip05Identifier', () => {
  it('renders root identifiers as bare domains', () => {
    expect(formatNip05Identifier('_@example.com')).toBe('example.com')
  })
})

describe('resolveNip05Identifier', () => {
  it('resolves valid identifiers and filters relay hints', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        names: {
          alice: 'a'.repeat(64),
        },
        relays: {
          ['a'.repeat(64)]: [
            'wss://relay.example.com',
            'https://not-a-relay.example.com',
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    await expect(resolveNip05Identifier('alice@example.com')).resolves.toEqual({
      identifier: 'alice@example.com',
      pubkey: 'a'.repeat(64),
      relays: ['wss://relay.example.com'],
    })
  })

  it('returns null for invalid payloads', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ names: { alice: 'npub1notvalid' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    await expect(resolveNip05Identifier('alice@example.com')).resolves.toBeNull()
  })
})
