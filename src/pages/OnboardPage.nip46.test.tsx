import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OnboardPage from './OnboardPage'
import { AppContext, type AppContextValue } from '@/contexts/app-context'

const loginWithNip46BunkerMock = vi.fn()
const isValidNip46BunkerTokenMock = vi.fn()

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: null }),
}))

vi.mock('@/lib/nostr/nip21', () => ({
  decodeProfileReference: () => null,
}))

vi.mock('@/lib/nostr/nip05', () => ({
  parseNip05Identifier: () => null,
  resolveNip05Identifier: vi.fn(),
}))

vi.mock('@/lib/nostr/ndk', () => ({
  loginWithNsec: vi.fn(),
  loginWithNip46Bunker: (...args: unknown[]) => loginWithNip46BunkerMock(...args),
  isValidNip46BunkerToken: (...args: unknown[]) => isValidNip46BunkerTokenMock(...args),
  loginWithPubkey: vi.fn(),
  performLogout: vi.fn(),
  getNDK: vi.fn(),
  STORAGE_KEY_NSEC: 'nostr-paper:nsec',
  STORAGE_KEY_NIP46_BUNKER: 'nostr-paper:nip46-bunker',
  STORAGE_KEY_PUBKEY: 'nostr-paper:pubkey',
}))

function createAppContextValue(dispatch = vi.fn()): AppContextValue {
  return {
    status: 'ready',
    bootstrap: null,
    currentUser: null,
    errors: [],
    isOnline: true,
    dispatch,
    logout: vi.fn(),
  }
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function click(element: Element) {
  await act(async () => {
    ;(element as HTMLElement).click()
  })
}

describe('OnboardPage NIP-46 onboarding', () => {
  let container: HTMLDivElement
  let root: Root

  afterEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    if (container) container.remove()
  })

  it('connects with a valid bunker token and sets current user', async () => {
    const dispatch = vi.fn()
    const token = `bunker://${'a'.repeat(64)}?relay=wss://relay.example.com&secret=testsecret&pubkey=${'b'.repeat(64)}`

    isValidNip46BunkerTokenMock.mockReturnValue(true)
    loginWithNip46BunkerMock.mockResolvedValue('b'.repeat(64))

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContext.Provider value={createAppContextValue(dispatch)}>
          <MemoryRouter initialEntries={['/onboard']}>
            <Routes>
              <Route path="/onboard" element={<OnboardPage />} />
              <Route path="/" element={<div>home</div>} />
            </Routes>
          </MemoryRouter>
        </AppContext.Provider>,
      )
    })

    const remoteSignerButton = Array
      .from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Remote Signer'))

    expect(remoteSignerButton).toBeTruthy()
    await click(remoteSignerButton!)

    const input = container.querySelector('input') as HTMLInputElement | null
    expect(input).toBeTruthy()
    await setInputValue(input!, token)

    const submitButton = Array
      .from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Connect Remote Signer'))

    expect(submitButton).toBeTruthy()
    await click(submitButton!)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(isValidNip46BunkerTokenMock).toHaveBeenCalledWith(token)
    expect(loginWithNip46BunkerMock).toHaveBeenCalledWith(token)
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_USER', payload: { pubkey: 'b'.repeat(64) } })
    expect(container.textContent).toContain('home')
  })
})
