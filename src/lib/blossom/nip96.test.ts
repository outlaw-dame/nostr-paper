import { afterEach, describe, expect, it, vi } from 'vitest'
import * as retry from '@/lib/retry'
import { discoverNip96Server, nip96Upload } from './nip96'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('discoverNip96Server', () => {
  it('resolves a valid server descriptor from .well-known', async () => {
    const fetchWithRetrySpy = vi.spyOn(retry, 'fetchWithRetry')
    fetchWithRetrySpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        api_url: 'https://files.example.com/api',
        download_url: 'https://cdn.example.com/files',
      }),
    } as Response)

    const descriptor = await discoverNip96Server('https://files.example.com')

    expect(descriptor).toEqual({
      serverUrl: 'https://files.example.com',
      apiUrl: 'https://files.example.com/api',
      downloadUrl: 'https://cdn.example.com/files',
    })
    expect(fetchWithRetrySpy).toHaveBeenCalledTimes(1)
  })

  it('rejects non-HTTPS discovery endpoints', async () => {
    const fetchWithRetrySpy = vi.spyOn(retry, 'fetchWithRetry')
    const descriptor = await discoverNip96Server('http://files.example.com')
    expect(descriptor).toBeNull()
    expect(fetchWithRetrySpy).not.toHaveBeenCalled()
  })

  it('follows HTTPS delegation and records delegatedToUrl', async () => {
    const fetchWithRetrySpy = vi.spyOn(retry, 'fetchWithRetry')

    fetchWithRetrySpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          delegated_to_url: 'https://media.example.com/',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          api_url: 'https://media.example.com/upload',
          download_url: 'https://cdn.example.com/files',
        }),
      } as Response)

    const descriptor = await discoverNip96Server('https://files.example.com')

    expect(descriptor).toEqual({
      serverUrl: 'https://media.example.com',
      apiUrl: 'https://media.example.com/upload',
      downloadUrl: 'https://cdn.example.com/files',
      delegatedToUrl: 'https://media.example.com',
    })
    expect(fetchWithRetrySpy).toHaveBeenCalledTimes(2)
  })

  it('returns null when delegation loops back to a visited server', async () => {
    const fetchWithRetrySpy = vi.spyOn(retry, 'fetchWithRetry')

    fetchWithRetrySpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          delegated_to_url: 'https://media.example.com',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          delegated_to_url: 'https://files.example.com',
        }),
      } as Response)

    const descriptor = await discoverNip96Server('https://files.example.com')

    expect(descriptor).toBeNull()
    expect(fetchWithRetrySpy).toHaveBeenCalledTimes(2)
  })

  it('rejects non-HTTPS api_url in descriptor', async () => {
    vi.spyOn(retry, 'fetchWithRetry').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        api_url: 'http://files.example.com/upload',
      }),
    } as Response)

    const descriptor = await discoverNip96Server('https://files.example.com')

    expect(descriptor).toBeNull()
  })
})

describe('nip96Upload', () => {
  it('maps successful NIP-96 responses into a BlossomBlob-compatible descriptor', async () => {
    const fetchWithRetrySpy = vi.spyOn(retry, 'fetchWithRetry').mockResolvedValueOnce({
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
    } as Response)

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
    expect(fetchWithRetrySpy).toHaveBeenCalledTimes(1)
  })

  it('throws before upload when apiUrl is not HTTPS', async () => {
    const fetchWithRetrySpy = vi.spyOn(retry, 'fetchWithRetry')
    const file = new File(['hello'], 'test.png', { type: 'image/png' })

    await expect(
      nip96Upload(
        {
          serverUrl: 'https://files.example.com',
          apiUrl: 'http://files.example.com/api',
        },
        file,
        'Nostr token',
        'a'.repeat(64),
      ),
    ).rejects.toThrow('NIP-96 upload endpoint must be HTTPS.')

    expect(fetchWithRetrySpy).not.toHaveBeenCalled()
  })
})
