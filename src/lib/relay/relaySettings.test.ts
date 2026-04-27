import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearStoredRelayUrls,
  getStoredRelayPreferences,
  getStoredRelayUrls,
  setStoredRelayPreferences,
} from './relaySettings'

const originalLocalStorage = globalThis.localStorage
const originalWindow = globalThis.window
const originalCustomEvent = globalThis.CustomEvent

describe('relaySettings', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()

    const localStorageMock = {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
      removeItem: (key: string) => {
        storage.delete(key)
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      get length() {
        return storage.size
      },
    } satisfies Storage

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        dispatchEvent: () => true,
        location: {
          protocol: 'http:',
        },
      },
    })
    Object.defineProperty(globalThis, 'CustomEvent', {
      configurable: true,
      value: class CustomEventMock {
      constructor(public type: string) {}
      },
    })
    localStorage.clear()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
    Object.defineProperty(globalThis, 'CustomEvent', {
      configurable: true,
      value: originalCustomEvent,
    })
  })

  it('migrates legacy string arrays into read/write preferences', () => {
    const relayOne = 'wss://relay.damus.io'
    const relayTwo = 'wss://nos.lol'

    localStorage.setItem(
      'nostr-paper:relays:v1',
      JSON.stringify([relayOne, relayTwo]),
    )

    expect(getStoredRelayPreferences()).toEqual([
      { url: relayOne, read: true, write: true },
      { url: relayTwo, read: true, write: true },
    ])
    expect(getStoredRelayUrls()).toEqual([relayOne, relayTwo])
  })

  it('stores read and write capabilities independently while only returning read relays for the pool', () => {
    const relayOne = 'wss://relay.damus.io'
    const relayTwo = 'wss://relay.primal.net'

    setStoredRelayPreferences([
      { url: relayOne, read: true, write: false },
      { url: relayTwo, read: false, write: true },
      { url: relayOne, read: false, write: true },
    ])

    expect(getStoredRelayPreferences()).toEqual([
      { url: relayOne, read: true, write: true },
      { url: relayTwo, read: false, write: true },
    ])
    expect(getStoredRelayUrls()).toEqual([relayOne])

    clearStoredRelayUrls()
    expect(getStoredRelayPreferences()).toBeNull()
    expect(getStoredRelayUrls()).toBeNull()
  })
})