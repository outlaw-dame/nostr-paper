import { useEffect, useMemo, useState } from 'react'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { useApp } from '@/contexts/app-context'
import { getBoostCarouselVisible, ZEN_SETTINGS_UPDATED_EVENT } from '@/lib/ui/zenSettings'
import type { BoostCarouselItem } from '@/lib/feed/boosts'

interface BoostCarouselProps {
  items: BoostCarouselItem[]
}

function formatBoostRecency(timestamp: number): string {
  const delta = Math.floor(Date.now() / 1000) - timestamp
  if (delta < 60) return 'just now'
  if (delta < 3_600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86_400) return `${Math.floor(delta / 3_600)}h ago`
  return `${Math.floor(delta / 86_400)}d ago`
}

export function BoostCarousel({ items }: BoostCarouselProps) {
  const { currentUser } = useApp()
  const scopeId = useMemo(() => currentUser?.pubkey ?? 'anon', [currentUser?.pubkey])
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(getBoostCarouselVisible(scopeId))

    const onUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ scopeId?: string }>
      if ((customEvent.detail?.scopeId ?? 'anon') !== scopeId) return
      setVisible(getBoostCarouselVisible(scopeId))
    }

    const onStorage = (event: StorageEvent) => {
      if (!event.key) return
      if (!event.key.endsWith(`:${scopeId}`)) return
      setVisible(getBoostCarouselVisible(scopeId))
    }

    window.addEventListener(ZEN_SETTINGS_UPDATED_EVENT, onUpdated as EventListener)
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(ZEN_SETTINGS_UPDATED_EVENT, onUpdated as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [scopeId])

  if (!visible || items.length === 0) return null

  return (
    <section className="relative overflow-hidden rounded-ios-xl bg-[rgb(var(--color-bg-secondary))] px-4 py-3">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-20 opacity-60"
        style={{
          background: 'radial-gradient(120% 120% at 0% 0%, rgba(var(--color-accent), 0.09), rgba(var(--color-accent), 0) 72%)',
        }}
      />
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="section-kicker">Boosts Carousel</p>
          <p className="mt-1 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
            Popular reposted posts, separated from the main feed.
          </p>
        </div>
        <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
          {items.length}
        </span>
      </div>

      <div className="mt-3 flex gap-3 overflow-x-auto pb-1 scrollbar-none">
        {items.map((item, index) => (
          <article
            key={item.targetEventId}
            className={`w-[320px] shrink-0 rounded-[20px] p-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)] ${index === 0
              ? 'bg-[linear-gradient(165deg,rgba(var(--color-accent),0.08),rgba(var(--color-bg),0.98))]'
              : 'bg-[rgb(var(--color-bg))]'}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="inline-flex items-center rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                {item.repostCount} repost{item.repostCount === 1 ? '' : 's'}
              </span>
              <div className="flex items-center gap-2">
                {index === 0 && (
                  <span className="rounded-full bg-[rgb(var(--color-accent)/0.12)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label))]">
                    Top boost
                  </span>
                )}
                <span className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                  {formatBoostRecency(item.lastBoostedAt)}
                </span>
              </div>
            </div>

            <EventPreviewCard event={item.targetEvent} compact className="!rounded-[14px]" />
          </article>
        ))}
      </div>
    </section>
  )
}
