/**
 * SettingsPage
 *
 * Blossom Media Server management (BUD-03):
 * - List configured servers with live reachability probe
 * - Add a new server by URL (validated + probed)
 * - Remove servers
 * - Sync server list from relays (fetches the user's kind-10063 event)
 * - Publish current list back to relays
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Page, Navbar, Block, BlockTitle, List, ListItem, Button } from 'konsta/react'
import { motion, AnimatePresence } from 'motion/react'
import { BlossomUpload } from '@/components/blossom/BlossomUpload'
import { UserStatusBody } from '@/components/nostr/UserStatusBody'
import { TranslationSettingsCard } from '@/components/translation/TranslationSettingsCard'
import { useApp } from '@/contexts/app-context'
import { useBlossomMediaLibrary } from '@/hooks/useBlossom'
import { useUserStatus } from '@/hooks/useUserStatus'
import {
  getBlossomServers,
  addBlossomServer,
  removeBlossomServer,
  reorderBlossomServers,
} from '@/lib/db/blossom'
import {
  syncServerListFromRelays,
  publishServerList,
} from '@/lib/blossom/serverList'
import {
  getNostrPaperHandlerOrigin,
  isClientTagPublishingEnabled,
  publishNostrPaperHandlerInformation,
  publishNostrPaperHandlerRecommendations,
  setClientTagPublishingEnabled,
} from '@/lib/nostr/appHandlers'
import { blossomProbe }        from '@/lib/blossom/client'
import { isValidBlossomUrl }   from '@/lib/blossom/validate'
import { getCurrentUser }      from '@/lib/nostr/ndk'
import { clearMusicStatus, publishMusicStatus } from '@/lib/nostr/status'
import type { BlossomBlob, BlossomServer }  from '@/types'

// ── Types ─────────────────────────────────────────────────────

type ServerStatus = 'unknown' | 'probing' | 'online' | 'offline'

interface ServerEntry extends BlossomServer {
  status: ServerStatus
}

function formatDateTimeLocalInput(timestamp: number | undefined): string {
  if (!timestamp) return ''

  const date = new Date(timestamp * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function parseDateTimeLocalInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new Error('Track end time must be a valid local date and time.')
  }

  const seconds = Math.floor(parsed / 1000)
  if (!Number.isSafeInteger(seconds)) {
    throw new Error('Track end time is outside the supported range.')
  }

  return seconds
}

// ── Main Page ─────────────────────────────────────────────────

export default function SettingsPage() {
  const { currentUser } = useApp()
  const handlerOrigin = getNostrPaperHandlerOrigin()
  const [servers,   setServers]   = useState<ServerEntry[]>([])
  const [loading,   setLoading]   = useState(true)
  const [syncing,   setSyncing]   = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [addUrl,    setAddUrl]    = useState('')
  const [addError,  setAddError]  = useState('')
  const [adding,    setAdding]    = useState(false)
  const [clientTagEnabled, setClientTagEnabledState] = useState(() => isClientTagPublishingEnabled())
  const [publishingHandlerInfo, setPublishingHandlerInfo] = useState(false)
  const [publishingRecommendations, setPublishingRecommendations] = useState(false)
  const [nip89Message, setNip89Message] = useState('')
  const [nip89Error, setNip89Error] = useState('')
  const {
    status: musicStatus,
    loading: musicStatusLoading,
  } = useUserStatus(currentUser?.pubkey, {
    identifier: 'music',
    background: true,
  })
  const seededMusicStatusIdRef = useRef<string | null>(null)
  const [musicStatusContent, setMusicStatusContent] = useState('')
  const [musicStatusReference, setMusicStatusReference] = useState('')
  const [musicStatusEndsAt, setMusicStatusEndsAt] = useState('')
  const [publishingMusicStatus, setPublishingMusicStatus] = useState(false)
  const [clearingMusicStatus, setClearingMusicStatus] = useState(false)
  const [musicStatusMessage, setMusicStatusMessage] = useState('')
  const [musicStatusError, setMusicStatusError] = useState('')
  const { blobs, loading: libraryLoading, refresh: refreshLibrary } = useBlossomMediaLibrary()

  // Load servers from DB
  const reload = useCallback(async () => {
    const rows = await getBlossomServers()
    setServers(rows.map(s => ({ ...s, status: 'unknown' })))
    setLoading(false)
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    const nextSeedId = musicStatus?.id ?? '__none__'
    if (seededMusicStatusIdRef.current === nextSeedId) return

    seededMusicStatusIdRef.current = nextSeedId
    setMusicStatusContent(musicStatus?.content ?? '')
    setMusicStatusReference(
      musicStatus?.referenceUri
      ?? musicStatus?.targetAddress
      ?? musicStatus?.targetEventId
      ?? musicStatus?.targetPubkey
      ?? '',
    )
    setMusicStatusEndsAt(formatDateTimeLocalInput(musicStatus?.expiresAt))
  }, [musicStatus])

  // Probe reachability for all servers
  useEffect(() => {
    if (servers.length === 0) return
    void probeAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.length])

  const probeAll = useCallback(async () => {
    setServers(prev => prev.map(s => ({ ...s, status: 'probing' })))
    const results = await Promise.all(
      servers.map(async s => ({ url: s.url, online: await blossomProbe(s.url) }))
    )
    setServers(prev =>
      prev.map(s => {
        const r = results.find(r => r.url === s.url)
        return { ...s, status: r?.online ? 'online' : 'offline' }
      })
    )
  }, [servers])

  // Add a new server
  const handleAdd = useCallback(async () => {
    const url = addUrl.trim().replace(/\/+$/, '')
    if (!url) { setAddError('Enter a server URL'); return }
    if (!isValidBlossomUrl(url)) {
      setAddError('URL must start with https://')
      return
    }
    if (servers.some(s => s.url === url)) {
      setAddError('Server already in list')
      return
    }

    setAdding(true)
    setAddError('')
    try {
      await addBlossomServer(url)
      setAddUrl('')
      await reload()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add server')
    } finally {
      setAdding(false)
    }
  }, [addUrl, servers, reload])

  // Remove a server
  const handleRemove = useCallback(async (url: string) => {
    await removeBlossomServer(url)
    await reload()
  }, [reload])

  // Sync from relays
  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      const user  = await getCurrentUser()
      if (!user) { alert('Not signed in — cannot sync from relays.'); return }
      const added = await syncServerListFromRelays(user.pubkey)
      await reload()
      if (added === 0) {
        alert('No new servers found on relays.')
      } else {
        alert(`Added ${added} server${added !== 1 ? 's' : ''} from your relay list.`)
      }
    } catch (err) {
      alert(`Sync failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSyncing(false)
    }
  }, [reload])

  // Publish to relays
  const handlePublish = useCallback(async () => {
    setPublishing(true)
    try {
      await publishServerList()
      alert('Server list published to relays.')
    } catch (err) {
      alert(`Publish failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPublishing(false)
    }
  }, [])

  const handleClientTagToggle = useCallback((enabled: boolean) => {
    setClientTagPublishingEnabled(enabled)
    setClientTagEnabledState(enabled)
  }, [])

  const handlePublishHandlerInfo = useCallback(async () => {
    setPublishingHandlerInfo(true)
    setNip89Message('')
    setNip89Error('')

    try {
      await publishNostrPaperHandlerInformation()
      setNip89Message('Kind-31990 handler information published for this client.')
    } catch (error) {
      setNip89Error(error instanceof Error ? error.message : 'Failed to publish kind-31990 handler information.')
    } finally {
      setPublishingHandlerInfo(false)
    }
  }, [])

  const handlePublishRecommendations = useCallback(async () => {
    setPublishingRecommendations(true)
    setNip89Message('')
    setNip89Error('')

    try {
      const published = await publishNostrPaperHandlerRecommendations()
      setNip89Message(`Published ${published.length} kind-31989 recommendation event${published.length === 1 ? '' : 's'} for this client.`)
    } catch (error) {
      setNip89Error(error instanceof Error ? error.message : 'Failed to publish kind-31989 recommendations.')
    } finally {
      setPublishingRecommendations(false)
    }
  }, [])

  const handlePublishMusicStatus = useCallback(async () => {
    setPublishingMusicStatus(true)
    setMusicStatusMessage('')
    setMusicStatusError('')

    try {
      const expiresAt = parseDateTimeLocalInput(musicStatusEndsAt)
      await publishMusicStatus({
        content: musicStatusContent,
        reference: musicStatusReference.trim() || null,
        expiresAt,
      })
      setMusicStatusMessage('Kind-30315 music status published to relays.')
    } catch (error) {
      setMusicStatusError(error instanceof Error ? error.message : 'Failed to publish kind-30315 music status.')
    } finally {
      setPublishingMusicStatus(false)
    }
  }, [musicStatusContent, musicStatusEndsAt, musicStatusReference])

  const handleClearMusicStatus = useCallback(async () => {
    setClearingMusicStatus(true)
    setMusicStatusMessage('')
    setMusicStatusError('')

    try {
      await clearMusicStatus()
      setMusicStatusMessage('Kind-30315 music status cleared.')
      setMusicStatusContent('')
      setMusicStatusReference('')
      setMusicStatusEndsAt('')
    } catch (error) {
      setMusicStatusError(error instanceof Error ? error.message : 'Failed to clear kind-30315 music status.')
    } finally {
      setClearingMusicStatus(false)
    }
  }, [])

  return (
    <Page>
      <Navbar title="Settings" />

      {currentUser && (
        <>
          <BlockTitle>Profile</BlockTitle>
          <Block>
            <Link
              to={`/profile/${currentUser.pubkey}`}
              className="
                block rounded-[20px] border border-[rgb(var(--color-fill)/0.16)]
                bg-[rgb(var(--color-bg-secondary))] p-4
              "
            >
              <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                Edit Kind-0 Profile Metadata
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
                Update your published name, avatar, banner, website, lightning fields, and other profile metadata.
              </p>
            </Link>
            <Link
              to="/dvm/new"
              className="
                mt-3 block rounded-[20px] border border-[rgb(var(--color-fill)/0.16)]
                bg-[rgb(var(--color-bg-secondary))] p-4
              "
            >
              <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                Publish NIP-90 DVM Request
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
                Publish a generic kind-5000 to kind-5999 job request with structured `i`, `param`, `output`, `relays`, and optional encrypted private inputs.
              </p>
            </Link>
            <Link
              to="/video/new"
              className="
                mt-3 block rounded-[20px] border border-[rgb(var(--color-fill)/0.16)]
                bg-[rgb(var(--color-bg-secondary))] p-4
              "
            >
              <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                Publish NIP-71 Video
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
                Publish regular or addressable video events with inline `imeta` variants, segments, tracks, and origin metadata.
              </p>
            </Link>
            <Link
              to="/poll/new"
              className="
                mt-3 block rounded-[20px] border border-[rgb(var(--color-fill)/0.16)]
                bg-[rgb(var(--color-bg-secondary))] p-4
              "
            >
              <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                Publish NIP-88 Poll
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
                Publish a kind-1068 poll with explicit vote relays, structured options, and optional closing time.
              </p>
            </Link>
            <Link
              to="/list/new"
              className="
                mt-3 block rounded-[20px] border border-[rgb(var(--color-fill)/0.16)]
                bg-[rgb(var(--color-bg-secondary))] p-4
              "
            >
              <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                Publish NIP-51 List
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
                Publish a standard list or addressable set with public tag items and optional encrypted private items in event content.
              </p>
            </Link>

            <div
              id="music-status"
              className="
                mt-3 rounded-[20px] border border-[rgb(var(--color-fill)/0.16)]
                bg-[rgb(var(--color-bg-secondary))] p-4
              "
            >
              <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                Publish NIP-38 Music Status
              </p>
              <p className="mt-1 text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
                Publish a live kind-30315 `d=&quot;music&quot;` status for the track you are listening to. Use an `r` tag for streaming URIs like Spotify, or a NIP-21 / event / address reference for Nostr-hosted media.
              </p>

              {musicStatus ? (
                <UserStatusBody event={musicStatus.event} className="mt-4" linkedPreview={false} />
              ) : (
                <p className="mt-4 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                  {musicStatusLoading ? 'Loading current music status…' : 'No active music status.'}
                </p>
              )}

              <label className="mt-4 block">
                <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
                  Track
                </span>
                <input
                  type="text"
                  value={musicStatusContent}
                  onChange={(event) => setMusicStatusContent(event.target.value)}
                  placeholder="Intergalactic - Beastie Boys"
                  maxLength={280}
                  className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[14px] text-[rgb(var(--color-label))] outline-none"
                />
              </label>

              <label className="mt-3 block">
                <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
                  Streaming URI or Nostr reference
                </span>
                <input
                  type="text"
                  value={musicStatusReference}
                  onChange={(event) => setMusicStatusReference(event.target.value)}
                  placeholder="spotify:track:... or nostr:nevent1..."
                  className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[14px] text-[rgb(var(--color-label))] outline-none"
                />
              </label>

              <label className="mt-3 block">
                <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
                  Track end time
                </span>
                <input
                  type="datetime-local"
                  value={musicStatusEndsAt}
                  onChange={(event) => setMusicStatusEndsAt(event.target.value)}
                  className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[14px] text-[rgb(var(--color-label))] outline-none"
                />
                <p className="mt-2 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
                  For `d=&quot;music&quot;`, NIP-38 recommends expiring the status when the track stops playing.
                </p>
              </label>

              {musicStatusMessage && (
                <p className="mt-4 text-[13px] text-[rgb(var(--color-system-green))]">
                  {musicStatusMessage}
                </p>
              )}

              {musicStatusError && (
                <p className="mt-4 text-[13px] text-[rgb(var(--color-system-red))]">
                  {musicStatusError}
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handlePublishMusicStatus()}
                  disabled={publishingMusicStatus || clearingMusicStatus}
                  className="
                    flex-1 rounded-[14px] bg-[rgb(var(--color-label))]
                    px-4 py-2.5 text-[14px] font-medium text-white
                    transition-opacity active:opacity-75 disabled:opacity-40
                  "
                >
                  {publishingMusicStatus ? 'Publishing…' : 'Publish Kind 30315'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleClearMusicStatus()}
                  disabled={clearingMusicStatus || publishingMusicStatus}
                  className="
                    flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.2)]
                    bg-[rgb(var(--color-bg))] px-4 py-2.5
                    text-[14px] font-medium text-[rgb(var(--color-label))]
                    transition-opacity active:opacity-75 disabled:opacity-40
                  "
                >
                  {clearingMusicStatus ? 'Clearing…' : 'Clear Status'}
                </button>
              </div>
            </div>
          </Block>

          <BlockTitle>NIP-89</BlockTitle>
          <Block>
            <div className="rounded-[20px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] p-4">
              <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                Recommended Application Handlers
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
                Publish a kind-31990 handler event for this web client and optional kind-31989 recommendations for the kinds it actually handles.
              </p>

              <label className="mt-4 flex items-start gap-3 rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3">
                <input
                  type="checkbox"
                  checked={clientTagEnabled}
                  onChange={(event) => handleClientTagToggle(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-[rgb(var(--color-fill)/0.24)]"
                />
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-[rgb(var(--color-label))]">
                    Include NIP-89 `client` tags on published events
                  </span>
                  <span className="mt-1 block text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                    This is optional metadata with privacy implications. Tags are only added after you publish a matching kind-31990 handler event.
                  </span>
                </span>
              </label>

              <div className="mt-4 rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3">
                <p className="text-[13px] font-medium text-[rgb(var(--color-label))]">
                  Publishable web origin
                </p>
                <p className="mt-1 break-all text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                  {handlerOrigin.origin ?? 'Not configured'}
                </p>
                {!handlerOrigin.publishable && (
                  <p className="mt-2 text-[13px] leading-6 text-[rgb(var(--color-system-red))]">
                    Publishing is disabled until the app has a public HTTPS origin. Set `VITE_PUBLIC_APP_ORIGIN` when building for production instead of publishing localhost URLs.
                  </p>
                )}
              </div>

              {nip89Message && (
                <p className="mt-4 text-[13px] text-[rgb(var(--color-system-green))]">
                  {nip89Message}
                </p>
              )}

              {nip89Error && (
                <p className="mt-4 text-[13px] text-[rgb(var(--color-system-red))]">
                  {nip89Error}
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handlePublishHandlerInfo()}
                  disabled={!handlerOrigin.publishable || publishingHandlerInfo || publishingRecommendations}
                  className="
                    flex-1 rounded-[14px] bg-[rgb(var(--color-label))]
                    px-4 py-2.5 text-[14px] font-medium text-white
                    transition-opacity active:opacity-75 disabled:opacity-40
                  "
                >
                  {publishingHandlerInfo ? 'Publishing…' : 'Publish Kind 31990'}
                </button>
                <button
                  type="button"
                  onClick={() => void handlePublishRecommendations()}
                  disabled={!handlerOrigin.publishable || publishingRecommendations || publishingHandlerInfo}
                  className="
                    flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.2)]
                    bg-[rgb(var(--color-bg))] px-4 py-2.5
                    text-[14px] font-medium text-[rgb(var(--color-label))]
                    transition-opacity active:opacity-75 disabled:opacity-40
                  "
                >
                  {publishingRecommendations ? 'Publishing…' : 'Publish Kind 31989'}
                </button>
              </div>
            </div>
          </Block>
        </>
      )}

      <BlockTitle>Content Filters</BlockTitle>
      <Block>
        <Link
          to="/filters"
          className="
            block rounded-[20px] border border-[rgb(var(--color-fill)/0.16)]
            bg-[rgb(var(--color-bg-secondary))] p-4
          "
        >
          <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
            Keyword &amp; Semantic Filters
          </p>
          <p className="mt-1 text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
            Hide or warn on posts matching words, phrases, hashtags, or related concepts — including author names and bios.
          </p>
        </Link>
      </Block>

      <BlockTitle>Translation</BlockTitle>
      <Block>
        <TranslationSettingsCard />
      </Block>

      {/* ── Media Servers ───────────────────────────────── */}
      <BlockTitle>Blossom Media Servers</BlockTitle>

      <Block>
        <p className="text-[14px] text-[rgb(var(--color-label-secondary))] leading-relaxed mb-4">
          Blossom servers store your media (images, video, audio) on Nostr.
          Files are identified by their SHA-256 hash and replicated across
          all servers you configure.
        </p>

        {/* Relay sync + publish actions */}
        <div className="flex gap-2 mb-4">
          <button
            disabled={syncing}
            onClick={handleSync}
            className="
              flex-1 py-2.5 rounded-[14px]
              bg-[rgb(var(--color-bg-secondary))]
              border border-[rgb(var(--color-fill)/0.2)]
              text-[14px] font-medium text-[rgb(var(--color-label))]
              active:opacity-70 transition-opacity disabled:opacity-40
            "
          >
            {syncing ? 'Syncing…' : 'Sync from Relays'}
          </button>
          <button
            disabled={publishing || servers.length === 0}
            onClick={handlePublish}
            className="
              flex-1 py-2.5 rounded-[14px]
              bg-[rgb(var(--color-bg-secondary))]
              border border-[rgb(var(--color-fill)/0.2)]
              text-[14px] font-medium text-[rgb(var(--color-label))]
              active:opacity-70 transition-opacity disabled:opacity-40
            "
          >
            {publishing ? 'Publishing…' : 'Publish to Relays'}
          </button>
        </div>

        {/* Server list */}
        {loading ? (
          <p className="text-[14px] text-[rgb(var(--color-label-tertiary))] py-4 text-center">
            Loading…
          </p>
        ) : servers.length === 0 ? (
          <div className="
            rounded-2xl border border-dashed border-[rgb(var(--color-fill)/0.3)]
            py-8 text-center
          ">
            <p className="text-[15px] text-[rgb(var(--color-label-secondary))]">
              No media servers configured
            </p>
            <p className="text-[13px] text-[rgb(var(--color-label-tertiary))] mt-1">
              Add a Blossom server below
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {servers.map((server, idx) => (
                <motion.div
                  key={server.url}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{    opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.2 }}
                  className="
                    flex items-center gap-3 px-4 py-3
                    bg-[rgb(var(--color-bg-secondary))]
                    rounded-2xl border border-[rgb(var(--color-fill)/0.1)]
                  "
                >
                  {/* Priority badge */}
                  <span className="
                    w-6 h-6 rounded-full bg-[rgb(var(--color-fill)/0.12)]
                    text-[11px] font-mono text-[rgb(var(--color-label-tertiary))]
                    flex items-center justify-center shrink-0
                  ">
                    {idx + 1}
                  </span>

                  {/* Server URL */}
                  <div className="flex-1 min-w-0">
                    <p className="
                      text-[14px] font-medium text-[rgb(var(--color-label))]
                      truncate
                    ">
                      {server.url.replace('https://', '')}
                    </p>
                    <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                      Added {new Date(server.addedAt * 1000).toLocaleDateString()}
                    </p>
                  </div>

                  {/* Status dot */}
                  <StatusDot status={server.status} />

                  {/* Remove */}
                  <button
                    onClick={() => void handleRemove(server.url)}
                    className="
                      w-7 h-7 rounded-full bg-[rgb(var(--color-fill)/0.1)]
                      flex items-center justify-center shrink-0
                      active:opacity-70 transition-opacity
                    "
                    aria-label={`Remove ${server.url}`}
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                      <path d="M2 2l7 7M9 2L2 9" stroke="#FF3B30" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Add server form */}
        <div className="mt-4">
          <p className="text-[13px] font-medium text-[rgb(var(--color-label-secondary))] mb-2">
            Add Server
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              inputMode="url"
              placeholder="https://blossom.example.com"
              value={addUrl}
              onChange={e => { setAddUrl(e.target.value); setAddError('') }}
              onKeyDown={e => { if (e.key === 'Enter') void handleAdd() }}
              className="
                flex-1 px-4 py-2.5 rounded-[14px]
                bg-[rgb(var(--color-bg-secondary))]
                border border-[rgb(var(--color-fill)/0.2)]
                text-[14px] text-[rgb(var(--color-label))]
                placeholder:text-[rgb(var(--color-label-tertiary))]
                outline-none focus:border-[#007AFF]
                transition-colors
              "
            />
            <button
              onClick={() => void handleAdd()}
              disabled={adding || !addUrl.trim()}
              className="
                px-4 py-2.5 rounded-[14px]
                bg-[#007AFF] text-white text-[14px] font-semibold
                active:opacity-80 transition-opacity disabled:opacity-40
              "
            >
              {adding ? '…' : 'Add'}
            </button>
          </div>
          {addError && (
            <p className="mt-1.5 text-[12px] text-[#FF3B30]">{addError}</p>
          )}
        </div>

        {/* Known public servers */}
        <KnownServers onAdd={url => { setAddUrl(url); setAddError('') }} />
      </Block>

      <BlockTitle>Uploads & File Metadata</BlockTitle>

      <Block>
        <p className="text-[14px] text-[rgb(var(--color-label-secondary))] leading-relaxed mb-4">
          Uploading here stores the file on your configured Blossom servers and publishes a
          kind-1063 NIP-94 file metadata event to your write relays.
        </p>

        <BlossomUpload onUploaded={() => { void refreshLibrary() }} />

        <div className="mt-5">
          <p className="text-[13px] font-medium text-[rgb(var(--color-label-secondary))] mb-2">
            Recent Local Uploads
          </p>

          {libraryLoading ? (
            <p className="text-[13px] text-[rgb(var(--color-label-tertiary))]">
              Loading uploads…
            </p>
          ) : blobs.length === 0 ? (
            <p className="text-[13px] text-[rgb(var(--color-label-tertiary))]">
              No cached uploads yet.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {blobs.slice(0, 8).map(blob => (
                <UploadedBlobRow key={blob.sha256} blob={blob} />
              ))}
            </div>
          )}
        </div>
      </Block>
    </Page>
  )
}

// ── StatusDot ─────────────────────────────────────────────────

function StatusDot({ status }: { status: ServerStatus }) {
  const colors: Record<ServerStatus, string> = {
    unknown:  'bg-[rgb(var(--color-fill)/0.3)]',
    probing:  'bg-[#FF9F0A]',
    online:   'bg-[#34C759]',
    offline:  'bg-[#FF3B30]',
  }
  const labels: Record<ServerStatus, string> = {
    unknown:  'Unknown',
    probing:  'Checking…',
    online:   'Online',
    offline:  'Unreachable',
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0" title={labels[status]}>
      <span
        className={`w-2 h-2 rounded-full ${colors[status]} ${status === 'probing' ? 'animate-pulse' : ''}`}
      />
      <span className="text-[11px] text-[rgb(var(--color-label-tertiary))]">
        {labels[status]}
      </span>
    </div>
  )
}

// ── Known public servers ──────────────────────────────────────

const PUBLIC_SERVERS = [
  { url: 'https://blossom.primal.net',   label: 'Primal'    },
  { url: 'https://blossom.nostr.hu',     label: 'nostr.hu'  },
  { url: 'https://cdn.satellite.earth',  label: 'Satellite' },
  { url: 'https://blossom.band',         label: 'Band'      },
]

function KnownServers({ onAdd }: { onAdd: (url: string) => void }) {
  return (
    <div className="mt-5">
      <p className="text-[13px] font-medium text-[rgb(var(--color-label-secondary))] mb-2">
        Known Public Servers
      </p>
      <div className="flex flex-wrap gap-2">
        {PUBLIC_SERVERS.map(({ url, label }) => (
          <button
            key={url}
            onClick={() => onAdd(url)}
            className="
              px-3 py-1.5 rounded-full
              bg-[rgb(var(--color-fill)/0.08)]
              border border-[rgb(var(--color-fill)/0.15)]
              text-[13px] text-[rgb(var(--color-label-secondary))]
              active:opacity-70 transition-opacity
            "
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function UploadedBlobRow({ blob }: { blob: BlossomBlob }) {
  const isImage = blob.type.startsWith('image/')
  const isVideo = blob.type.startsWith('video/')
  const sizeLabel = formatByteSize(blob.size)

  return (
    <div
      className="
        flex items-center gap-3 px-3 py-3
        rounded-2xl bg-[rgb(var(--color-bg-secondary))]
        border border-[rgb(var(--color-fill)/0.1)]
      "
    >
      <div className="w-16 h-16 shrink-0 overflow-hidden rounded-[16px] bg-[rgb(var(--color-fill)/0.08)] flex items-center justify-center">
        {isImage ? (
          <img
            src={blob.nip94?.thumb ?? blob.nip94?.image ?? blob.url}
            alt={blob.nip94?.alt ?? ''}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        ) : isVideo ? (
          <video
            src={blob.url}
            preload="metadata"
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-[11px] font-semibold uppercase text-[rgb(var(--color-label-tertiary))]">
            {blob.type.split('/')[0] ?? 'file'}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[14px] font-medium text-[rgb(var(--color-label))]">
            {blob.nip94?.alt ?? blob.nip94?.summary ?? blob.sha256.slice(0, 12)}
          </p>
          {blob.metadataEventId && (
            <span className="rounded-full bg-[#34C759]/10 px-2 py-0.5 text-[11px] font-medium text-[#34C759]">
              kind 1063 published
            </span>
          )}
        </div>

        <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))]">
          {blob.type} · {sizeLabel}
          {blob.nip94?.dim ? ` · ${blob.nip94.dim}` : ''}
        </p>

        <a
          href={blob.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-1 inline-block text-[12px] text-[#007AFF]"
        >
          Open file
        </a>
        {blob.metadataEventId && (
          <Link
            to={`/note/${blob.metadataEventId}`}
            className="mt-1 ml-3 inline-block text-[12px] text-[rgb(var(--color-label-secondary))]"
          >
            View metadata
          </Link>
        )}
      </div>
    </div>
  )
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
