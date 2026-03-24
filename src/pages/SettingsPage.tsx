import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk'
import { useApp } from '@/contexts/app-context'
import { useMuteList } from '@/hooks/useMuteList'
import { useProfile } from '@/hooks/useProfile'
import { useUserStatus } from '@/hooks/useUserStatus'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { UserStatusBody } from '@/components/nostr/UserStatusBody'
import { AppearanceSettingsCard } from '@/components/cards/AppearanceSettingsCard'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'

function MutedUserRow({ pubkey }: { pubkey: string }) {
  const { profile } = useProfile(pubkey)
  return (
    <div className="rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3">
      <AuthorRow pubkey={pubkey} profile={profile} actions />
    </div>
  )
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, logout } = useApp()
  const { mutedPubkeys, loading: muteListLoading } = useMuteList()
  const [clearingStatus, setClearingStatus] = useState(false)
  
  // Load current music status to show it
  const { status: musicStatus } = useUserStatus(currentUser?.pubkey, {
    identifier: 'music',
    background: true
  })

  // Handle hash navigation (e.g. from ProfilePage "Music Status" link)
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

  const mutedList = Array.from(mutedPubkeys)

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

        {/* Content Filters Section */}
        <section>
          <h2 className="section-kicker px-1 mb-3">Content Filters</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            <button
              type="button"
              onClick={() => navigate('/filters')}
              className="flex w-full items-center justify-between text-left transition-opacity active:opacity-70"
            >
              <div>
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Keyword & Semantic Filters
                </p>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  Manage hidden words, hashtags, and AI-based safety filters.
                </p>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[rgb(var(--color-label-tertiary))]">
                <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </section>

        {/* Muted Users Section */}
        <section>
          <h2 className="section-kicker px-1 mb-3">Muted Users</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            {muteListLoading ? (
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">Loading muted users...</p>
            ) : mutedList.length === 0 ? (
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">You haven't muted anyone yet.</p>
            ) : (
              <div className="space-y-3">
                {mutedList.map((pubkey) => (
                  <MutedUserRow key={pubkey} pubkey={pubkey} />
                ))}
              </div>
            )}
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