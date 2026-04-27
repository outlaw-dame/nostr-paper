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
import { getBlossomServers, addBlossomServer, removeBlossomServer } from '@/lib/db/blossom'
import { getNDK } from '@/lib/nostr/ndk'
import { createNIP98Auth } from '@/lib/blossom/auth'
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

      // Validate URL format
      let url = newUrl.trim()
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`
      }
      new URL(url) // Validate URL throws if invalid

      // Verify server is accessible
      await testServerConnectivity(url)

      // Add to database
      await addBlossomServer(url)
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

      const serverUrl = url.replace(/\/+$/, '')
      
      let ndk: ReturnType<typeof getNDK> | null = null
      try {
        ndk = getNDK()
      } catch {
        // NDK might not be initialized, continue with unauthenticated requests
      }

      // Try to create an auth token and make a test HEAD request
      if (ndk) {
        try {
          const auth = await createNIP98Auth(ndk, {
            url: `${serverUrl}/info`,
            method: 'GET',
          })

          const response = await fetch(`${serverUrl}/info`, {
            method: 'GET',
            headers: {
              Authorization: auth,
            },
          })

          if (response.ok) {
            setServerStatuses((prev) => ({ ...prev, [url]: 'ok' }))
            return true
          } else {
            throw new Error(`HTTP ${response.status}`)
          }
        } catch (authErr) {
          // If auth fails, try without auth as a fallback
          console.debug('[BlossomServerManager] Auth failed, trying unauthenticated:', authErr)
        }
      }

      // Try without authentication
      const infoResponse = await fetch(`${serverUrl}/info`)
      if (infoResponse.ok) {
        setServerStatuses((prev) => ({ ...prev, [url]: 'ok' }))
        return true
      }
      throw new Error(`Server replied with HTTP ${infoResponse.status}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      setServerStatuses((prev) => ({ ...prev, [url]: 'error' }))
      throw new Error(`Server unreachable: ${message}`)
    }
  }

  const handleTestServer = async (url: string) => {
    try {
      setError(null)
      await testServerConnectivity(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test failed'
      setError(message)
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
            Blossom (NIP-B7)
          </a>
          , the standard media protocol for Nostr.
        </p>
      </div>
    </div>
  )
}
