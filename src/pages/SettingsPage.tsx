import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { useApp } from '@/contexts/app-context'
import { useProfile } from '@/hooks/useProfile'
import { useSavedTagFeeds } from '@/hooks/useSavedTagFeeds'
import { useUserStatus } from '@/hooks/useUserStatus'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { UserStatusBody } from '@/components/nostr/UserStatusBody'
import { BlossomServerManager } from '@/components/blossom/BlossomServerManager'
import { getFeedResumeEnabled, setFeedResumeEnabled } from '@/lib/feed/resumeSettings'
import { getFeedInlineMediaAutoplayEnabled, setFeedInlineMediaAutoplayEnabled } from '@/lib/ui/zenSettings'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import { sanitizeName, sanitizeText } from '@/lib/security/sanitize'
import { checkSmall100Health } from '@/lib/translation/engines/small100'
import { getBrowserLanguage } from '@/lib/translation/detect'
import { loadTranslationConfiguration, TRANSLATION_SETTINGS_UPDATED_EVENT } from '@/lib/translation/storage'

type TranslationHealthTone = 'ok' | 'warn'

export default function SettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, logout } = useApp()
  const tagFeedScopeId = currentUser?.pubkey ?? 'anon'
  const savedTagFeeds = useSavedTagFeeds(tagFeedScopeId)
  const [clearingStatus, setClearingStatus] = useState(false)
  const [resumeFeedPosition, setResumeFeedPosition] = useState(true)
  const [feedInlineAutoplayEnabled, setFeedInlineAutoplayEnabledState] = useState(true)
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [bioDraft, setBioDraft] = useState('')
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [displayNameSaved, setDisplayNameSaved] = useState(false)
  const [translationHealthLabel, setTranslationHealthLabel] = useState('Checking…')
  const [translationHealthDetail, setTranslationHealthDetail] = useState('Inspecting translation provider configuration.')
  const [translationHealthTone, setTranslationHealthTone] = useState<TranslationHealthTone>('ok')
  const { profile: currentProfile } = useProfile(currentUser?.pubkey, { background: false })
  
  // Load current music status to show it
  const { status: musicStatus } = useUserStatus(currentUser?.pubkey, {
    identifier: 'music',
    background: true
  })

  // Handle hash navigation (e.g. from ProfilePage "Music Status" link)
  useEffect(() => {
    setResumeFeedPosition(getFeedResumeEnabled(currentUser?.pubkey ?? 'anon'))
    setFeedInlineAutoplayEnabledState(getFeedInlineMediaAutoplayEnabled(currentUser?.pubkey ?? 'anon'))
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
    setBioDraft(currentProfile?.about ?? '')
  }, [currentProfile?.about, currentProfile?.display_name])

  useEffect(() => {
    let cancelled = false

    const refreshTranslationHealth = async () => {
      try {
        const configuration = await loadTranslationConfiguration()
        if (cancelled) return

        const browserLanguage = (getBrowserLanguage() ?? 'en').toLowerCase()
        const browserPrimary = browserLanguage.split('-')[0] ?? browserLanguage

        const setHealth = (label: string, detail: string, tone: TranslationHealthTone) => {
          setTranslationHealthLabel(label)
          setTranslationHealthDetail(detail)
          setTranslationHealthTone(tone)
        }

        switch (configuration.provider) {
          case 'deepl': {
            if (!configuration.deeplAuthKey) {
              setHealth('Missing key', `DeepL selected. Add API key in Translations settings. Browser: ${browserPrimary}.`, 'warn')
              return
            }
            setHealth('Configured', `DeepL ready. Target: ${configuration.deeplTargetLanguage.toLowerCase()}. Browser: ${browserPrimary}.`, 'ok')
            return
          }
          case 'libretranslate': {
            if (!configuration.libreBaseUrl) {
              setHealth('Missing endpoint', `LibreTranslate selected. Set instance URL. Browser: ${browserPrimary}.`, 'warn')
              return
            }
            setHealth('Configured', `LibreTranslate ready. Target: ${configuration.libreTargetLanguage}. Browser: ${browserPrimary}.`, 'ok')
            return
          }
          case 'translang': {
            if (!configuration.translangBaseUrl) {
              setHealth('Missing endpoint', `TransLang selected. Set instance URL. Browser: ${browserPrimary}.`, 'warn')
              return
            }
            setHealth('Configured', `TransLang ready. Target: ${configuration.translangTargetLanguage}. Browser: ${browserPrimary}.`, 'ok')
            return
          }
          case 'lingva': {
            if (!configuration.lingvaBaseUrl) {
              setHealth('Missing endpoint', `Lingva selected. Set instance URL. Browser: ${browserPrimary}.`, 'warn')
              return
            }
            setHealth('Configured', `Lingva ready. Target: ${configuration.lingvaTargetLanguage}. Browser: ${browserPrimary}.`, 'ok')
            return
          }
          case 'small100': {
            if (!configuration.small100BaseUrl) {
              setHealth('Missing endpoint', `SMaLL-100 selected. Set daemon URL. Browser: ${browserPrimary}.`, 'warn')
              return
            }
            const healthy = await checkSmall100Health(configuration.small100BaseUrl)
            if (cancelled) return
            if (!healthy) {
              setHealth('Offline daemon', `SMaLL-100 at ${configuration.small100BaseUrl} is unreachable.`, 'warn')
              return
            }
            setHealth('Configured', `SMaLL-100 reachable. Target: ${configuration.small100TargetLanguage}. Browser: ${browserPrimary}.`, 'ok')
            return
          }
          case 'opusmt': {
            setHealth('Configured', `Opus-MT in-browser. Target: ${configuration.opusMtTargetLanguage}. Browser: ${browserPrimary}.`, 'ok')
            return
          }
        }
      } catch {
        if (cancelled) return
        setTranslationHealthLabel('Unavailable')
        setTranslationHealthDetail('Could not load translation configuration.')
        setTranslationHealthTone('warn')
      }
    }

    void refreshTranslationHealth()

    const handleUpdated = () => {
      void refreshTranslationHealth()
    }

    window.addEventListener(TRANSLATION_SETTINGS_UPDATED_EVENT, handleUpdated)
    return () => {
      cancelled = true
      window.removeEventListener(TRANSLATION_SETTINGS_UPDATED_EVENT, handleUpdated)
    }
  }, [])

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
    const sanitizedBio = sanitizeText(bioDraft)
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
        about: sanitizedBio,
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

  const handleBioChange = (value: string) => {
    setBioDraft(value)
    setDisplayNameSaved(false)
    setDisplayNameError(null)
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
                  <label className="mt-3 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
                    Bio
                  </label>
                  <textarea
                    value={bioDraft}
                    onChange={(event) => {
                      handleBioChange(event.target.value)
                    }}
                    placeholder="Tell people a little about yourself"
                    rows={4}
                    className="mt-1 w-full resize-y rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveDisplayName()}
                    disabled={displayNameSaving}
                    className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[14px] font-medium text-[rgb(var(--color-label))] disabled:opacity-50"
                  >
                    {displayNameSaving ? 'Saving...' : 'Save Profile'}
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

            <label className="flex items-start gap-3">
              <div className="mt-0.5 flex-1">
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Inline video autoplay in feed (Experimental)
                </p>
                <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                  Automatically play inline videos while scrolling the main feed. This is high load and may reduce stability on busy tag feeds or unreliable networks.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={feedInlineAutoplayEnabled}
                onClick={() => {
                  const next = !feedInlineAutoplayEnabled
                  setFeedInlineAutoplayEnabledState(next)
                  setFeedInlineMediaAutoplayEnabled(next, currentUser?.pubkey ?? 'anon')
                }}
                className="
                  shrink-0 mt-0.5 w-11 h-6 rounded-full
                  transition-colors duration-200
                "
                style={{
                  backgroundColor: feedInlineAutoplayEnabled
                    ? 'rgb(var(--color-system-green))'
                    : 'rgb(var(--color-fill-secondary) / 0.3)',
                }}
              >
                <span
                  className="block w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{ transform: `translateX(${feedInlineAutoplayEnabled ? 22 : 2}px)` }}
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

            <button
              type="button"
              onClick={() => navigate('/settings/translations')}
              className="flex w-full items-center justify-between text-left transition-opacity active:opacity-70"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                    Translations
                  </p>
                  <span
                    className={`rounded-full px-2 py-[2px] text-[11px] font-semibold ${translationHealthTone === 'ok' ? 'bg-[rgb(var(--color-system-green)/0.14)] text-[rgb(var(--color-system-green))]' : 'bg-[rgb(var(--color-system-orange)/0.18)] text-[rgb(var(--color-system-orange))]'}`}
                  >
                    {translationHealthLabel}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  {translationHealthDetail}
                </p>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[rgb(var(--color-label-tertiary))]">
                <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </section>

        {/* Media Servers Section */}
        <section>
          <h2 className="section-kicker px-1 mb-3">Media</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            <div className="space-y-4">
              <div>
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Blossom Media Servers
                </p>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  Configure where your photos, videos, and files are uploaded.
                </p>
              </div>
              <BlossomServerManager />
            </div>
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
