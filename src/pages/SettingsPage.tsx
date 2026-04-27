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
import {
  MUSIC_PRESENCE_SETTINGS_UPDATED_EVENT,
  getMusicPresenceAutopublishEnabled,
  setMusicPresenceAutopublishEnabled,
} from '@/lib/nostr/musicPresence'
import { getNDK } from '@/lib/nostr/ndk'
import { clearMusicStatus } from '@/lib/nostr/status'
import {
  getSpotifyClientId,
  setSpotifyClientId,
  getSpotifyTokens,
  clearSpotifyTokens,
  initiateSpotifyAuth,
  handleSpotifyCallback,
} from '@/lib/music/spotifyAuth'
import {
  isAppleMusicConfigured,
  getAppleMusicDeveloperTokenStatus,
  getAppleMusicUserToken,
  authorizeAppleMusic,
  unauthorizeAppleMusic,
} from '@/lib/music/appleMusicAuth'
import { withRetry } from '@/lib/retry'
import { sanitizeName, sanitizeText } from '@/lib/security/sanitize'
import { isGemmaAvailable } from '@/lib/gemma/client'
import { checkSmall100Health } from '@/lib/translation/engines/small100'
import { getBrowserLanguage } from '@/lib/translation/detect'
import { loadTranslationConfiguration, TRANSLATION_SETTINGS_UPDATED_EVENT } from '@/lib/translation/storage'
import { tApp } from '@/lib/i18n/app'

type TranslationHealthTone = 'ok' | 'warn'

