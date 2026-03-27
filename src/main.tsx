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
import { isLocalDevelopmentHost } from '@/lib/runtime/localhost'
import App from './App'
import './styles/global.css'

const shouldRegisterServiceWorker = !isLocalDevelopmentHost(window.location.hostname)

document.documentElement.dataset.theme = 'light'

async function disableLocalServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return

  const registrations = await navigator.serviceWorker.getRegistrations()
  if (registrations.length === 0) return

  await Promise.all(
    registrations.map((registration) => registration.unregister().catch(() => false)),
  )

  if (navigator.serviceWorker.controller) {
    console.info('[PWA] Local service workers unregistered; active controller will detach on next navigation.')
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

if (!shouldRegisterServiceWorker) {
  console.info('[PWA] Skipping service worker registration on localhost to allow third-party media embeds.')
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

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
