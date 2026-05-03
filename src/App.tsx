/**
 * App Root
 *
 * Composes:
 * - AppProvider (global state + bootstrap)
 * - React Router
 * - Konsta UI App shell (iOS theme)
 * - PWA update banner
 * - Global error boundary
 */

import React, { useEffect, useState, Suspense, lazy, Component, type ReactNode, type ErrorInfo } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App as KonstaApp } from 'konsta/react'
import { AppProvider } from '@/contexts/AppContext'
import { useApp } from '@/contexts/app-context'
import { ComposeSheet } from '@/components/compose/ComposeSheet'
import { BootSplash } from '@/components/layout/BootSplash'
import { MusicPresencePublisher } from '@/components/nostr/MusicPresencePublisher'
import { UpdateBanner } from '@/components/ui/UpdateBanner'
import { ErrorScreen } from '@/components/ui/ErrorScreen'
import { OfflineBanner } from '@/components/ui/OfflineBanner'
import { GlobalImageLightbox } from '@/components/ui/GlobalImageLightbox'

// ── Error Boundary ────────────────────────────────────────────

interface ErrorBoundaryState {
  error: Error | null
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary] Render error caught:', error, info.componentStack)
  }

  override render() {
    if (this.state.error) {
      return (
        <ErrorScreen
          code="RENDER_ERROR"
          message={this.state.error.message || 'An unexpected error occurred while rendering.'}
        />
      )
    }
    return this.props.children
  }
}