export default function SettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentUser, logout } = useApp()
  const tagFeedScopeId = currentUser?.pubkey ?? 'anon'
  const savedTagFeeds = useSavedTagFeeds(tagFeedScopeId)
  const [clearingStatus, setClearingStatus] = useState(false)
  const [musicAutoPublishEnabled, setMusicAutoPublishEnabledState] = useState(false)
  const [spotifyConnected, setSpotifyConnected] = useState(() => getSpotifyTokens() !== null)
  const [spotifyClientIdDraft, setSpotifyClientIdDraft] = useState(() => getSpotifyClientId())
  const [spotifyConnecting, setSpotifyConnecting] = useState(false)
  const [appleMusicConnected, setAppleMusicConnected] = useState(() => getAppleMusicUserToken() !== null)
  const [appleMusicConnecting, setAppleMusicConnecting] = useState(false)
  const [musicServicesError, setMusicServicesError] = useState<string | null>(null)
  const appleMusicConfigured = isAppleMusicConfigured()
  const appleMusicDeveloperTokenStatus = getAppleMusicDeveloperTokenStatus()
  const appleMusicConfigurationIssue = appleMusicDeveloperTokenStatus.valid
    ? null
    : appleMusicDeveloperTokenStatus.reason
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
    setMusicAutoPublishEnabledState(getMusicPresenceAutopublishEnabled())
  }, [currentUser?.pubkey])

  useEffect(() => {
    const refreshMusicPresencePreference = () => {
      setMusicAutoPublishEnabledState(getMusicPresenceAutopublishEnabled())
    }

    window.addEventListener(MUSIC_PRESENCE_SETTINGS_UPDATED_EVENT, refreshMusicPresencePreference)
    window.addEventListener('storage', refreshMusicPresencePreference)
    return () => {
      window.removeEventListener(MUSIC_PRESENCE_SETTINGS_UPDATED_EVENT, refreshMusicPresencePreference)
      window.removeEventListener('storage', refreshMusicPresencePreference)
    }
  }, [])

  // Handle Spotify OAuth PKCE callback — Spotify redirects back here with ?code=&state=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const authError = params.get('error')
    if (authError) {
      setMusicServicesError('Spotify sign-in was canceled or denied. Please try again.')
      navigate('/settings', { replace: true })
      return
    }
    if (!code || !state) return

    const redirectUri = window.location.origin + '/settings'
    setSpotifyConnecting(true)
    setMusicServicesError(null)

    handleSpotifyCallback(code, state, redirectUri)
      .then(success => {
        setSpotifyConnected(success)
        if (!success) {
          setMusicServicesError('Spotify sign-in failed. Verify your Client ID and Redirect URI, then try again.')
        }
      })
      .catch(() => {
        setSpotifyConnected(false)
        setMusicServicesError('Spotify sign-in failed due to a network or authorization error.')
      })
      .finally(() => {
        setSpotifyConnecting(false)
        navigate('/settings', { replace: true })
      })
  }, [])

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
          case 'gemma': {
            if (!isGemmaAvailable()) {
              setHealth('Unavailable', `Gemma selected. Requires a configured local model and WebGPU. Browser: ${browserPrimary}.`, 'warn')
              return
            }
            setHealth('Configured', `Gemma on-device. Target: ${configuration.gemmaTargetLanguage}. Browser: ${browserPrimary}.`, 'ok')
            return
          }
          case 'gemini': {
            if (!configuration.geminiApiKey) {
              setHealth('Missing API key', `Gemini selected. Set an API key. Browser: ${browserPrimary}.`, 'warn')
              return
            }
            setHealth('Configured', `Gemini cloud translation. Model: ${configuration.geminiModel}. Target: ${configuration.geminiTargetLanguage}. Browser: ${browserPrimary}.`, 'ok')
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
      await clearMusicStatus()
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

  const handleMusicAutoPublishToggle = () => {
    const next = !musicAutoPublishEnabled
    setMusicAutoPublishEnabledState(next)
    setMusicPresenceAutopublishEnabled(next)
  }

  const handleSpotifyConnect = async () => {
    setMusicServicesError(null)
    const clientId = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim()
      || spotifyClientIdDraft
    if (!clientId) {
      setMusicServicesError('Enter a valid Spotify Client ID before connecting.')
      return
    }
    if (!import.meta.env.VITE_SPOTIFY_CLIENT_ID && spotifyClientIdDraft) {
      setSpotifyClientId(spotifyClientIdDraft)
    }
    const redirectUri = window.location.origin + '/settings'
    setSpotifyConnecting(true)
    try {
      await initiateSpotifyAuth(clientId, redirectUri)
      // Page navigates away to Spotify — no further action needed here.
    } catch {
      setMusicServicesError('Could not start Spotify OAuth. Confirm configuration and try again.')
      setSpotifyConnecting(false)
    }
  }

  const handleSpotifyDisconnect = () => {
    setMusicServicesError(null)
    clearSpotifyTokens()
    setSpotifyConnected(false)
  }

  const handleAppleMusicConnect = async () => {
    setMusicServicesError(null)
    setAppleMusicConnecting(true)
    try {
      const token = await authorizeAppleMusic()
      setAppleMusicConnected(token !== null)
      if (token === null) {
        setMusicServicesError('Apple Music authorization was not completed.')
      }
    } catch {
      setMusicServicesError('Apple Music connection failed. Please retry.')
    } finally {
      setAppleMusicConnecting(false)
    }
  }

  const handleAppleMusicDisconnect = async () => {
    setMusicServicesError(null)
    try {
      await unauthorizeAppleMusic()
      setAppleMusicConnected(false)
    } catch {
      setMusicServicesError('Apple Music disconnect failed. Please retry.')
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
            aria-label={tApp('settingsGoBack')}
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
            {tApp('settingsTitle')}
          </h1>
        </div>
      </div>

      <div className="space-y-8 pb-10 pt-2">
        {/* Account Section */}
        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('settingsAccount')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            {currentUser ? (
              <div className="space-y-4">
                <div className="rounded-[16px] bg-[rgb(var(--color-bg-secondary))] p-3">
                  <AuthorRow pubkey={currentUser.pubkey} profile={currentProfile} />
                </div>
                <div className="space-y-2">
                  <label className="block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
                    {tApp('settingsDisplayName')}
                  </label>
                  <input
                    type="text"
                    value={displayNameDraft}
                    onChange={(event) => {
                      setDisplayNameDraft(event.target.value)
                      setDisplayNameSaved(false)
                      setDisplayNameError(null)
                    }}
                    placeholder={tApp('settingsDisplayNamePlaceholder')}
                    className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                  />
                  <label className="mt-3 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
                    {tApp('settingsBio')}
                  </label>
                  <textarea
                    value={bioDraft}
                    onChange={(event) => {
                      handleBioChange(event.target.value)
                    }}
                    placeholder={tApp('settingsBioPlaceholder')}
                    rows={4}
                    className="mt-1 w-full resize-y rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveDisplayName()}
                    disabled={displayNameSaving}
                    className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[14px] font-medium text-[rgb(var(--color-label))] disabled:opacity-50"
                  >
                    {displayNameSaving ? tApp('settingsSaving') : tApp('settingsSaveProfile')}
                  </button>
                  {displayNameError && (
                    <p className="text-[13px] text-[rgb(var(--color-system-red))]">{displayNameError}</p>
                  )}
                  {displayNameSaved && !displayNameError && (
                    <p className="text-[13px] text-[rgb(var(--color-system-green))]">{tApp('settingsDisplayNamePublished')}</p>
                  )}
                </div>
                <p className="text-[13px] text-[rgb(var(--color-label-secondary))] px-1">
                  {tApp('settingsSignedInHint')}
                </p>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full rounded-[14px] border border-[rgb(var(--color-system-red)/0.22)] bg-[rgb(var(--color-system-red)/0.08)] px-4 py-3 text-[15px] font-medium text-[rgb(var(--color-system-red))] transition-opacity active:opacity-75"
                >
                  {tApp('settingsLogout')}
                </button>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-[15px] text-[rgb(var(--color-label-secondary))]">
                  {tApp('settingsReadOnlyMode')}
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/onboard')}
                  className="mt-4 rounded-[14px] bg-[rgb(var(--color-label))] px-6 py-2.5 text-[15px] font-medium text-white"
                >
                  {tApp('settingsSignIn')}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Music Status Section */}
        <section id="music-status">
          <h2 className="section-kicker px-1 mb-3">{tApp('settingsMusicStatus')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            <label className="mb-4 flex items-start gap-3">
              <div className="mt-0.5 flex-1">
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  {tApp('settingsAutoPublishNowPlaying')}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                  {tApp('settingsAutoPublishDescription')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={musicAutoPublishEnabled}
                onClick={handleMusicAutoPublishToggle}
                className="shrink-0 mt-0.5 w-11 h-6 rounded-full transition-colors duration-200"
                style={{
                  backgroundColor: musicAutoPublishEnabled
                    ? 'rgb(var(--color-system-green))'
                    : 'rgb(var(--color-fill-secondary) / 0.3)',
                }}
              >
                <span
                  className="block w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{ transform: `translateX(${musicAutoPublishEnabled ? 22 : 2}px)` }}
                />
              </button>
            </label>

            {musicStatus ? (
              <div className="space-y-4">
                <UserStatusBody event={musicStatus.event} />
                <button
                  type="button"
                  onClick={handleClearMusicStatus}
                  disabled={clearingStatus}
                  className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] font-medium text-[rgb(var(--color-label))] disabled:opacity-50"
                >
                  {clearingStatus ? tApp('settingsClearing') : tApp('settingsClearStatus')}
                </button>
              </div>
            ) : (
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                {tApp('settingsNoMusicStatus')}
              </p>
            )}
          </div>
        </section>

        {/* Connected Music Services Section */}
        <section id="music-services">
          <h2 className="section-kicker px-1 mb-3">{tApp('settingsConnectedMusicServices')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-6">

            {/* Browser Auto-detect */}
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">{tApp('settingsBrowserAutoDetect')}</p>
                <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                  Passively reads what&apos;s playing via the Web Media Session API — works with Spotify Web, Apple Music, YouTube, and more with no sign-in required.
                </p>
              </div>
              <span className="mt-0.5 shrink-0 rounded-full bg-[rgb(var(--color-system-green)/0.15)] px-2.5 py-0.5 text-[12px] font-medium text-[rgb(var(--color-system-green))]">
                {tApp('settingsAlwaysOn')}
              </span>
            </div>

            <div className="h-px bg-[rgb(var(--color-fill)/0.1)]" />

            {/* Spotify */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">Spotify</p>
                  <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                    Shares what&apos;s playing across all your Spotify clients — desktop, mobile, and web. Uses OAuth 2.0 PKCE; no password is stored.
                  </p>
                </div>
                {spotifyConnected && (
                  <span className="mt-0.5 shrink-0 rounded-full bg-[rgb(var(--color-system-green)/0.15)] px-2.5 py-0.5 text-[12px] font-medium text-[rgb(var(--color-system-green))]">
                    {tApp('settingsConnected')}
                  </span>
                )}
              </div>

              {!spotifyConnected ? (
                <div className="space-y-2">
                  {!import.meta.env.VITE_SPOTIFY_CLIENT_ID && (
                    <div>
                      <label className="block text-[13px] font-medium text-[rgb(var(--color-label-secondary))] mb-1">
                        Spotify Client ID
                      </label>
                      <input
                        type="text"
                        value={spotifyClientIdDraft}
                        onChange={e => setSpotifyClientIdDraft(e.target.value.trim())}
                        placeholder="Paste your Spotify app Client ID"
                        className="w-full rounded-[10px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-system-blue)/0.4)]"
                      />
                      <p className="mt-1 text-[11px] text-[rgb(var(--color-label-tertiary))]">
                        Create a free app at{' '}
                        <a
                          href="https://developer.spotify.com/dashboard"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          developer.spotify.com/dashboard
                        </a>
                        {' '}and add <code>{window.location.origin}/settings</code> as a Redirect URI.
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => { void handleSpotifyConnect() }}
                    disabled={spotifyConnecting || (!import.meta.env.VITE_SPOTIFY_CLIENT_ID && !spotifyClientIdDraft)}
                    className="rounded-[14px] bg-[rgb(var(--color-system-green))] px-5 py-2.5 text-[14px] font-medium text-white disabled:opacity-40"
                  >
                    {spotifyConnecting ? 'Connecting…' : 'Connect Spotify'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleSpotifyDisconnect}
                  className="rounded-[14px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-5 py-2.5 text-[14px] font-medium text-[rgb(var(--color-system-red))]"
                >
                  Disconnect Spotify
                </button>
              )}
            </div>

            {musicServicesError && (
              <p className="text-[13px] text-[rgb(var(--color-system-red))]">
                {musicServicesError}
              </p>
            )}

            <div className="h-px bg-[rgb(var(--color-fill)/0.1)]" />

            {/* Apple Music */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">Apple Music</p>
                  <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                    {appleMusicConfigured
                      ? 'Connect via MusicKit JS. Note: this reads music playing within this app only. For music.apple.com playback in another tab, Browser Auto-detect handles that automatically.'
                      : appleMusicConfigurationIssue === 'expired'
                        ? 'Apple Music developer token is expired. Rotate VITE_APPLE_MUSIC_DEVELOPER_TOKEN to re-enable sign-in.'
                        : appleMusicConfigurationIssue === 'invalid-format'
                          ? 'Apple Music developer token is malformed. Set a valid MusicKit JWT in VITE_APPLE_MUSIC_DEVELOPER_TOKEN.'
                          : 'Requires a MusicKit developer token set by the app operator (VITE_APPLE_MUSIC_DEVELOPER_TOKEN). Self-hosted deployments can generate one from the Apple Developer portal.'}
                  </p>
                </div>
                {appleMusicConnected && (
                  <span className="mt-0.5 shrink-0 rounded-full bg-[rgb(var(--color-system-green)/0.15)] px-2.5 py-0.5 text-[12px] font-medium text-[rgb(var(--color-system-green))]">
                    {tApp('settingsConnected')}
                  </span>
                )}
              </div>

              {appleMusicConfigured ? (
                !appleMusicConnected ? (
                  <button
                    type="button"
                    onClick={() => { void handleAppleMusicConnect() }}
                    disabled={appleMusicConnecting}
                    className="rounded-[14px] bg-[rgb(var(--color-label))] px-5 py-2.5 text-[14px] font-medium text-[rgb(var(--color-bg))] disabled:opacity-40"
                  >
                    {appleMusicConnecting ? 'Connecting…' : 'Connect Apple Music'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { void handleAppleMusicDisconnect() }}
                    className="rounded-[14px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-5 py-2.5 text-[14px] font-medium text-[rgb(var(--color-system-red))]"
                  >
                    Disconnect Apple Music
                  </button>
                )
              ) : (
                <span className="inline-block rounded-full bg-[rgb(var(--color-fill-secondary)/0.2)] px-2.5 py-0.5 text-[12px] text-[rgb(var(--color-label-tertiary))]">
                  Not configured
                </span>
              )}
            </div>

          </div>
        </section>

        {/* Appearance Section */}
        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('settingsAppearance')}</h2>
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
          <h2 className="section-kicker px-1 mb-3">{tApp('settingsFeed')}</h2>
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
              onClick={() => navigate('/settings/feed-controls')}
              className="flex w-full items-center justify-between text-left transition-opacity active:opacity-70"
            >
              <div>
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Feed Controls & Algorithms
                </p>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  Review ranking formulas for trending topics, suggested accounts, and follow packs.
                </p>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[rgb(var(--color-label-tertiary))]">
                <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <button
              type="button"
              onClick={() => navigate('/settings/syndication')}
              className="flex w-full items-center justify-between text-left transition-opacity active:opacity-70"
            >
              <div>
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  Syndication Feeds
                </p>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  Save and verify RSS, Atom, RDF, JSON Feed, and podcast links.
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
                    {tApp('settingsTranslations')}
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
          <h2 className="section-kicker px-1 mb-3">{tApp('settingsMedia')}</h2>
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
          <h2 className="section-kicker px-1 mb-3">{tApp('settingsNetwork')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            <button
              type="button"
              onClick={() => navigate('/settings/relays')}
              className="flex w-full items-center justify-between text-left transition-opacity active:opacity-70"
            >
              <div>
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  {tApp('settingsRelays')}
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

        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('settingsDeveloper')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            <button
              type="button"
              onClick={() => navigate('/settings/debug')}
              className="flex w-full items-center justify-between text-left transition-opacity active:opacity-70"
            >
              <div>
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  {tApp('settingsDebugDiagnostics')}
                </p>
                <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                  Inspect startup telemetry, last boot failure, and copy diagnostics JSON for troubleshooting.
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
          <h2 className="section-kicker px-1 mb-3">{tApp('settingsModeration')}</h2>
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
