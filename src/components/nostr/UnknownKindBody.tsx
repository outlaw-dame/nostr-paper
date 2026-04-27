import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/contexts/app-context'
import { buildEventReferenceValue } from '@/lib/nostr/nip21'
import {
  buildHandlerLaunchUrl,
  getHandlerDisplayName,
  getHandlerSummary,
  resolveTrustedHandlerRecommendations,
  type ResolvedHandlerRecommendation,
} from '@/lib/nostr/appHandlers'
import { sanitizeText } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'

interface UnknownKindBodyProps {
  event: NostrEvent
  className?: string
}

/** Tags surfaced in the "notable tags" table — lower-priority tags are hidden */
const NOTABLE_TAG_NAMES = new Set(['d', 'e', 'a', 'p', 't', 'r', 'alt', 'url', 'title', 'summary', 'name', 'subject'])

function getAltDescription(event: NostrEvent): string | null {
  for (const tag of event.tags) {
    if (tag[0] !== 'alt' || typeof tag[1] !== 'string') continue
    const normalized = sanitizeText(tag[1]).trim()
    if (normalized.length > 0) return normalized
  }
  return null
}

function getReadableContent(event: NostrEvent): string | null {
  const raw = sanitizeText(event.content).trim()
  if (raw.length === 0) return null
  // If content looks like JSON, don't try to render it as plain text
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    return null
  }
  return raw.slice(0, 600) + (raw.length > 600 ? '…' : '')
}

function getNotableTags(event: NostrEvent): Array<{ name: string; value: string }> {
  const seen = new Set<string>()
  const result: Array<{ name: string; value: string }> = []
  for (const tag of event.tags) {
    const name = tag[0]
    const value = tag[1]
    if (!name || typeof value !== 'string') continue
    if (!NOTABLE_TAG_NAMES.has(name)) continue
    const key = `${name}:${value}`
    if (seen.has(key)) continue
    seen.add(key)
    const truncated = value.length > 64 ? `${value.slice(0, 30)}…${value.slice(-16)}` : value
    result.push({ name, value: truncated })
    if (result.length >= 8) break
  }
  return result
}

export function UnknownKindBody({
  event,
  className = '',
}: UnknownKindBodyProps) {
  const { currentUser } = useApp()
  const [handlers, setHandlers] = useState<ResolvedHandlerRecommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const description = useMemo(() => getAltDescription(event), [event])
  const readableContent = useMemo(() => getReadableContent(event), [event])
  const notableTags = useMemo(() => getNotableTags(event), [event])
  const referenceValue = useMemo(
    () => buildEventReferenceValue(event),
    [event],
  )

  useEffect(() => {
    if (!currentUser?.pubkey || !referenceValue) {
      setHandlers([])
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    resolveTrustedHandlerRecommendations(event.kind, currentUser.pubkey, controller.signal)
      .then((nextHandlers) => {
        if (controller.signal.aborted) return
        setHandlers(nextHandlers)
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setHandlers([])
        setError(loadError instanceof Error ? loadError.message : 'Failed to load NIP-89 recommendations.')
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [currentUser?.pubkey, event.kind, referenceValue])

  return (
    <div className={`rounded-[20px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-4 ${className}`}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        Unsupported Kind
      </p>
      <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
        Kind {event.kind}
      </h3>

      {/* alt description takes priority over raw content */}
      {description && (
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
          {description}
        </p>
      )}

      {/* Readable text content when no alt tag present */}
      {!description && readableContent && (
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-[rgb(var(--color-label-secondary))] line-clamp-4">
          {readableContent}
        </p>
      )}

      {/* Notable tags table */}
      {notableTags.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-[12px] border border-[rgb(var(--color-fill)/0.10)]">
          {notableTags.map(({ name, value }) => (
            <div
              key={`${name}:${value}`}
              className="flex items-baseline gap-2 border-b border-[rgb(var(--color-fill)/0.07)] px-3 py-1.5 last:border-b-0"
            >
              <span className="w-[60px] shrink-0 font-mono text-[11px] font-semibold text-[rgb(var(--color-label-secondary))]">
                {name}
              </span>
              <span className="min-w-0 break-all font-mono text-[12px] text-[rgb(var(--color-label))]">
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-[16px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] p-3">
        <p className="text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
          This client does not have a first-class renderer for kind {event.kind} yet. Trusted NIP-89 app recommendations are limited to your own key and the people you follow.
        </p>
      </div>

      {!currentUser && (
        <p className="mt-4 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
          Connect a signer to use trusted handler recommendations from your follow graph.
        </p>
      )}

      {loading && (
        <p className="mt-4 text-[13px] text-[rgb(var(--color-label-tertiary))]">
          Looking for trusted handlers…
        </p>
      )}

      {error && (
        <p className="mt-4 text-[13px] text-[rgb(var(--color-system-red))]">
          {error}
        </p>
      )}

      {!loading && handlers.length > 0 && referenceValue && (
        <div className="mt-4 space-y-3">
          {handlers.map((item) => {
            const href = buildHandlerLaunchUrl(item.handler, referenceValue, item.platform)

            return (
              <div
                key={`${item.handler.address}:${item.recommendedBy}:${item.platform ?? ''}`}
                className="
                  rounded-[16px] border border-[rgb(var(--color-fill)/0.12)]
                  bg-[rgb(var(--color-bg))] p-3
                "
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                      {getHandlerDisplayName(item.handler)}
                    </p>
                    <p className="mt-1 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                      {getHandlerSummary(item.handler)}
                    </p>
                    <p className="mt-2 text-[12px] text-[rgb(var(--color-label-tertiary))]">
                      Recommended by {item.recommendedBy.slice(0, 8)}…{item.recommendedBy.slice(-6)}
                      {item.platform ? ` • ${item.platform}` : ''}
                    </p>
                  </div>

                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="
                        shrink-0 rounded-[12px] bg-[rgb(var(--color-label))]
                        px-3 py-2 text-[13px] font-medium text-white
                        transition-opacity active:opacity-75
                      "
                    >
                      Open
                    </a>
                  ) : (
                    <span className="shrink-0 rounded-[12px] bg-[rgb(var(--color-fill)/0.10)] px-3 py-2 text-[12px] text-[rgb(var(--color-label-tertiary))]">
                      No matching route
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && currentUser && handlers.length === 0 && !error && (
        <p className="mt-4 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
          No trusted NIP-89 recommendations are cached for kind {event.kind} from you or the people you follow.
        </p>
      )}
    </div>
  )
}
