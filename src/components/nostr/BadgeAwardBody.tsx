import { useEffect, useState } from 'react'
import {
  getFreshBadgeDefinition,
  parseBadgeAwardEvent,
  pickBadgeAsset,
  type BadgeDefinition,
} from '@/lib/nostr/badges'
import type { NostrEvent } from '@/types'

interface BadgeAwardBodyProps {
  event: NostrEvent
  className?: string
}

export function BadgeAwardBody({ event, className = '' }: BadgeAwardBodyProps) {
  const award = parseBadgeAwardEvent(event)
  const [definition, setDefinition] = useState<BadgeDefinition | null>(null)

  useEffect(() => {
    if (!award) {
      setDefinition(null)
      return
    }

    const controller = new AbortController()

    getFreshBadgeDefinition(award.badgeCoordinate, controller.signal)
      .then((badge) => {
        if (!controller.signal.aborted) {
          setDefinition(badge)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDefinition(null)
        }
      })

    return () => controller.abort()
  }, [award?.badgeCoordinate])

  if (!award) return null

  const previewAsset = definition ? pickBadgeAsset(definition, 128) : undefined
  const recipientCount = award.recipients.length
  const title = definition?.name ?? 'Badge award'
  const subtitle = definition?.description
  const note = award.note

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="rounded-[20px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] p-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          Badge Award
        </p>

        <div className="mt-3 flex items-start gap-4">
          {previewAsset ? (
            <img
              src={previewAsset.url}
              alt={definition?.name ?? 'Badge'}
              className="h-16 w-16 rounded-[18px] object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-[rgb(var(--color-fill)/0.12)] text-[22px] font-semibold text-[rgb(var(--color-label))]">
              ★
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
              {title}
            </h2>
            <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">
              Awarded to {recipientCount} profile{recipientCount === 1 ? '' : 's'}.
            </p>
            {subtitle && (
              <p className="mt-3 text-[15px] leading-7 text-[rgb(var(--color-label-secondary))]">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {note && (
          <p className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-[rgb(var(--color-label))]">
            {note}
          </p>
        )}
      </div>
    </div>
  )
}
