import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { useApp } from '@/contexts/app-context'
import { useUserStatus } from '@/hooks/useUserStatus'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { UserStatusBody } from '@/components/nostr/UserStatusBody'
import { AppearanceSettingsCard } from '@/components/cards/AppearanceSettingsCard'
import { getFeedResumeEnabled, setFeedResumeEnabled } from '@/lib/feed/resumeSettings'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'

export default function SettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, logout } = useApp()
  const [clearingStatus, setClearingStatus] = useState(false)
  const [resumeFeedPosition, setResumeFeedPosition] = useState(true)
  
  // Load current music status to show it
  const { status: musicStatus } = useUserStatus(currentUser?.pubkey, {
    identifier: 'music',
    background: true
  })

  // Handle hash navigation (e.g. from ProfilePage "Music Status" link)
  useEffect(() => {
    setResumeFeedPosition(getFeedResumeEnabled(currentUser?.pubkey ?? 'anon'))
  }, [currentUser?.pubkey])

  useEffect(() => {
    if (location.hash) {
      const element = document.getElementById(location.hash.slice(1))
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }, [location.hash])

  const handleLogout = () => {
    if (logout) {
      logout()
      navigate('/', { replace: true })
    }
  }

  const handleClearMusicStatus = async () => {
    if (!currentUser?.pubkey) return
    setClearingStatus(true)
    try {
      const ndk = getNDK()
      const event = new NDKEvent(ndk)
      event.kind = 30315
      event.tags = [['d', 'music']]
      event.content = '' // Empty content clears the status
      await withRetry(() => event.publish(), { maxAttempts: 3 })
    } catch (e) {
      console.error('Failed to clear music status', e)
      alert('Failed to clear status. Please try again.')
    } finally {
      setClearingStatus(false)
    }
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      {/* Sticky Header */}
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
            Settings
          </h1>
        </div>
      </div>

      <div className="space-y-8 pb-10 pt-2">
        {/* Account Section */}
        <section>
          <h2 className="section-kicker px-1 mb-3">Account</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            {currentUser ? (
              <div className="space-y-4">
                <div className="rounded-[16px] bg-[rgb(var(--color-bg-secondary))] p-3">
                  <AuthorRow pubkey={currentUser.pubkey} profile={null} />
                </div>
                <p className="text-[13px] text-[rgb(var(--color-label-secondary))] px-1">
                  You are signed in via NIP-07 extension. Keys remain secure in your wallet.
                </p>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full rounded-[14px] border border-[rgb(var(--color-system-red)/0.22)] bg-[rgb(var(--color-system-red)/0.08)] px-4 py-3 text-[15px] font-medium text-[rgb(var(--color-system-red))] transition-opacity active:opacity-75"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-[15px] text-[rgb(var(--color-label-secondary))]">
                  You are browsing in read-only mode.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/onboard')}
                  className="mt-4 rounded-[14px] bg-[rgb(var(--color-label))] px-6 py-2.5 text-[15px] font-medium text-white"
                >
                  Sign In
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Music Status Section */}
        <section id="music-status">
          <h2 className="section-kicker px-1 mb-3">Music Status</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            {musicStatus ? (
              <div className="space-y-4">
                <UserStatusBody event={musicStatus.event} />
                <button
                  type="button"
                  onClick={handleClearMusicStatus}
                  disabled={clearingStatus}
                  className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] font-medium text-[rgb(var(--color-label))] disabled:opacity-50"
                >
                  {clearingStatus ? 'Clearing...' : 'Clear Status'}
                </button>
              </div>
            ) : (
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                No active music status. Listening activity from compatible apps will appear here.
              </p>
            )}
          </div>
        </section>

        {/* Appearance Section */}
        <section>
          <h2 className="section-kicker px-1 mb-3">Appearance</h2>
          <AppearanceSettingsCard />
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">Feed</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            <label className="flex items-start gap-3">
              <div className="mt-0.5 flex-1">
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Resume where I left off
                </p>
                <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                  Return to your last read position in each feed section after refresh or reopening.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={resumeFeedPosition}
                onClick={() => {
                  const next = !resumeFeedPosition
                  setResumeFeedPosition(next)
                  setFeedResumeEnabled(next, currentUser?.pubkey ?? 'anon')
                }}
                className="
                  shrink-0 mt-0.5 w-11 h-6 rounded-full
                  transition-colors duration-200
                "
                style={{
                  backgroundColor: resumeFeedPosition
                    ? 'rgb(var(--color-system-green))'
                    : 'rgb(var(--color-fill-secondary) / 0.3)',
                }}
              >
                <span
                  className="block w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{ transform: `translateX(${resumeFeedPosition ? 22 : 2}px)` }}
                />
              </button>
            </label>
          </div>
        </section>

        {/* Moderation Section */}
        <section>
          <h2 className="section-kicker px-1 mb-3">Moderation</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            <button
              type="button"
              onClick={() => navigate('/settings/moderation')}
              className="flex w-full items-center justify-between text-left transition-opacity active:opacity-70"
            >
              <div>
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Content Filters & Muted Users
                </p>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  Open Settings / Moderation to manage filters, semantic controls, and muted users.
                </p>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[rgb(var(--color-label-tertiary))]">
                <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </section>

        {/* About / Version */}
        <section className="px-4 text-center">
          <p className="text-[13px] font-medium text-[rgb(var(--color-label-tertiary))]">
            Nostr Paper v0.1.0
          </p>
        </section>
      </div>
    </div>
  )
}