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
import { tApp } from '@/lib/i18n/app'
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
  'wss://relay.mostr.pub',
] as const

const RECOMMENDED_RELIABLE_WRITE_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://relay.momostr.pink',
  'wss://ditto.pub/relay',
] as const

const CURATED_RELAY_RECOMMENDATIONS = [
  {
    url: 'wss://purplepag.es',
    reasonKey: 'relaysRecommendationPurplepages',
  },
  {
    url: 'wss://nos.lol',
    reasonKey: 'relaysRecommendationNosLol',
  },
  {
    url: 'wss://relay.primal.net',
    reasonKey: 'relaysRecommendationPrimal',
  },
  {
    url: 'wss://relay.momostr.pink',
    reasonKey: 'relaysRecommendationMomostr',
  },
  {
    url: 'wss://relay.mostr.pub',
    reasonKey: 'relaysRecommendationMostrPub',
  },
  {
    url: 'wss://ditto.pub/relay',
    reasonKey: 'relaysRecommendationDitto',
  },
  {
    url: 'wss://relay.nostr.band',
    reasonKey: 'relaysRecommendationNostrBand',
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
    const parsed = new URL(url.trim())
    parsed.hash = ''
    parsed.search = ''
    parsed.pathname = parsed.pathname.replace(/\/+$/g, '')
    if (parsed.pathname === '/') parsed.pathname = ''
    return parsed.toString().replace(/\/+$/g, '')
  } catch {
    return url.trim().replace(/\/+$/g, '')
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
      return { label: tApp('relaysStatusConnected'), color: 'rgb(var(--color-system-green))', pulse: true }
    case NDKRelayStatus.AUTH_REQUESTED:
    case NDKRelayStatus.AUTHENTICATING:
      return { label: tApp('relaysStatusAuthenticating'), color: 'rgb(var(--color-system-yellow, 255 204 0))', pulse: true }
    case NDKRelayStatus.CONNECTING:
    case NDKRelayStatus.RECONNECTING:
      return { label: tApp('relaysStatusConnecting'), color: 'rgb(var(--color-system-yellow, 255 204 0))', pulse: true }
    case NDKRelayStatus.FLAPPING:
      return { label: tApp('relaysStatusUnstable'), color: 'rgb(var(--color-system-orange, 255 149 0))', pulse: false }
    default:
      return { label: tApp('relaysStatusOffline'), color: 'rgb(var(--color-fill-secondary, 142 142 147))', pulse: false }
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
  if (entry.read && entry.write) return tApp('relaysCapabilityReadWrite')
  return entry.read ? tApp('relaysCapabilityReadOnly') : tApp('relaysCapabilityWriteOnly')
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
      ? tApp('relaysOfflineHintRestricted')
      : health?.tier === 'good' || health?.tier === 'caution'
        ? tApp('relaysOfflineHintHealthy')
        : tApp('relaysOfflineHintUnknown')
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
                  {tApp('relaysDefaultBadge')}
                </span>
              )}
              {entry.read && isRecommendedReadRelay(entry.url) && (
                <span className="rounded-full bg-[rgb(var(--color-system-green)/0.12)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[rgb(var(--color-system-green))]">
                  {tApp('relaysFastReadBadge')}
                </span>
              )}
              {entry.write && isRecommendedWriteRelay(entry.url) && (
                <span className="rounded-full bg-[rgb(var(--color-accent)/0.12)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] text-[rgb(var(--color-accent))]">
                  {tApp('relaysReliableWriteBadge')}
                </span>
              )}
              <span className={healthBadgeClass(health?.tier ?? 'unknown')}>
                {health?.label ?? tApp('relaysHealthUnknown')}
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
                {tApp('relaysCancel')}
              </button>
              <button
                type="button"
                onClick={() => onRemove(entry.url)}
                className="rounded-full bg-[rgb(var(--color-system-red)/0.1)] px-3 py-1.5 text-[12px] font-semibold text-[rgb(var(--color-system-red))] active:opacity-70"
              >
                {tApp('relaysRemove')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={tApp('relaysRemoveAria', { hostname })}
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
            label={tApp('relaysRead')}
            active={entry.read}
            disabled={disableReadToggle}
            onClick={() => onToggleCapability(entry.url, 'read')}
          />
          <RelayCapabilityButton
            label={tApp('relaysWrite')}
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
              {retrying ? tApp('relaysRetryingNow') : tApp('relaysRetryNow')}
            </button>
          )}
        </div>
        <p className="mt-2 text-[12px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
          {tApp('relaysCapabilityHint')}
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
  const existingRelayKeys = useMemo(
    () => new Set(entries.map((entry) => normalizeRelayKey(entry.url))),
    [entries],
  )
  const pendingAddUrl = useMemo(() => {
    const trimmed = addUrl.trim()
    if (!trimmed) return null
    const candidate = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`
    if (!isValidRelayURL(candidate)) return null
    return candidate
  }, [addUrl])
  const pendingRelayAlreadyAdded = useMemo(() => {
    if (!pendingAddUrl) return false
    return existingRelayKeys.has(normalizeRelayKey(pendingAddUrl))
  }, [existingRelayKeys, pendingAddUrl])

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
      setAddError(tApp('relaysEnterUrl'))
      return
    }

    // Normalise: ensure wss:// prefix
    const url = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`

    if (!isValidRelayURL(url)) {
      setAddError(tApp('relaysInvalidUrl'))
      return
    }

    if (existingRelayKeys.has(normalizeRelayKey(url))) {
      setAddError(tApp('relaysAlreadyAdded'))
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
      setAddError(tApp('relaysAddFailed'))
      setAdding(false)
    }
  }

  // ── Remove relay ───────────────────────────────────────────
  const handleRemove = useCallback(
    (url: string) => {
      const newPreferences = relayPreferences.filter(preference => preference.url !== url)
      if (!newPreferences.some(preference => preference.read)) {
        setRelayError(tApp('relaysKeepOneRead'))
        return
      }
      if (!newPreferences.some(preference => preference.write)) {
        setRelayError(tApp('relaysKeepOneWrite'))
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
        setRelayError(tApp('relaysKeepOneRead'))
        return
      }

      if (!newPreferences.some(preference => preference.write)) {
        setRelayError(tApp('relaysKeepOneWrite'))
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
        setImportNotice(tApp('relaysNoRemoteList'))
        return
      }

      if (!importedPreferences.some(preference => preference.read)) {
        setImportNotice(tApp('relaysRemoteMissingRead'))
        return
      }

      if (!importedPreferences.some(preference => preference.write)) {
        setImportNotice(tApp('relaysRemoteMissingWrite'))
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
      setImportNotice(tApp('relaysImportedRemote'))
    } catch (error) {
      setRelayError(error instanceof Error ? error.message : tApp('relaysImportFailed'))
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
    if (existingRelayKeys.has(normalizeRelayKey(url))) return

    const newPreferences = [...relayPreferences, { url, read: true, write: true }]
    addRelayToPool(url)
    setStoredRelayPreferences(newPreferences)
    setEntries(getRelayEntries(newPreferences))
  }, [existingRelayKeys, relayPreferences])

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
                aria-label={tApp('relaysGoBack')}
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
                {tApp('relaysTitle')}
              </h1>
              {entries.length > 0 && (
                <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] leading-tight mt-0.5">
                  {tApp('relaysConnectedSummary', { connected: connectedCount, total: entries.length })}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6 pb-12 pt-2">

        {/* ── Add relay ── */}
        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('relaysAddSection')}</h2>
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
                placeholder={tApp('relaysInputPlaceholder')}
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
                {adding ? '…' : tApp('relaysAddButton')}
              </button>
            </div>
            {addError && (
              <p className="text-[13px] text-[rgb(var(--color-system-red))]">{addError}</p>
            )}
            {!addError && pendingRelayAlreadyAdded && (
              <p className="text-[12px] text-[rgb(var(--color-system-orange,255_149_0))]">
                {tApp('relaysAlreadyAdded')}
              </p>
            )}
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
              {tApp('relaysWssHint')}
            </p>
            <p className="text-[12px] text-[rgb(var(--color-label-secondary))] leading-relaxed">
              {tApp('relaysRetryHint')}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refresh}
                className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[12px] font-semibold text-[rgb(var(--color-label))] active:opacity-80"
              >
                {tApp('relaysRefreshStatus')}
              </button>
              <button
                type="button"
                onClick={handleRetryAllOfflineReadRelays}
                disabled={retryingAll}
                className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[12px] font-semibold text-[rgb(var(--color-label))] transition-opacity disabled:opacity-40 active:opacity-80"
              >
                {retryingAll ? tApp('relaysRetryingNow') : tApp('relaysRetryOffline')}
              </button>
              <button
                type="button"
                onClick={handleRefreshHealth}
                disabled={refreshingHealth}
                className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[12px] font-semibold text-[rgb(var(--color-label))] transition-opacity disabled:opacity-40 active:opacity-80"
              >
                {refreshingHealth ? tApp('relaysRefreshing') : tApp('relaysRefreshHealth')}
              </button>
            </div>
            {remoteImportEnabled && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[rgb(var(--color-label))]">
                    {tApp('relaysImportCardTitle')}
                  </p>
                  <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
                    {tApp('relaysImportCardBody')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleImportRemoteRelayList()}
                  disabled={importingRemote}
                  className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--color-label))] transition-opacity disabled:opacity-40 active:opacity-80"
                >
                  {importingRemote ? tApp('relaysImporting') : tApp('relaysImportRemote')}
                </button>
              </div>
            )}
            {importNotice && (
              <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">{importNotice}</p>
            )}
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('relaysRecommendationsSection')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">{tApp('relaysFastReadCoverage')}</p>
                <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
                  {tApp('relaysFastReadCoverageHint')}
                </p>
              </div>
              <span className={hasRecommendedReadRelay
                ? 'rounded-full bg-[rgb(var(--color-system-green)/0.12)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--color-system-green))]'
                : 'rounded-full bg-[rgb(var(--color-system-orange,255_149_0)/0.12)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--color-system-orange,255_149_0))]'}>
                {hasRecommendedReadRelay ? tApp('relaysCoverageCovered') : tApp('relaysCoverageAddOne')}
              </span>
            </div>
            <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">
              {tApp('relaysSuggestedFastRead', { relays: RECOMMENDED_FAST_READ_RELAYS.join(', ') })}
            </p>
            <div className="flex items-start justify-between gap-3 border-t border-[rgb(var(--color-fill)/0.08)] pt-3">
              <div>
                <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">{tApp('relaysReliableWriteCoverage')}</p>
                <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))] leading-relaxed">
                  {tApp('relaysReliableWriteCoverageHint')}
                </p>
              </div>
              <span className={hasRecommendedWriteRelay
                ? 'rounded-full bg-[rgb(var(--color-system-green)/0.12)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--color-system-green))]'
                : 'rounded-full bg-[rgb(var(--color-system-orange,255_149_0)/0.12)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--color-system-orange,255_149_0))]'}>
                {hasRecommendedWriteRelay ? tApp('relaysCoverageCovered') : tApp('relaysCoverageAddOne')}
              </span>
            </div>
            <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">
              {tApp('relaysSuggestedReliableWrite', { relays: RECOMMENDED_RELIABLE_WRITE_RELAYS.join(', ') })}
            </p>
            <div className="space-y-2 border-t border-[rgb(var(--color-fill)/0.08)] pt-3">
              <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">
                {tApp('relaysCuratedIntro')}
              </p>
              {CURATED_RELAY_RECOMMENDATIONS.map((recommendation) => {
                const alreadyAdded = entries.some(entry => entry.url === recommendation.url)
                return (
                  <div key={recommendation.url} className="flex flex-wrap items-start justify-between gap-2 rounded-[12px] border border-[rgb(var(--color-fill)/0.12)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-mono text-[rgb(var(--color-label))]">{recommendation.url}</p>
                      <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))]">{tApp(recommendation.reasonKey)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => handleAddRecommendedRelay(recommendation.url)}
                      className="rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-2.5 py-1.5 text-[11px] font-semibold text-[rgb(var(--color-label))] transition-opacity disabled:opacity-40 active:opacity-80"
                    >
                      {alreadyAdded ? tApp('relaysAdded') : tApp('relaysAddButton')}
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
            {entries.length > 0
              ? tApp('relaysRelayCount', {
                count: entries.length,
                word: entries.length === 1 ? tApp('relaysRelaySingular') : tApp('relaysRelayPlural'),
              })
              : tApp('relaysRelayPlural')}
          </h2>

          {entries.length === 0 ? (
            <div className="app-panel rounded-ios-xl p-6 card-elevated text-center">
              <p className="text-[32px] mb-2">📡</p>
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                {tApp('relaysEmptyTitle')}
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
                  {tApp('relaysResetConfirm')}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(false)}
                    className="flex-1 rounded-[12px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] py-2.5 text-[14px] font-medium text-[rgb(var(--color-label))] active:opacity-70"
                  >
                    {tApp('relaysCancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex-1 rounded-[12px] bg-[rgb(var(--color-system-red)/0.1)] py-2.5 text-[14px] font-semibold text-[rgb(var(--color-system-red))] active:opacity-70"
                  >
                    {tApp('relaysReset')}
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
                    {tApp('relaysResetTitle')}
                  </p>
                  <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                    {tApp('relaysResetHint', { count: getDefaultRelayUrls().length })}
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
          <h2 className="section-kicker mb-2">{tApp('relaysStatusSection')}</h2>
          <div className="flex flex-wrap gap-4">
            {(
              [
                { status: NDKRelayStatus.CONNECTED,    label: tApp('relaysStatusConnected') },
                { status: NDKRelayStatus.CONNECTING,   label: tApp('relaysStatusConnecting') },
                { status: NDKRelayStatus.FLAPPING,     label: tApp('relaysStatusUnstable') },
                { status: NDKRelayStatus.DISCONNECTED, label: tApp('relaysStatusOffline') },
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
