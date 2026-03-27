/**
 * Application Entry Point
 *
 * Boot order:
 * 1. PWA service worker registered here (offline caching, update prompts)
 * 2. React app rendered
 *
 * All heavy initialization (DB, NDK) happens inside AppProvider.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles/global.css'

// Always disable SW in dev to avoid stale-cache reload loops during local testing.
const shouldSkipServiceWorker = import.meta.env.DEV
const shouldRegisterServiceWorker = !shouldSkipServiceWorker
const LOCAL_SW_RESET_RELOAD_KEY = 'nostr-paper:local-sw-reset:v1'
const LOCAL_CACHE_PREFIXES = ['nostr-paper-', 'workbox-'] as const

document.documentElement.dataset.theme = 'light'

async function clearLocalServiceWorkerCaches(): Promise<void> {
  if (typeof caches === 'undefined') return

  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter((name) => LOCAL_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)))
      .map((name) => caches.delete(name).catch(() => false)),
  )
}

async function disableLocalServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  if (typeof navigator.serviceWorker.getRegistrations !== 'function') return

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    const hadController = Boolean(navigator.serviceWorker.controller)

    if (registrations.length === 0 && !hadController) {
      sessionStorage.removeItem(LOCAL_SW_RESET_RELOAD_KEY)
      return
    }

    await Promise.all(
      registrations.map((registration) => registration.unregister().catch(() => false)),
    )
    await clearLocalServiceWorkerCaches()

    if (hadController) {
      const alreadyReloaded = sessionStorage.getItem(LOCAL_SW_RESET_RELOAD_KEY) === '1'
      if (!alreadyReloaded) {
        sessionStorage.setItem(LOCAL_SW_RESET_RELOAD_KEY, '1')
        console.info('[PWA] Local service worker detached; reloading once to finish cleanup.')
        window.location.reload()
        return
      }

      console.warn('[PWA] Local service worker still controls the page after cleanup reload.')
      // Keep the one-shot flag set while a controller is still present.
      // This prevents repeat reload loops across subsequent startup evaluations.
      return
    }

    sessionStorage.removeItem(LOCAL_SW_RESET_RELOAD_KEY)
    console.info('[PWA] Local service workers unregistered and caches cleared.')
  } catch (error) {
    console.warn('[PWA] Failed to disable local service workers:', error)
  }
}

// ── PWA Service Worker ────────────────────────────────────────
const noopUpdateSW: ReturnType<typeof registerSW> = async () => {}
const updateSW = shouldRegisterServiceWorker
  ? registerSW({
      onNeedRefresh() {
        // Dispatch custom event — App.tsx handles the update prompt
        window.dispatchEvent(new CustomEvent('pwa-update-available'))
      },
      onOfflineReady() {
        window.dispatchEvent(new CustomEvent('pwa-offline-ready'))
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return
        // Check for updates every hour
        setInterval(() => {
          registration.update().catch(() => {})
        }, 60 * 60 * 1000)
      },
      onRegisterError(error) {
        console.error('[PWA] Service worker registration failed:', error)
      },
    })
  : noopUpdateSW

if (shouldSkipServiceWorker) {
  console.info('[PWA] Skipping service worker registration on local development hosts.')
  void disableLocalServiceWorkers()
}

// Expose for testing
if (import.meta.env.DEV) {
  // @ts-expect-error — dev only
  window.__updateSW = updateSW
}

// ── React Root ────────────────────────────────────────────────
const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found in DOM')

const root = ReactDOM.createRoot(container)

// StrictMode intentionally double-invokes effects in development.
// This can create noisy bootstrap/re-subscription churn while debugging.
const shouldUseStrictMode = import.meta.env.PROD

root.render(
  shouldUseStrictMode ? (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ) : (
    <App />
  )
)
