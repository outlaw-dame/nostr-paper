// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RelaysPage from './RelaysPage'
import { AppContext, type AppContextValue } from '@/contexts/app-context'

const importRemoteRelayListMock = vi.fn()
const setStoredRelayPreferencesMock = vi.fn()
const addRelayToPoolMock = vi.fn()
const removeRelayFromPoolMock = vi.fn()

vi.mock('@/lib/nostr/relayList', () => ({
  importCurrentUserRelayListPreferences: (...args: unknown[]) => importRemoteRelayListMock(...args),
}))

vi.mock('@/lib/nostr/relayHealth', () => ({
  getRelayHealthSnapshot: vi.fn().mockResolvedValue({
    snapshot: {
      tier: 'good',
      label: 'Healthy',
      details: 'Mock health snapshot.',
    },
    checkedAt: Date.now(),
  }),
}))

vi.mock('@/lib/nostr/ndk', () => ({
  getDefaultRelayUrls: () => ['wss://relay.damus.io'],
  getNDK: () => ({
    pool: {
      relays: new Map([
        ['wss://relay.damus.io', { status: 4 }],
      ]),
    },
  }),
  addRelayToPool: (...args: unknown[]) => addRelayToPoolMock(...args),
  removeRelayFromPool: (...args: unknown[]) => removeRelayFromPoolMock(...args),
  retryRelayConnection: vi.fn().mockReturnValue(true),
  canRetryRelayConnection: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/relay/relaySettings', () => ({
  RELAY_SETTINGS_UPDATED_EVENT: 'nostr-paper:relay-settings-updated',
  getStoredRelayPreferences: () => null,
  setStoredRelayPreferences: (...args: unknown[]) => setStoredRelayPreferencesMock(...args),
  clearStoredRelayUrls: vi.fn(),
}))

function createAppContextValue(pubkey: string | null): AppContextValue {
  return {
    status: 'ready',
    bootstrap: null,
    currentUser: pubkey ? { pubkey } : null,
    errors: [],
    isOnline: true,
    dispatch: vi.fn(),
    logout: vi.fn(),
  }
}

async function click(element: Element) {
  await act(async () => {
    ;(element as HTMLElement).click()
  })
}

describe('RelaysPage import UI', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    importRemoteRelayListMock.mockReset()
    setStoredRelayPreferencesMock.mockReset()
    addRelayToPoolMock.mockReset()
    removeRelayFromPoolMock.mockReset()
  })

  afterEach(async () => {
    vi.clearAllMocks()

    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    if (container) container.remove()
  })

  it('imports remote relay roles from the signed-in account', async () => {
    importRemoteRelayListMock.mockResolvedValue([
      { url: 'wss://relay.primal.net', read: true, write: true },
      { url: 'wss://relay.snort.social', read: false, write: true },
    ])

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContext.Provider value={createAppContextValue('a'.repeat(64))}>
          <MemoryRouter>
            <RelaysPage />
          </MemoryRouter>
        </AppContext.Provider>,
      )
    })

    const importButton = Array
      .from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Import Remote Roles'))

    expect(importButton).toBeTruthy()
    await click(importButton!)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(importRemoteRelayListMock).toHaveBeenCalledWith('a'.repeat(64))
    expect(setStoredRelayPreferencesMock).toHaveBeenCalledWith([
      { url: 'wss://relay.primal.net', read: true, write: true },
      { url: 'wss://relay.snort.social', read: false, write: true },
    ])
    expect(addRelayToPoolMock).toHaveBeenCalledWith('wss://relay.primal.net')
    expect(removeRelayFromPoolMock).toHaveBeenCalledWith('wss://relay.damus.io')
    expect(container.textContent).toContain('Imported your remote kind-10002 relay roles into this device.')
  })
})
