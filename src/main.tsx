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
import { beginBootSession, markBootStage, recordBootFailure } from '@/lib/runtime/startupDiagnostics'

// Always disable SW in dev to avoid stale-cache reload loops during local testing.
const shouldSkipServiceWorker = import.meta.env.DEV
const shouldRegisterServiceWorker = !shouldSkipServiceWorker
const LOCAL_CACHE_PREFIXES = ['nostr-paper-', 'workbox-'] as const

document.documentElement.dataset.theme = 'light'
beginBootSession()

window.addEventListener('error', (event) => {
  const message = event.error instanceof Error
    ? event.error.message
    : event.message || 'Unknown global error'
  recordBootFailure('main:start', message)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === 'string'
      ? reason
      : 'Unhandled promise rejection'
  recordBootFailure('main:start', message)
})

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

    if (registrations.length === 0 && !navigator.serviceWorker.controller) {
      return
    }

    await Promise.all(
      registrations.map((registration) => registration.unregister().catch(() => false)),
    )
    await clearLocalServiceWorkerCaches()

    // Avoid forced reloads in development. They can amplify into reload churn if
    // the browser keeps handing control back to a stale worker while HMR is active.
    if (navigator.serviceWorker.controller) {
      console.info('[PWA] Local service worker unregistered; current page remains controlled until next manual reload.')
      return
    }

    console.info('[PWA] Local service workers unregistered and caches cleared.')
  } catch (error) {
    console.warn('[PWA] Failed to disable local service workers:', error)
  }
}

// ── PWA Service Worker ────────────────────────────────────────
const noopUpdateSW: ReturnType<typeof registerSW> = async () => {}
let updateSW = noopUpdateSW

if (shouldRegisterServiceWorker) {
  try {
    updateSW = registerSW({
      onNeedRefresh() {
        // Dispatch custom event — App.tsx handles the update prompt
        window.dispatchEvent(new CustomEvent('pwa-update-available', {
          detail: {
            applyUpdate: () => updateSW(true),
          },
        }))
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
  } catch (error) {
    console.warn('[PWA] Service worker registration threw synchronously. Continuing without SW:', error)
    void disableLocalServiceWorkers()
  }
}

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

markBootStage('main:react-mounted')
