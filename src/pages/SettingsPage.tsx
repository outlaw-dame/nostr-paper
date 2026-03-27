import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useApp } from '@/contexts/app-context'
import { useProfile } from '@/hooks/useProfile'
import { useSavedTagFeeds } from '@/hooks/useSavedTagFeeds'
import { useUserStatus } from '@/hooks/useUserStatus'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { UserStatusBody } from '@/components/nostr/UserStatusBody'
import { getFeedResumeEnabled, setFeedResumeEnabled } from '@/lib/feed/resumeSettings'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import { sanitizeName } from '@/lib/security/sanitize'

export default function SettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, logout } = useApp()
  const tagFeedScopeId = currentUser?.pubkey ?? 'anon'
  const savedTagFeeds = useSavedTagFeeds(tagFeedScopeId)
  const [clearingStatus, setClearingStatus] = useState(false)
  const [resumeFeedPosition, setResumeFeedPosition] = useState(true)
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [displayNameSaved, setDisplayNameSaved] = useState(false)
  const { profile: currentProfile } = useProfile(currentUser?.pubkey, { background: false })
  
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

  useEffect(() => {
    setDisplayNameDraft(currentProfile?.display_name ?? '')
  }, [currentProfile?.display_name])

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

  const handleSaveDisplayName = async () => {
    if (!currentUser?.pubkey) return

    const sanitizedDisplayName = sanitizeName(displayNameDraft)
    setDisplayNameSaving(true)
    setDisplayNameError(null)
    setDisplayNameSaved(false)

    try {
      const ndk = getNDK()
      const event = new NDKEvent(ndk)
      event.kind = 0

      const content = {
        name: currentProfile?.name ?? '',
        display_name: sanitizedDisplayName,
        about: currentProfile?.about ?? '',
        website: currentProfile?.website ?? '',
        picture: currentProfile?.picture ?? '',
        banner: currentProfile?.banner ?? '',
        nip05: currentProfile?.nip05 ?? '',
        lud16: currentProfile?.lud16 ?? '',
      }

      event.content = JSON.stringify(content)
      await withRetry(() => event.publish(), { maxAttempts: 3 })
      setDisplayNameSaved(true)
    } catch (error) {
      console.error('Failed to publish display name', error)
      setDisplayNameError(error instanceof Error ? error.message : 'Failed to update display name.')
    } finally {
      setDisplayNameSaving(false)
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
                  <AuthorRow pubkey={currentUser.pubkey} profile={currentProfile} />
                </div>
                <div className="space-y-2">
                  <label className="block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayNameDraft}
                    onChange={(event) => {
                      setDisplayNameDraft(event.target.value)
                      setDisplayNameSaved(false)
                      setDisplayNameError(null)
                    }}
                    placeholder="How your name appears"
                    className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveDisplayName()}
                    disabled={displayNameSaving}
                    className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[14px] font-medium text-[rgb(var(--color-label))] disabled:opacity-50"
                  >
                    {displayNameSaving ? 'Saving...' : 'Save Display Name'}
                  </button>
                  {displayNameError && (
                    <p className="text-[13px] text-[rgb(var(--color-system-red))]">{displayNameError}</p>
                  )}
                  {displayNameSaved && !displayNameError && (
                    <p className="text-[13px] text-[rgb(var(--color-system-green))]">Display name published.</p>
                  )}
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
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            <button
              type="button"
              onClick={() => navigate('/settings/appearance')}
              className="flex w-full items-center justify-between text-left transition-opacity active:opacity-70"
            >
              <div>
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Theme & Zen Controls
                </p>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  Manage theme and Zen options including post metrics visibility.
                </p>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[rgb(var(--color-label-tertiary))]">
                <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">Feed</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-4">
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

            <button
              type="button"
              onClick={() => navigate('/settings/tag-feeds')}
              className="flex w-full items-center justify-between text-left transition-opacity active:opacity-70"
            >
              <div>
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Tag Feeds
                </p>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  {savedTagFeeds.length === 0
                    ? 'Create saved tag feeds that appear in the main Feed rail.'
                    : `${savedTagFeeds.length} saved ${savedTagFeeds.length === 1 ? 'feed' : 'feeds'} ready for the main Feed rail.`}
                </p>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[rgb(var(--color-label-tertiary))]">
                <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </section>

        {/* Relays Section */}
        <section>
          <h2 className="section-kicker px-1 mb-3">Network</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            <button
              type="button"
              onClick={() => navigate('/settings/relays')}
              className="flex w-full items-center justify-between text-left transition-opacity active:opacity-70"
            >
              <div>
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Relays
                </p>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  Add, remove, and monitor WebSocket relay connections.
                </p>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[rgb(var(--color-label-tertiary))]">
                <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
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
