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
import {
  addRelayToPool,
  getDefaultRelayUrls,
  getPoolRelayUrls,
  getNDK,
  removeRelayFromPool,
} from '@/lib/nostr/ndk'
import {
  clearStoredRelayUrls,
  setStoredRelayUrls,
} from '@/lib/relay/relaySettings'
import { isValidRelayURL } from '@/lib/security/sanitize'

// ── Types ────────────────────────────────────────────────────

interface RelayEntry {
  url: string
  status: NDKRelayStatus
}

// ── Status helpers ───────────────────────────────────────────

function getRelayEntries(): RelayEntry[] {
  try {
    const ndk = getNDK()
    return Array.from(ndk.pool.relays.entries()).map(([url, relay]) => ({
      url,
      status: relay.status ?? NDKRelayStatus.DISCONNECTED,
    }))
  } catch {
    // NDK not yet initialised — return empty
    return []
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
  onRemove,
}: {
  entry: RelayEntry
  isDefault: boolean
  onRemove: (url: string) => void
}) {
  const { label } = statusMeta(entry.status)
  const hostname = hostnameOf(entry.url)
  const connected = isConnected(entry.status)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="flex items-center gap-3 py-3">
      {/* Status dot */}
      <div className="flex w-5 items-center justify-center">
        <StatusDot status={entry.status} />
      </div>

      {/* Relay info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-[rgb(var(--color-label))]">
          {hostname}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5">
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
          {isDefault && !connected && (
            <span className="rounded-full bg-[rgb(var(--color-fill)/0.1)] px-1.5 py-0 text-[10px] text-[rgb(var(--color-label-tertiary))] font-medium uppercase tracking-[0.05em]">
              Default
            </span>
          )}
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
  )
}

// ── Page ─────────────────────────────────────────────────────

export default function RelaysPage() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<RelayEntry[]>([])
  const [addUrl, setAddUrl] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Refresh relay status from NDK pool
  const refresh = useCallback(() => {
    setEntries(getRelayEntries())
  }, [])

  useEffect(() => {
    refresh()
    // Poll every 1.5 s so status dots update live
    pollRef.current = setInterval(refresh, 1_500)
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current)
    }
  }, [refresh])

  const defaultUrls = useMemo(() => new Set(getDefaultRelayUrls()), [])

  const connectedCount = useMemo(
    () => entries.filter(e => isConnected(e.status)).length,
    [entries],
  )

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

    try {
      addRelayToPool(url)
      const newUrls = [...entries.map(e => e.url), url]
      setStoredRelayUrls(newUrls)
      setAddUrl('')
      // Give the pool a moment to register then refresh
      setTimeout(() => {
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
      removeRelayFromPool(url)
      const newUrls = entries.map(e => e.url).filter(u => u !== url)
      setStoredRelayUrls(newUrls)
      setEntries(prev => prev.filter(e => e.url !== url))
    },
    [entries],
  )

  // ── Reset to defaults ──────────────────────────────────────
  const handleReset = () => {
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
    setShowResetConfirm(false)
    setTimeout(refresh, 400)
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
              and are saved for future sessions.
            </p>
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
              {entries.map(entry => (
                <RelayRow
                  key={entry.url}
                  entry={entry}
                  isDefault={defaultUrls.has(entry.url)}
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
