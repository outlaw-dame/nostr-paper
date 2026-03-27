import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppearanceSettingsCard } from '@/components/cards/AppearanceSettingsCard'
import { useApp } from '@/contexts/app-context'
import {
  getRepostCarouselVisible,
  getMetricsVisible,
  setRepostCarouselVisible,
  setMetricsVisible,
} from '@/lib/ui/zenSettings'

export default function AppearancePage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()

  const scopeId = useMemo(() => currentUser?.pubkey ?? 'anon', [currentUser?.pubkey])
  const [metricsVisible, setMetricsVisibleState] = useState(true)
  const [repostCarouselVisible, setRepostCarouselVisibleState] = useState(true)

  useEffect(() => {
    setMetricsVisibleState(getMetricsVisible(scopeId))
    setRepostCarouselVisibleState(getRepostCarouselVisible(scopeId))
  }, [scopeId])

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
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
          <h1 className="text-[20px] font-semibold text-[rgb(var(--color-label))]">
            Appearance
          </h1>
        </div>
      </div>

      <div className="space-y-8 pb-10 pt-2">
        <section>
          <h2 className="section-kicker px-1 mb-3">Theme</h2>
          <AppearanceSettingsCard />
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">Zen</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-5">
            <label className="flex items-start gap-3">
              <div className="mt-0.5 flex-1">
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Show post metrics
                </p>
                <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                  Turn off reply, repost, like, and bookmark metrics to keep Feed and Explore visually quiet.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={metricsVisible}
                onClick={() => {
                  const next = !metricsVisible
                  setMetricsVisibleState(next)
                  setMetricsVisible(next, scopeId)
                }}
                className="
                  shrink-0 mt-0.5 w-11 h-6 rounded-full
                  transition-colors duration-200
                "
                style={{
                  backgroundColor: metricsVisible
                    ? 'rgb(var(--color-system-green))'
                    : 'rgb(var(--color-fill-secondary) / 0.3)',
                }}
              >
                <span
                  className="block w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{ transform: `translateX(${metricsVisible ? 22 : 2}px)` }}
                />
              </button>
            </label>

            <label className="flex items-start gap-3">
              <div className="mt-0.5 flex-1">
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Show repost highlights
                </p>
                <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                  Hide the repost highlights rail for a simpler, minimal feed layout.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={repostCarouselVisible}
                onClick={() => {
                  const next = !repostCarouselVisible
                  setRepostCarouselVisibleState(next)
                  setRepostCarouselVisible(next, scopeId)
                }}
                className="
                  shrink-0 mt-0.5 w-11 h-6 rounded-full
                  transition-colors duration-200
                "
                style={{
                  backgroundColor: repostCarouselVisible
                    ? 'rgb(var(--color-system-green))'
                    : 'rgb(var(--color-fill-secondary) / 0.3)',
                }}
              >
                <span
                  className="block w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{ transform: `translateX(${repostCarouselVisible ? 22 : 2}px)` }}
                />
              </button>
            </label>
          </div>
        </section>
      </div>
    </div>
  )
}
