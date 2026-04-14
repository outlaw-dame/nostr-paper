/**
 * RelaysPage
 *
 * Relay management: view, add, and remove WebSocket relays with
 * live connection-status indicators for each relay in the NDK pool.
 *
 * Inspired by Damus relay management, improved with:
 * - Real-time animated status dots (connected / connecting / flapping / offline)
 * - Human-readable hostname labels with full URL below
 * - Connected-count summary in the header
 * - Inline add + validation feedback
 * - Reset-to-defaults escape hatch
 * - Graceful handling of NDK not-yet-initialised
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NDKRelayStatus } from '@nostr-dev-kit/ndk'
import { useApp } from '@/contexts/app-context'
import { getRelayHealthSnapshot, type RelayHealthSnapshot } from '@/lib/nostr/relayHealth'
import { importCurrentUserRelayListPreferences } from '@/lib/nostr/relayList'
import { isRemoteImportEnabled } from '@/pages/relaysPageLogic'
import {
  addRelayToPool,
  canRetryRelayConnection,
  getDefaultRelayUrls,
  getNDK,
  removeRelayFromPool,
  retryRelayConnection,
} from '@/lib/nostr/ndk'
import {
  RELAY_SETTINGS_UPDATED_EVENT,
  clearStoredRelayUrls,
  getStoredRelayPreferences,
  setStoredRelayPreferences,
  type RelayPreference,
} from '@/lib/relay/relaySettings'
import { isValidRelayURL } from '@/lib/security/sanitize'

// ── Types ────────────────────────────────────────────────────

interface RelayEntry {
  url: string
  read: boolean
  write: boolean
  status: NDKRelayStatus
}

const RECOMMENDED_FAST_READ_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
] as const

const RECOMMENDED_RELIABLE_WRITE_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
] as const

const CURATED_RELAY_RECOMMENDATIONS = [
  {
    url: 'wss://purplepag.es',
    reason: 'Useful for kind-10002 discovery and outbox lookup coverage.',
  },
  {
    url: 'wss://nos.lol',
    reason: 'Widely used public relay with good client interoperability.',
  },
  {
    url: 'wss://relay.primal.net',
    reason: 'High-traffic relay often used for fast read/write propagation.',
  },
  {
    url: 'wss://relay.nostr.band',
    reason: 'Popular indexing relay that improves broad discoverability.',
  },
] as const

// ── Status helpers ───────────────────────────────────────────

function getDefaultRelayPreferences(): RelayPreference[] {
  return getDefaultRelayUrls().map(url => ({ url, read: true, write: true }))
}

function getConfiguredRelayPreferences(): RelayPreference[] {
  return getStoredRelayPreferences() ?? getDefaultRelayPreferences()
}

function normalizeRelayKey(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.pathname === '/') parsed.pathname = ''
    return parsed.toString()
  } catch {
    return url.replace(/\/+$/g, '')
  }
}

function getRelayEntries(preferences: readonly RelayPreference[] = getConfiguredRelayPreferences()): RelayEntry[] {
  try {
    const ndk = getNDK()
    const poolEntries = new Map<string, NDKRelayStatus>()

    for (const [url, relay] of ndk.pool.relays.entries()) {
      const status = relay.status ?? NDKRelayStatus.DISCONNECTED
      poolEntries.set(url, status)
      poolEntries.set(normalizeRelayKey(url), status)
    }

    return preferences.map(preference => ({
      ...preference,
      status: poolEntries.get(preference.url)
        ?? poolEntries.get(normalizeRelayKey(preference.url))
        ?? NDKRelayStatus.DISCONNECTED,
    }))
  } catch {
    // NDK not yet initialised — return configured relays as disconnected.
    return preferences.map(preference => ({
      ...preference,
      status: NDKRelayStatus.DISCONNECTED,
    }))
  }
}

type StatusMeta = {
  label: string
  color: string
  pulse: boolean
}

function statusMeta(status: NDKRelayStatus): StatusMeta {
  switch (status) {
    case NDKRelayStatus.CONNECTED:
    case NDKRelayStatus.AUTHENTICATED:
      return { label: 'Connected', color: 'rgb(var(--color-system-green))', pulse: true }
    case NDKRelayStatus.AUTH_REQUESTED:
    case NDKRelayStatus.AUTHENTICATING:
      return { label: 'Authenticating', color: 'rgb(var(--color-system-yellow, 255 204 0))', pulse: true }
    case NDKRelayStatus.CONNECTING:
    case NDKRelayStatus.RECONNECTING:
      return { label: 'Connecting', color: 'rgb(var(--color-system-yellow, 255 204 0))', pulse: true }
    case NDKRelayStatus.FLAPPING:
      return { label: 'Unstable', color: 'rgb(var(--color-system-orange, 255 149 0))', pulse: false }
    default:
      return { label: 'Offline', color: 'rgb(var(--color-fill-secondary, 142 142 147))', pulse: false }
  }
}

function isConnected(status: NDKRelayStatus): boolean {
  return (
    status === NDKRelayStatus.CONNECTED ||
    status === NDKRelayStatus.AUTHENTICATED ||
    status === NDKRelayStatus.AUTH_REQUESTED ||
    status === NDKRelayStatus.AUTHENTICATING
  )
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function relayCapabilitySummary(entry: Pick<RelayEntry, 'read' | 'write'>): string {
  if (entry.read && entry.write) return 'Read and write'
  return entry.read ? 'Read only' : 'Write only'
}

function isRecommendedReadRelay(url: string): boolean {
  return RECOMMENDED_FAST_READ_RELAYS.includes(url as typeof RECOMMENDED_FAST_READ_RELAYS[number])
}

function isRecommendedWriteRelay(url: string): boolean {
  return RECOMMENDED_RELIABLE_WRITE_RELAYS.includes(url as typeof RECOMMENDED_RELIABLE_WRITE_RELAYS[number])
}

function healthBadgeClass(tier: RelayHealthSnapshot['tier']): string {
  switch (tier) {
    case 'good':
      return 'rounded-full bg-[rgb(var(--color-system-green)/0.12)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[rgb(var(--color-system-green))]'
    case 'caution':
      return 'rounded-full bg-[rgb(var(--color-system-orange,255_149_0)/0.12)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[rgb(var(--color-system-orange,255_149_0))]'
    case 'restricted':
      return 'rounded-full bg-[rgb(var(--color-system-red)/0.12)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[rgb(var(--color-system-red))]'
    default:
      return 'rounded-full bg-[rgb(var(--color-fill)/0.1)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[rgb(var(--color-label-tertiary))]'
  }
}

function RelayCapabilityButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={[
        'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors active:opacity-80',
        active
          ? 'border-[rgb(var(--color-accent)/0.35)] bg-[rgb(var(--color-accent)/0.12)] text-[rgb(var(--color-accent))]'
          : 'border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label-secondary))]',
        disabled ? 'cursor-not-allowed opacity-40' : '',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

// ── Sub-components ───────────────────────────────────────────

function StatusDot({ status }: { status: NDKRelayStatus }) {
  const { color, pulse } = statusMeta(status)
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {pulse && (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className="relative inline-flex h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  )
}

function RelayRow({
  entry,
  isDefault,
  health,
  retryAvailable,
  retrying,
  onRetry,
  onToggleCapability,
  onRemove,
}: {
  entry: RelayEntry
  isDefault: boolean
  health: RelayHealthSnapshot | undefined
  retryAvailable: boolean
  retrying: boolean
  onRetry: (url: string) => void
  onToggleCapability: (url: string, capability: 'read' | 'write') => void
  onRemove: (url: string) => void
}) {
  const { label } = statusMeta(entry.status)
  const hostname = hostnameOf(entry.url)
  const connected = isConnected(entry.status)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const disableReadToggle = entry.read && !entry.write
  const disableWriteToggle = entry.write && !entry.read
  const showRetry = entry.read && !connected && retryAvailable
  const offlineHint = !connected
    ? health?.tier === 'restricted'
      ? 'This relay is reachable but may require auth or payment; offline state may be expected for unauthenticated reads.'
      : health?.tier === 'good' || health?.tier === 'caution'
        ? 'Relay metadata looks healthy; current offline state is likely a temporary network path or remote relay outage.'
        : 'Health is unknown; offline state is usually due to remote relay downtime, regional routing, or transient handshake failures.'
    : null

  return (
    <div className="flex gap-3 py-3">
      {/* Status dot */}
      <div className="flex w-5 items-start justify-center pt-1.5">
        <StatusDot status={entry.status} />
      </div>

      {/* Relay info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium text-[rgb(var(--color-label))]">
              {hostname}
            </p>
            <p className="mt-0.5 truncate text-[12px] font-mono text-[rgb(var(--color-label-tertiary))]">
              {entry.url}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span
                className="text-[12px] font-medium"
                style={{
                  color: connected
                    ? 'rgb(var(--color-system-green))'
                    : 'rgb(var(--color-label-tertiary))',
                }}
              >
                {label}
              </span>
              <span className="rounded-full bg-[rgb(var(--color-fill)/0.1)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[rgb(var(--color-label-tertiary))]">
                {relayCapabilitySummary(entry)}
              </span>
              {isDefault && (
                <span className="rounded-full bg-[rgb(var(--color-fill)/0.1)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[rgb(var(--color-label-tertiary))]">
                  Default
                </span>
              )}
              {entry.read && isRecommendedReadRelay(entry.url) && (
                <span className="rounded-full bg-[rgb(var(--color-system-green)/0.12)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[rgb(var(--color-system-green))]">
                  Fast Read
                </span>
              )}
              {entry.write && isRecommendedWriteRelay(entry.url) && (
                <span className="rounded-full bg-[rgb(var(--color-accent)/0.12)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[rgb(var(--color-accent))]">
                  Reliable Write
                </span>
              )}
              <span className={healthBadgeClass(health?.tier ?? 'unknown')}>
                {health?.label ?? 'Health unknown'}
              </span>
            </div>
          </div>

          {/* Delete control */}
          {confirmDelete ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-full border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg-secondary))] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label-secondary))] active:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onRemove(entry.url)}
                className="rounded-full bg-[rgb(var(--color-system-red)/0.1)] px-3 py-1.5 text-[12px] font-semibold text-[rgb(var(--color-system-red))] active:opacity-70"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Remove ${hostname}`}
              className="
                flex h-7 w-7 shrink-0 items-center justify-center
                rounded-full
                text-[rgb(var(--color-label-tertiary))]
                transition-colors hover:text-[rgb(var(--color-system-red))]
                active:opacity-70
              "
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M2 7h10"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <RelayCapabilityButton
            label="Read"
            active={entry.read}
            disabled={disableReadToggle}
            onClick={() => onToggleCapability(entry.url, 'read')}
          />
          <RelayCapabilityButton
            label="Write"
            active={entry.write}
            disabled={disableWriteToggle}
            onClick={() => onToggleCapability(entry.url, 'write')}
          />
          {showRetry && (
            <button
              type="button"
              disabled={retrying}
              onClick={() => onRetry(entry.url)}
              className="rounded-full border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label-secondary))] transition-opacity disabled:opacity-40 active:opacity-80"
            >
              {retrying ? 'Retrying…' : 'Retry Now'}
            </button>
          )}
        </div>
        <p className="mt-2 text-[12px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
          Read relays power subscriptions and feed refreshes. Write relays receive your signed notes and relay-list updates.
        </p>
        {health?.details && (
          <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
            {health.details}
          </p>
        )}
        {offlineHint && (
          <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
            {offlineHint}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function RelaysPage() {
  const { currentUser } = useApp()
  const navigate = useNavigate()
  const [entries, setEntries] = useState<RelayEntry[]>([])
  const [addUrl, setAddUrl] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [relayError, setRelayError] = useState<string | null>(null)
  const [relayHealth, setRelayHealth] = useState<Record<string, RelayHealthSnapshot>>({})
  const [relayHealthCheckedAt, setRelayHealthCheckedAt] = useState<Record<string, number>>({})
  const [importingRemote, setImportingRemote] = useState(false)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [retryingRelayUrl, setRetryingRelayUrl] = useState<string | null>(null)
  const [retryingAll, setRetryingAll] = useState(false)
  const [refreshingHealth, setRefreshingHealth] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const addTimerRef = useRef<number | null>(null)
  const resetTimerRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Refresh relay status from NDK pool
  const refresh = useCallback(() => {
    setEntries(getRelayEntries())
  }, [])

  useEffect(() => {
    refresh()
    // Poll every 1.5 s so status dots update live
    pollRef.current = setInterval(refresh, 1_500)
    window.addEventListener(RELAY_SETTINGS_UPDATED_EVENT, refresh)
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current)
      if (addTimerRef.current !== null) window.clearTimeout(addTimerRef.current)
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
      window.removeEventListener(RELAY_SETTINGS_UPDATED_EVENT, refresh)
    }
  }, [refresh])

  const defaultUrls = useMemo(() => new Set(getDefaultRelayUrls()), [])
  const relayPreferences = useMemo(
    () => entries.map(({ url, read, write }) => ({ url, read, write })),
    [entries],
  )

  const connectedCount = useMemo(
    () => entries.filter(e => isConnected(e.status)).length,
    [entries],
  )
  const hasRecommendedReadRelay = useMemo(
    () => entries.some(entry => entry.read && isRecommendedReadRelay(entry.url)),
    [entries],
  )
  const hasRecommendedWriteRelay = useMemo(
    () => entries.some(entry => entry.write && isRecommendedWriteRelay(entry.url)),
    [entries],
  )
  const remoteImportEnabled = isRemoteImportEnabled(currentUser?.pubkey)
  const relayUrlsKey = useMemo(
    () => entries.map(entry => entry.url).sort().join('|'),
    [entries],
  )
  const retryAvailability = useMemo(() => {
    const next = new Map<string, boolean>()
    for (const entry of entries) {
      next.set(entry.url, canRetryRelayConnection(entry.url))
    }
    return next
  }, [entries])

  const fetchRelayHealth = useCallback((forceRefresh = false) => {
    const controller = new AbortController()
    const relayUrls = entries.map(entry => entry.url)

    if (relayUrls.length === 0) {
      setRelayHealth({})
      setRelayHealthCheckedAt({})
      return () => controller.abort()
    }

    for (const relayUrl of relayUrls) {
      void getRelayHealthSnapshot(relayUrl, {
        signal: controller.signal,
        forceRefresh,
      }).then(({ snapshot, checkedAt }) => {
        if (controller.signal.aborted) return
        setRelayHealth((current) => {
          if (
            current[relayUrl]?.label === snapshot.label
            && current[relayUrl]?.details === snapshot.details
            && current[relayUrl]?.tier === snapshot.tier
          ) {
            return current
          }
          return { ...current, [relayUrl]: snapshot }
        })
        setRelayHealthCheckedAt((current) => ({ ...current, [relayUrl]: checkedAt }))
      })
    }

    return () => controller.abort()
  }, [entries])

  useEffect(() => {
    if (!relayUrlsKey) {
      setRelayHealth({})
      setRelayHealthCheckedAt({})
      return
    }

    return fetchRelayHealth(false)
  }, [fetchRelayHealth, relayUrlsKey])

  // ── Add relay ──────────────────────────────────────────────
  const handleAdd = async () => {
    const trimmed = addUrl.trim()
    if (!trimmed) {
      setAddError('Enter a relay URL.')
      return
    }

    // Normalise: ensure wss:// prefix
    const url = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`

    if (!isValidRelayURL(url)) {
      setAddError('Must be a valid wss:// URL.')
      return
    }

    if (entries.some(e => e.url === url)) {
      setAddError('Relay is already in your list.')
      return
    }

    setAdding(true)
    setAddError(null)
    setRelayError(null)
    setImportNotice(null)

    try {
      addRelayToPool(url)
      const newPreferences = [...relayPreferences, { url, read: true, write: true }]
      setStoredRelayPreferences(newPreferences)
      setEntries(getRelayEntries(newPreferences))
      setAddUrl('')
      // Give the pool a moment to register then refresh
      if (addTimerRef.current !== null) window.clearTimeout(addTimerRef.current)
      addTimerRef.current = window.setTimeout(() => {
        refresh()
        setAdding(false)
      }, 300)
    } catch (err) {
      setAddError('Failed to add relay.')
      setAdding(false)
    }
  }

  // ── Remove relay ───────────────────────────────────────────
  const handleRemove = useCallback(
    (url: string) => {
      const newPreferences = relayPreferences.filter(preference => preference.url !== url)
      if (!newPreferences.some(preference => preference.read)) {
        setRelayError('Keep at least one read relay so feeds can refresh.')
        return
      }
      if (!newPreferences.some(preference => preference.write)) {
        setRelayError('Keep at least one write relay so your notes have a publish target.')
        return
      }

      setRelayError(null)
      setImportNotice(null)
      removeRelayFromPool(url)
      setStoredRelayPreferences(newPreferences)
      setEntries(getRelayEntries(newPreferences))
    },
    [relayPreferences],
  )

  const handleToggleCapability = useCallback(
    (url: string, capability: 'read' | 'write') => {
      const current = relayPreferences.find(preference => preference.url === url)
      if (!current) return

      const nextPreference = {
        ...current,
        [capability]: !current[capability],
      }

      if (!nextPreference.read && !nextPreference.write) {
        return
      }

      const newPreferences = relayPreferences.map((preference) =>
        preference.url === url ? nextPreference : preference,
      )

      if (!newPreferences.some(preference => preference.read)) {
        setRelayError('Keep at least one read relay so feeds can refresh.')
        return
      }

      if (!newPreferences.some(preference => preference.write)) {
        setRelayError('Keep at least one write relay so your notes have a publish target.')
        return
      }

      setRelayError(null)
      setImportNotice(null)
      if (current.read && !nextPreference.read) {
        removeRelayFromPool(url)
      } else if (!current.read && nextPreference.read) {
        addRelayToPool(url)
      }

      setStoredRelayPreferences(newPreferences)
      setEntries(getRelayEntries(newPreferences))
    },
    [relayPreferences],
  )

  const handleImportRemoteRelayList = useCallback(async () => {
    if (!currentUser?.pubkey || importingRemote) return

    setImportingRemote(true)
    setRelayError(null)
    setAddError(null)
    setImportNotice(null)

    try {
      const importedPreferences = await importCurrentUserRelayListPreferences(currentUser.pubkey)
      if (importedPreferences.length === 0) {
        setImportNotice('No remote kind-10002 relay list was found for this account yet.')
        return
      }

      if (!importedPreferences.some(preference => preference.read)) {
        setImportNotice('Remote relay list is missing a read relay, so it was not imported.')
        return
      }

      if (!importedPreferences.some(preference => preference.write)) {
        setImportNotice('Remote relay list is missing a write relay, so it was not imported.')
        return
      }

      for (const entry of entries) {
        if (entry.read && !importedPreferences.some(preference => preference.url === entry.url && preference.read)) {
          removeRelayFromPool(entry.url)
        }
      }

      for (const preference of importedPreferences) {
        if (preference.read) addRelayToPool(preference.url)
      }

      setStoredRelayPreferences(importedPreferences)
      setEntries(getRelayEntries(importedPreferences))
      setImportNotice('Imported your remote kind-10002 relay roles into this device.')
    } catch (error) {
      setRelayError(error instanceof Error ? error.message : 'Failed to import remote relay roles.')
    } finally {
      setImportingRemote(false)
    }
  }, [currentUser?.pubkey, entries, importingRemote])

  const handleRetryRelay = useCallback((url: string) => {
    setRelayError(null)
    setRetryingRelayUrl(url)

    const scheduled = retryRelayConnection(url)
    if (!scheduled) addRelayToPool(url)

    window.setTimeout(() => {
      refresh()
      setRetryingRelayUrl((current) => (current === url ? null : current))
    }, 700)
  }, [refresh])

  const handleRetryAllOfflineReadRelays = useCallback(() => {
    setRelayError(null)
    setRetryingAll(true)

    const offlineReadRelays = entries
      .filter(entry => entry.read && !isConnected(entry.status))
      .map(entry => entry.url)

    if (offlineReadRelays.length === 0) {
      setRetryingAll(false)
      return
    }

    for (const relayUrl of offlineReadRelays) {
      const scheduled = retryRelayConnection(relayUrl)
      if (!scheduled) addRelayToPool(relayUrl)
    }

    window.setTimeout(() => {
      refresh()
      setRetryingAll(false)
    }, 900)
  }, [entries, refresh])

  const handleRefreshHealth = useCallback(() => {
    setRefreshingHealth(true)
    const cleanup = fetchRelayHealth(true)
    window.setTimeout(() => {
      cleanup()
      setRefreshingHealth(false)
    }, 1_200)
  }, [fetchRelayHealth])

  const handleAddRecommendedRelay = useCallback((url: string) => {
    if (!isValidRelayURL(url)) return
    if (entries.some(entry => entry.url === url)) return

    const newPreferences = [...relayPreferences, { url, read: true, write: true }]
    addRelayToPool(url)
    setStoredRelayPreferences(newPreferences)
    setEntries(getRelayEntries(newPreferences))
  }, [entries, relayPreferences])

  // ── Reset to defaults ──────────────────────────────────────
  const handleReset = () => {
    setRelayError(null)
    setImportNotice(null)
    // Disconnect relays not in defaults and add any missing defaults
    const currentUrls = new Set(entries.map(e => e.url))

    // Remove non-default relays
    for (const url of currentUrls) {
      if (!defaultUrls.has(url)) {
        removeRelayFromPool(url)
      }
    }

    // Add any missing defaults
    for (const url of defaultUrls) {
      if (!currentUrls.has(url)) {
        addRelayToPool(url)
      }
    }

    clearStoredRelayUrls()
    setEntries(getRelayEntries(getDefaultRelayPreferences()))
    setShowResetConfirm(false)
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = window.setTimeout(refresh, 400)
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="
                app-panel-muted
                h-10 w-10 rounded-full
                text-[rgb(var(--color-label))]
                flex items-center justify-center
                active:opacity-80
              "
              aria-label="Go back"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M9.5 3.25L4.75 8l4.75 4.75"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div>
              <h1 className="text-[20px] font-semibold text-[rgb(var(--color-label))] leading-tight">
                Relays
              </h1>
              {entries.length > 0 && (
                <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] leading-tight mt-0.5">
                  {connectedCount} of {entries.length} connected
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6 pb-12 pt-2">

        {/* ── Add relay ── */}
        <section>
          <h2 className="section-kicker px-1 mb-3">Add Relay</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="url"
                value={addUrl}
                onChange={e => {
                  setAddUrl(e.target.value)
                  if (addError) setAddError(null)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleAdd()
                }}
                placeholder="wss://relay.example.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="
                  min-w-0 flex-1
                  rounded-[14px]
                  border border-[rgb(var(--color-fill)/0.18)]
                  bg-[rgb(var(--color-bg))]
                  px-3 py-2.5
                  text-[14px] font-mono
                  text-[rgb(var(--color-label))]
                  placeholder:text-[rgb(var(--color-label-tertiary))]
                  outline-none
                  transition-colors
                  focus:border-[rgb(var(--color-accent))]
                "
              />
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={adding || !addUrl.trim()}
                className="
                  shrink-0
                  rounded-[14px]
                  bg-[rgb(var(--color-accent))]
                  px-4 py-2.5
                  text-[14px] font-semibold text-white
                  disabled:opacity-40
                  active:opacity-80
                  transition-opacity
                "
              >
                {adding ? '…' : 'Add'}
              </button>
            </div>
            {addError && (
              <p className="text-[13px] text-[rgb(var(--color-system-red))]">{addError}</p>
            )}
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
              Use WebSocket Secure (wss://) URLs only. Changes take effect immediately
              and are saved for future sessions. New relays start as read/write, and
              you can split them below. When signed in, changes also publish your
              kind-10002 relay list for NIP-65 outbox discovery.
            </p>
            <p className="text-[12px] text-[rgb(var(--color-label-secondary))] leading-relaxed">
              Offline read relays can be manually reconnected with the Retry Now button in each relay row.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refresh}
                className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[12px] font-semibold text-[rgb(var(--color-label))] active:opacity-80"
              >
                Refresh Status
              </button>
              <button
                type="button"
                onClick={handleRetryAllOfflineReadRelays}
                disabled={retryingAll}
                className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[12px] font-semibold text-[rgb(var(--color-label))] transition-opacity disabled:opacity-40 active:opacity-80"
              >
                {retryingAll ? 'Retrying…' : 'Retry Offline Read Relays'}
              </button>
              <button
                type="button"
                onClick={handleRefreshHealth}
                disabled={refreshingHealth}
                className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[12px] font-semibold text-[rgb(var(--color-label))] transition-opacity disabled:opacity-40 active:opacity-80"
              >
                {refreshingHealth ? 'Refreshing…' : 'Refresh Health'}
              </button>
            </div>
            {remoteImportEnabled && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[rgb(var(--color-label))]">
                    One-time bootstrap from your remote relay list
                  </p>
                  <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
                    Import your signed-in account’s current kind-10002 read/write roles into this device, then keep editing locally.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleImportRemoteRelayList()}
                  disabled={importingRemote}
                  className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--color-label))] transition-opacity disabled:opacity-40 active:opacity-80"
                >
                  {importingRemote ? 'Importing…' : 'Import Remote Roles'}
                </button>
              </div>
            )}
            {importNotice && (
              <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">{importNotice}</p>
            )}
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">Recommendations</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">Fast read coverage</p>
                <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
                  Keep at least one low-latency read relay for feed refreshes and search-heavy browsing.
                </p>
              </div>
              <span className={hasRecommendedReadRelay
                ? 'rounded-full bg-[rgb(var(--color-system-green)/0.12)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--color-system-green))]'
                : 'rounded-full bg-[rgb(var(--color-system-orange,255_149_0)/0.12)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--color-system-orange,255_149_0))]'}>
                {hasRecommendedReadRelay ? 'Covered' : 'Add One'}
              </span>
            </div>
            <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">
              Suggested fast read relays: {RECOMMENDED_FAST_READ_RELAYS.join(', ')}
            </p>
            <div className="flex items-start justify-between gap-3 border-t border-[rgb(var(--color-fill)/0.08)] pt-3">
              <div>
                <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">Reliable write coverage</p>
                <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
                  Keep at least one dependable write relay so publishes and relay-list updates land consistently.
                </p>
              </div>
              <span className={hasRecommendedWriteRelay
                ? 'rounded-full bg-[rgb(var(--color-system-green)/0.12)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--color-system-green))]'
                : 'rounded-full bg-[rgb(var(--color-system-orange,255_149_0)/0.12)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--color-system-orange,255_149_0))]'}>
                {hasRecommendedWriteRelay ? 'Covered' : 'Add One'}
              </span>
            </div>
            <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">
              Suggested reliable write relays: {RECOMMENDED_RELIABLE_WRITE_RELAYS.join(', ')}
            </p>
            <div className="space-y-2 border-t border-[rgb(var(--color-fill)/0.08)] pt-3">
              <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">
                Curated relay suggestions based on broadly used public relay infrastructure and outbox-discovery coverage:
              </p>
              {CURATED_RELAY_RECOMMENDATIONS.map((recommendation) => {
                const alreadyAdded = entries.some(entry => entry.url === recommendation.url)
                return (
                  <div key={recommendation.url} className="flex flex-wrap items-start justify-between gap-2 rounded-[12px] border border-[rgb(var(--color-fill)/0.12)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-mono text-[rgb(var(--color-label))]">{recommendation.url}</p>
                      <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))]">{recommendation.reason}</p>
                    </div>
                    <button
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => handleAddRecommendedRelay(recommendation.url)}
                      className="rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-2.5 py-1.5 text-[11px] font-semibold text-[rgb(var(--color-label))] transition-opacity disabled:opacity-40 active:opacity-80"
                    >
                      {alreadyAdded ? 'Added' : 'Add'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── Relay list ── */}
        <section>
          <h2 className="section-kicker px-1 mb-3">
            {entries.length > 0 ? `${entries.length} Relay${entries.length !== 1 ? 's' : ''}` : 'Relays'}
          </h2>

          {entries.length === 0 ? (
            <div className="app-panel rounded-ios-xl p-6 card-elevated text-center">
              <p className="text-[32px] mb-2">📡</p>
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                No relays configured. Add one above or reset to defaults.
              </p>
            </div>
          ) : (
            <div className="app-panel rounded-ios-xl px-4 card-elevated divide-y divide-[rgb(var(--color-fill)/0.08)]">
              {relayError && (
                <div className="py-3 text-[13px] text-[rgb(var(--color-system-red))]">
                  {relayError}
                </div>
              )}
              {entries.map(entry => (
                <RelayRow
                  key={entry.url}
                  entry={entry}
                  isDefault={defaultUrls.has(entry.url)}
                  health={relayHealth[entry.url]}
                  retryAvailable={retryAvailability.get(entry.url) ?? false}
                  retrying={retryingRelayUrl === entry.url}
                  onRetry={handleRetryRelay}
                  onToggleCapability={handleToggleCapability}
                  onRemove={handleRemove}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Reset to defaults ── */}
        <section>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            {showResetConfirm ? (
              <div className="space-y-3">
                <p className="text-[14px] text-[rgb(var(--color-label-secondary))] leading-relaxed">
                  This will restore the default relay list and remove any custom relays you've added. Continue?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(false)}
                    className="flex-1 rounded-[12px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] py-2.5 text-[14px] font-medium text-[rgb(var(--color-label))] active:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex-1 rounded-[12px] bg-[rgb(var(--color-system-red)/0.1)] py-2.5 text-[14px] font-semibold text-[rgb(var(--color-system-red))] active:opacity-70"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="flex w-full items-center justify-between text-left transition-opacity active:opacity-70"
              >
                <div>
                  <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                    Reset to Defaults
                  </p>
                  <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                    Restore the {getDefaultRelayUrls().length} built-in relays.
                  </p>
                </div>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  className="shrink-0 text-[rgb(var(--color-label-tertiary))]"
                >
                  <path
                    d="M6 3L11 8L6 13"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </section>

        {/* ── Legend ── */}
        <section className="px-1 space-y-2">
          <h2 className="section-kicker mb-2">Status</h2>
          <div className="flex flex-wrap gap-4">
            {(
              [
                { status: NDKRelayStatus.CONNECTED,    label: 'Connected'    },
                { status: NDKRelayStatus.CONNECTING,   label: 'Connecting'   },
                { status: NDKRelayStatus.FLAPPING,     label: 'Unstable'     },
                { status: NDKRelayStatus.DISCONNECTED, label: 'Offline'      },
              ] as const
            ).map(({ status, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <StatusDot status={status} />
                <span className="text-[12px] text-[rgb(var(--color-label-secondary))]">{label}</span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  )
}
