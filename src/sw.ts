/**
 * Service Worker
 *
 * Caching strategies:
 * - App shell: CacheFirst (precached by Workbox at build time)
 *
 * Cross-origin images (profile pictures, media) are intentionally NOT cached
 * here — Chrome's cache partitioning in cross-origin-isolated SW contexts
 * causes caches.match() to throw for cross-origin requests, and the browser's
 * native HTTP cache handles image caching reliably without these issues.
 *
 * Security:
 * - COOP/COEP headers injected on all navigation responses (for OPFS/SharedArrayBuffer)
 * - CSP headers on all HTML responses
 * - No external script caching
 */

/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { isLocalDevelopmentHost } from '@/lib/runtime/localhost'

declare const self: ServiceWorkerGlobalScope

const SW_VERSION = '1.0.0'

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

const ALL_CACHES = ['nostr-paper-media-v1'] as const

// Skip waiting so the new SW takes control immediately on install,
// without waiting for all existing tabs to close.
self.addEventListener('install', () => { void self.skipWaiting() })

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([self.clients.claim(), pruneStaleCaches()])
  )
})

async function pruneStaleCaches(): Promise<void> {
  const validCaches = new Set<string>(ALL_CACHES)
  const cacheNames = await caches.keys()
  await Promise.all(
    cacheNames
      .filter(name => name.startsWith('nostr-paper-') && !validCaches.has(name))
      .map(name => caches.delete(name))
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (isLocalDevelopmentHost(self.location.hostname)) return
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(injectCrossOriginHeaders(request))
  }
})

async function injectCrossOriginHeaders(request: Request): Promise<Response> {
  const response = await fetch(request)
  const headers = new Headers(response.headers)
  headers.set('Cross-Origin-Opener-Policy',   'same-origin')
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless')
  headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https: blob:",
    "connect-src 'self' wss: https:",
    "font-src 'self' data:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '))
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options',        'DENY')
  headers.set('Referrer-Policy',        'no-referrer')
  headers.set('Permissions-Policy',     'camera=(), microphone=(), geolocation=(self), payment=()')
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers,
  })
}


self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload: { title?: string; body?: string; tag?: string; data?: unknown }
  try { payload = event.data.json() as typeof payload }
  catch { payload = { title: 'Nostr Paper', body: event.data.text() } }
  const title = payload.title ?? 'Nostr Paper'
  const options: NotificationOptions = {
    body: payload.body ?? '', icon: '/icons/pwa-192x192.png',
    badge: '/icons/badge-72x72.png', tag: payload.tag ?? 'nostr-notification',
    data: payload.data, silent: false,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find(c => c.url.includes(self.location.origin))
      if (existing) return existing.focus()
      return self.clients.openWindow('/')
    })
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

console.log(`[SW] Nostr Paper Service Worker ${SW_VERSION} installed`)
