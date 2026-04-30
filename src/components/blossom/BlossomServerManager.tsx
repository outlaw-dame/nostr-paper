/**
 * BlossomServerManager — Settings UI for Blossom media server configuration
 *
 * Allows users to:
 * - View configured media servers
 * - Add new Blossom servers by URL
 * - Remove existing servers
 * - Test server connectivity
 */

import React, { useEffect, useState, useCallback } from 'react'
import { getBlossomServers, removeBlossomServer } from '@/lib/db/blossom'
import { blossomProbe } from '@/lib/blossom/client'
import { addAndPublishServer } from '@/lib/blossom/serverList'
import { normaliseBlossomUrl } from '@/lib/blossom/validate'
import type { BlossomServer } from '@/types'

export function BlossomServerManager() {
  const [servers, setServers] = useState<BlossomServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [testingServer, setTestingServer] = useState<string | null>(null)
  const [serverStatuses, setServerStatuses] = useState<Record<string, 'checking' | 'ok' | 'error'>>({})

  const loadServers = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const loaded = await getBlossomServers()
      setServers(loaded)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadServers()
  }, [loadServers])

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUrl.trim()) return

    try {
      setAdding(true)
      setError(null)

      let url = newUrl.trim()
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`
      }
      const normalizedUrl = normaliseBlossomUrl(url)
      if (!normalizedUrl) {
        throw new Error('Enter a valid https:// Blossom server URL.')
      }

      // Verify server is accessible
      await testServerConnectivity(normalizedUrl)

      // Add to local storage and publish BUD-03/NIP-96 server lists.
      await addAndPublishServer(normalizedUrl)
      setNewUrl('')
      await loadServers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add server'
      setError(message)
    } finally {
      setAdding(false)
    }
  }

  const handleRemoveServer = async (url: string) => {
    if (!confirm(`Remove media server?\n${url}`)) return

    try {
      setError(null)
      await removeBlossomServer(url)
      await loadServers()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove server'
      setError(message)
    }
  }

  const testServerConnectivity = async (url: string): Promise<boolean> => {
    try {
      setServerStatuses((prev) => ({ ...prev, [url]: 'checking' }))
      if (await blossomProbe(url)) {
        setServerStatuses((prev) => ({ ...prev, [url]: 'ok' }))
        return true
      }
      throw new Error('Server did not expose a Blossom /upload endpoint.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      setServerStatuses((prev) => ({ ...prev, [url]: 'error' }))
      throw new Error(`Server unreachable: ${message}`)
    }
  }

  const handleTestServer = async (url: string) => {
    try {
      setTestingServer(url)
      setError(null)
      await testServerConnectivity(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test failed'
      setError(message)
    } finally {
      setTestingServer(null)
    }
  }

  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
          Loading servers…
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-[12px] border border-[#FF3B30]/30 bg-[#FF3B30]/10 p-3">
          <p className="text-[13px] text-[#FF3B30]">
            {error}
          </p>
        </div>
      )}

      {/* Add Server Form */}
      <form onSubmit={handleAddServer} className="space-y-2">
        <label className="block">
          <span className="sr-only">Media server URL</span>
          <input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="blossom.example.com or https://blossom.example.com"
            disabled={adding}
            className="
              w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)]
              bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5
              text-[14px] text-[rgb(var(--color-label))]
              outline-none transition-colors focus:border-[#007AFF]
              placeholder:text-[rgb(var(--color-label-tertiary))]
              disabled:opacity-50
            "
          />
        </label>

        <button
          type="submit"
          disabled={adding || !newUrl.trim()}
          className="
            w-full rounded-[12px] bg-[#007AFF] py-2.5 px-3
            text-[14px] font-semibold text-white
            transition-opacity active:opacity-70 disabled:opacity-40
          "
        >
          {adding ? 'Adding…' : 'Add Server'}
        </button>
      </form>

      {/* Server List */}
      {servers.length === 0 ? (
        <div className="rounded-[12px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-4 text-center">
          <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
            No media servers configured. Add one to enable direct media uploads.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            Configured Servers
          </p>

          {servers.map((server) => {
            const status = serverStatuses[server.url]

            return (
              <div
                key={server.url}
                className="flex items-center gap-3 rounded-[12px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3"
              >
                {/* Server URL */}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-[rgb(var(--color-label))] truncate">
                    {new URL(server.url).host}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[rgb(var(--color-label-tertiary))] truncate">
                    {server.url}
                  </p>
                </div>

                {/* Status Indicator */}
                <div className="flex-shrink-0 flex items-center gap-2">
                  {status === 'checking' && (
                    <div className="w-4 h-4 rounded-full border-2 border-[#007AFF] border-t-transparent animate-spin" />
                  )}
                  {status === 'ok' && (
                    <div className="w-4 h-4 rounded-full bg-[#34C759]" />
                  )}
                  {status === 'error' && (
                    <div className="w-4 h-4 rounded-full bg-[#FF3B30]" />
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleTestServer(server.url)}
                    disabled={testingServer === server.url}
                    className="
                      px-2.5 py-1.5 rounded-[8px] text-[12px] font-medium
                      border border-[rgb(var(--color-fill)/0.18)]
                      bg-[rgb(var(--color-bg))]
                      text-[#007AFF] transition-opacity active:opacity-70
                      disabled:opacity-40
                    "
                  >
                    {testingServer === server.url ? 'Testing…' : 'Test'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRemoveServer(server.url)}
                    className="
                      px-2.5 py-1.5 rounded-[8px] text-[12px] font-medium
                      border border-[#FF3B30]/30
                      bg-[#FF3B30]/10
                      text-[#FF3B30] transition-opacity active:opacity-70
                    "
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Info */}
      <div className="rounded-[12px] bg-[rgb(var(--color-fill)/0.06)] p-3">
        <p className="text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
          Media servers store your uploads and generate shareable URLs. Nostr Paper uses{' '}
          <a
            href="https://blossom-spec.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#007AFF] underline"
          >
            Blossom
          </a>
          , the content-addressed media protocol for Nostr.
        </p>
      </div>
    </div>
  )
}
