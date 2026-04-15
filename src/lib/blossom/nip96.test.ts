import { describe, expect, it, vi, afterEach } from 'vitest'
import { discoverNip96Server, nip96Upload } from './nip96'

const originalFetch = globalThis.fetch

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
})

describe('discoverNip96Server', () => {
  it('resolves a valid server descriptor from .well-known', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        api_url: 'https://files.example.com/api',
        download_url: 'https://cdn.example.com/files',
      }),
    })) as unknown as typeof fetch

    const descriptor = await discoverNip96Server('https://files.example.com')
    expect(descriptor).toEqual({
      serverUrl: 'https://files.example.com',
      apiUrl: 'https://files.example.com/api',
      downloadUrl: 'https://cdn.example.com/files',
    })
  })
})

describe('nip96Upload', () => {
  it('maps successful NIP-96 responses into a BlossomBlob-compatible descriptor', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'success',
        message: 'Uploaded',
        nip94_event: {
          tags: [
            ['url', 'https://files.example.com/abc.png'],
            ['ox', 'a'.repeat(64)],
            ['x', 'b'.repeat(64)],
            ['m', 'image/png'],
            ['size', '1234'],
            ['dim', '800x600'],
          ],
          content: 'caption',
        },
      }),
    })) as unknown as typeof fetch

    const file = new File(['hello'], 'test.png', { type: 'image/png' })
    const blob = await nip96Upload(
      {
        serverUrl: 'https://files.example.com',
        apiUrl: 'https://files.example.com/api',
      },
      file,
      'Nostr token',
      'a'.repeat(64),
    )

    expect(blob.sha256).toBe('a'.repeat(64))
    expect(blob.url).toBe('https://files.example.com/abc.png')
    expect(blob.type).toBe('image/png')
    expect(blob.nip94?.originalHash).toBe('a'.repeat(64))
    expect(blob.nip94?.fileHash).toBe('b'.repeat(64))
    expect(blob.nip94?.service).toBe('nip96')
  })
})
