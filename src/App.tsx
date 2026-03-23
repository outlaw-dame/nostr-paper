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

import React, { useEffect, useState, Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { App as KonstaApp } from 'konsta/react'
import { AnimatePresence } from 'motion/react'
import { AppProvider } from '@/contexts/AppContext'
import { useApp } from '@/contexts/app-context'
import { ComposeSheet } from '@/components/compose/ComposeSheet'
import { BootSplash } from '@/components/layout/BootSplash'
import { UpdateBanner } from '@/components/ui/UpdateBanner'
import { ErrorScreen } from '@/components/ui/ErrorScreen'
import { OfflineBanner } from '@/components/ui/OfflineBanner'

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
const FiltersPage  = lazy(() => import('@/pages/FiltersPage'))
const OnboardPage  = lazy(() => import('@/pages/OnboardPage'))

// ── Inner App (access to context) ────────────────────────────

function InnerApp() {
  const { status, errors, isOnline } = useApp()
  const location = useLocation()
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    const handler = () => setUpdateAvailable(true)
    window.addEventListener('pwa-update-available', handler)
    return () => window.removeEventListener('pwa-update-available', handler)
  }, [])

  if (status === 'idle' || status === 'booting') {
    return <BootSplash />
  }

  if (status === 'error') {
    const lastError = errors[errors.length - 1]
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
      {updateAvailable && <UpdateBanner />}

      <Suspense fallback={<BootSplash minimal />}>
        {/*
          key={location.pathname} tells AnimatePresence that the child has
          changed on navigation, triggering exit/enter animations correctly.
        */}
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/"                   element={<FeedPage />} />
            <Route path="/t/:tag"             element={<FeedPage />} />
            <Route path="/search"             element={<SearchPage />} />
            <Route path="/article/:pubkey/:identifier" element={<ArticlePage />} />
            <Route path="/dvm/new"           element={<DvmComposePage />} />
            <Route path="/list/new"          element={<ListComposePage />} />
            <Route path="/poll/new"          element={<PollComposePage />} />
            <Route path="/video/new"         element={<VideoComposePage />} />
            <Route path="/video/:id"          element={<VideoPage />} />
            <Route path="/video/:variant/:pubkey/:identifier" element={<VideoPage />} />
            <Route path="/a/:naddr"            element={<AddressPage />} />
            <Route path="/note/:id"            element={<NotePage />} />
            <Route path="/profile/:pubkey"     element={<ProfilePage />} />
            <Route path="/settings"            element={<SettingsPage />} />
            <Route path="/filters"             element={<FiltersPage />} />
            <Route path="/onboard"             element={<OnboardPage />} />
            <Route path="*"                    element={<Navigate to="/" replace />} />
          </Routes>
        </AnimatePresence>
      </Suspense>

      <ComposeSheet />
    </>
  )
}

// ── Root App ─────────────────────────────────────────────────

export default function App() {
  return (
    <AppProvider>
      <KonstaApp theme="ios" dark={false} safeAreas>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <InnerApp />
        </BrowserRouter>
      </KonstaApp>
    </AppProvider>
  )
}
