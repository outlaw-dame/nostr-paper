import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlossomAuth } from './auth'

const signedEvents = vi.hoisted(() => [] as Array<{
  kind?: number
  content?: string
  created_at?: number
  tags?: string[][]
}>)

vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKEvent: class {
    kind?: number
    content?: string
    created_at?: number
    tags?: string[][]

    async sign() {
      const event: {
        kind?: number
        content?: string
        created_at?: number
        tags?: string[][]
      } = {}
      if (this.kind !== undefined) event.kind = this.kind
      if (this.content !== undefined) event.content = this.content
      if (this.created_at !== undefined) event.created_at = this.created_at
      if (this.tags !== undefined) event.tags = this.tags
      signedEvents.push(event)
    }

    rawEvent() {
      return {
        id: 'a'.repeat(64),
        pubkey: 'b'.repeat(64),
        created_at: this.created_at,
        kind: this.kind,
        tags: this.tags,
        content: this.content,
        sig: 'c'.repeat(128),
      }
    }
  },
}))

function decodeHeader(header: string): {
  kind: number
  tags: string[][]
  content: string
} {
  const token = header.replace(/^Nostr\s+/, '')
  const padded = token.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(token.length / 4) * 4, '=')
  return JSON.parse(atob(padded))
}

describe('createBlossomAuth', () => {
  beforeEach(() => {
    signedEvents.length = 0
  })

  it('creates a BUD-11 kind-24242 token scoped to server and hash', async () => {
    const header = await createBlossomAuth({ signer: {} } as never, {
      verb: 'upload',
      serverUrl: 'https://Media.Example.com/upload',
      sha256: 'A'.repeat(64),
    })

    const event = decodeHeader(header)

    expect(header.startsWith('Nostr ')).toBe(true)
    expect(event.kind).toBe(24242)
    expect(event.content).toBe('Upload Blossom blob')
    expect(event.tags).toContainEqual(['t', 'upload'])
    expect(event.tags).toContainEqual(['server', 'media.example.com'])
    expect(event.tags).toContainEqual(['x', 'a'.repeat(64)])
    expect(event.tags.some(tag => tag[0] === 'expiration')).toBe(true)
    expect(signedEvents).toHaveLength(1)
  })

  it('rejects invalid hash scopes before asking the signer', async () => {
    await expect(
      createBlossomAuth({ signer: {} } as never, {
        verb: 'delete',
        sha256: 'not-a-hash',
      }),
    ).rejects.toThrow('Blossom authorization hash')

    expect(signedEvents).toHaveLength(0)
  })
})
