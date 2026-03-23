/**
 * Vitest global test setup
 */
/* global navigator, window, console, SharedArrayBuffer, DeviceOrientationEvent, btoa, atob, Image */
/// <reference types="vitest/globals" />
import { vi, beforeAll, afterAll } from 'vitest'

// ── Mock browser APIs not available in jsdom ─────────────────

// IndexedDB / OPFS — not in jsdom
Object.defineProperty(globalThis, 'indexedDB', {
  value: {
    open: vi.fn(),
  },
  writable: true,
})

Object.defineProperty(navigator, 'storage', {
  value: {
    persist:  vi.fn().mockResolvedValue(true),
    estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 1_000_000 }),
  },
  writable: true,
})

// SharedArrayBuffer — needs COOP/COEP in real browser, mock in tests
if (typeof SharedArrayBuffer === 'undefined') {
  // @ts-expect-error — mock for test env
  globalThis.SharedArrayBuffer = ArrayBuffer
}

// Service Worker
Object.defineProperty(navigator, 'serviceWorker', {
  value: {
    register:    vi.fn().mockResolvedValue({ update: vi.fn() }),
    controller:  null,
    ready:       Promise.resolve({ active: { postMessage: vi.fn() } }),
  },
  writable: true,
})

// DeviceOrientation
window.DeviceOrientationEvent = class DeviceOrientationEvent
  extends Event {
  alpha: number | null = null
  beta:  number | null = null
  gamma: number | null = null
} as unknown as typeof DeviceOrientationEvent

// matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches:             false,
    media:               query,
    onchange:            null,
    addListener:         vi.fn(),
    removeListener:      vi.fn(),
    addEventListener:    vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent:       vi.fn(),
  })),
})

// Silence expected console.error in tests
const originalError = console.error
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // Suppress React act() warnings and known test noise
    if (typeof args[0] === 'string' && (
      args[0].includes('act(') ||
      args[0].includes('ReactDOM.render')
    )) return
    originalError(...args)
  }
})

afterAll(() => {
  console.error = originalError
})