// Lazy-loaded pages (code-split per route)
const FeedPage    = lazy(() => import('@/pages/FeedPage'))
const SearchPage  = lazy(() => import('@/pages/SearchPage'))
const AddressPage = lazy(() => import('@/pages/AddressPage'))
const ArticlePage = lazy(() => import('@/pages/ArticlePage'))
const VideoPage   = lazy(() => import('@/pages/VideoPage'))
const DvmComposePage = lazy(() => import('@/pages/DvmComposePage'))
const ListComposePage = lazy(() => import('@/pages/ListComposePage'))
const PollComposePage = lazy(() => import('@/pages/PollComposePage'))
const VideoComposePage = lazy(() => import('@/pages/VideoComposePage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const NotePage    = lazy(() => import('@/pages/NotePage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const DebugPage = lazy(() => import('@/pages/DebugPage'))
const AppearancePage = lazy(() => import('@/pages/AppearancePage'))
const ModerationPage = lazy(() => import('@/pages/ModerationPage'))
const TagFeedsPage = lazy(() => import('@/pages/TagFeedsPage'))
const FiltersPage  = lazy(() => import('@/pages/FiltersPage'))
const RelaysPage   = lazy(() => import('@/pages/RelaysPage'))
const TranslationsPage = lazy(() => import('@/pages/TranslationsPage'))
const FeedControlsPage = lazy(() => import('@/pages/FeedControlsPage'))
const SyndicationFeedsPage = lazy(() => import('@/pages/SyndicationFeedsPage'))
const ActivityPage = lazy(() => import('@/pages/ActivityPage'))
const OnboardPage  = lazy(() => import('@/pages/OnboardPage'))
const ExplorePage  = lazy(() => import('@/pages/ExplorePage'))
const ArticleComposePage = lazy(() => import('@/pages/ArticleComposePage'))
const DmInboxPage = lazy(() => import('@/pages/DmInboxPage'))
const DmThreadPage = lazy(() => import('@/pages/DmThreadPage'))
const DmComposePage = lazy(() => import('@/pages/DmComposePage'))
const LinkTimelinePage = lazy(() => import('@/pages/LinkTimelinePage'))

const COMPOSE_SHEET_ROUTE = {
  pathname: '/',
  search: '?compose=1',
} as const

// ── Inner App (access to context) ────────────────────────────

function InnerApp() {
  const { status, errors, isOnline } = useApp()
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [applyUpdate, setApplyUpdate] = useState<(() => Promise<void>) | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ applyUpdate?: () => Promise<void> }>
      setApplyUpdate(() => customEvent.detail?.applyUpdate ?? null)
      setUpdateAvailable(true)
    }
    window.addEventListener('pwa-update-available', handler as EventListener)
    return () => window.removeEventListener('pwa-update-available', handler as EventListener)
  }, [])

  if (status === 'idle' || status === 'booting') {
    return <BootSplash />
  }

  if (status === 'error') {
    const lastError = errors[errors.length - 1]
    const isDbError = lastError?.message?.includes('DB_INIT_FAILED') || 
                      lastError?.message?.includes('Query timeout') ||
                      lastError?.code === 'DB_INIT_FAILED'

    if (isDbError) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[rgb(var(--color-bg))] p-6 text-center">
          <div className="mb-4 text-[48px]">💾</div>
          <h1 className="text-[22px] font-semibold text-[rgb(var(--color-label))]">
            Database Error
          </h1>
          <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
            The local database failed to initialize. This can happen during development updates.
          </p>
          <p className="mt-4 max-w-md break-all rounded bg-[rgb(var(--color-system-red)/0.08)] p-2 font-mono text-[12px] text-[rgb(var(--color-system-red))]">
            {lastError?.message ?? 'Unknown database error'}
          </p>
          <button
            type="button"
            onClick={async () => {
              try {
                const root = await navigator.storage.getDirectory()
                for await (const name of (root as unknown as { keys: () => AsyncIterable<string> }).keys()) {
                  await root.removeEntry(name, { recursive: true })
                }
                window.location.reload()
              } catch {
                window.alert('Failed to clear data automatically. Please clear site data in DevTools > Application.')
              }
            }}
            className="mt-8 rounded-full bg-[rgb(var(--color-label))] px-6 py-3 text-[15px] font-medium text-[rgb(var(--color-bg))] active:opacity-80"
          >
            Reset Database & Reload
          </button>
        </div>
      )
    }

    return (
      <ErrorScreen
        {...(lastError?.code !== undefined ? { code: lastError.code } : {})}
        message={lastError?.message ?? 'An unexpected error occurred.'}
      />
    )
  }

  return (
    <>
      {!isOnline && <OfflineBanner />}
      {updateAvailable && (
        <UpdateBanner
          {...(applyUpdate ? { onUpdate: applyUpdate } : {})}
          onDismiss={() => setUpdateAvailable(false)}
        />
      )}

      <Suspense fallback={<BootSplash minimal />}>
        <Routes>
          <Route path="/"                   element={<FeedPage />} />
          <Route path="/t/:tag"             element={<FeedPage />} />
          <Route path="/compose"            element={<Navigate to={COMPOSE_SHEET_ROUTE} replace />} />
          <Route path="/article/new"        element={<ArticleComposePage />} />
          <Route path="/compose/article"    element={<Navigate to="/article/new" replace />} />
          <Route path="/compose/video"      element={<Navigate to="/video/new" replace />} />
          <Route path="/compose/poll"       element={<Navigate to="/poll/new" replace />} />
          <Route path="/compose/list"       element={<Navigate to="/list/new" replace />} />
          <Route path="/search"             element={<SearchPage />} />
          <Route path="/explore"            element={<ExplorePage />} />
          <Route path="/link"               element={<LinkTimelinePage />} />
          <Route path="/draft/:pubkey/:identifier" element={<ArticlePage />} />
          <Route path="/article/:pubkey/:identifier" element={<ArticlePage />} />
          <Route path="/dvm/new"           element={<DvmComposePage />} />
          <Route path="/list/new"          element={<ListComposePage />} />
          <Route path="/poll/new"          element={<PollComposePage />} />
          <Route path="/video/new"         element={<VideoComposePage />} />
          <Route path="/video/:id"          element={<VideoPage />} />
          <Route path="/video/:variant/:pubkey/:identifier" element={<VideoPage />} />
          <Route path="/a/:naddr"            element={<AddressPage />} />
          <Route path="/note/:id"            element={<NotePage />} />
          <Route path="/profile"             element={<ProfilePage />} />
          <Route path="/profile/:pubkey"     element={<ProfilePage />} />
          <Route path="/activity"            element={<ActivityPage />} />
          <Route path="/dm"                  element={<DmInboxPage />} />
          <Route path="/dm/compose"          element={<DmComposePage />} />
          <Route path="/dm/:pubkey"          element={<DmThreadPage />} />
          <Route path="/settings"            element={<SettingsPage />} />
          <Route path="/settings/debug"      element={<DebugPage />} />
          <Route path="/settings/appearance" element={<AppearancePage />} />
          <Route path="/settings/moderation" element={<ModerationPage />} />
          <Route path="/settings/tag-feeds"  element={<TagFeedsPage />} />
          <Route path="/settings/feed-controls" element={<FeedControlsPage />} />
          <Route path="/settings/syndication" element={<SyndicationFeedsPage />} />
          <Route path="/settings/translations" element={<TranslationsPage />} />
          <Route path="/settings/moderation/filters" element={<FiltersPage />} />
          <Route path="/settings/relays"     element={<RelaysPage />} />
          <Route path="/filters"             element={<Navigate to="/settings/moderation/filters" replace />} />
          <Route path="/onboard"             element={<OnboardPage />} />
          <Route path="*"                    element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>

      <ComposeSheet />
      <MusicPresencePublisher />
      <GlobalImageLightbox />
    </>
  )
}

// ── Root App ─────────────────────────────────────────────────

export default function App() {
  return (
    <AppProvider>
      <KonstaApp theme="ios" dark={false} safeAreas>
        <AppErrorBoundary>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <InnerApp />
          </BrowserRouter>
        </AppErrorBoundary>
      </KonstaApp>
    </AppProvider>
  )
}
