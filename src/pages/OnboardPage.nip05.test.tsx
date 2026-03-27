import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OnboardPage from './OnboardPage'
import { AppContext, type AppContextValue } from '@/contexts/app-context'

const loginWithPubkeyMock = vi.fn()
const resolveNip05IdentifierMock = vi.fn()

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: null }),
}))

vi.mock('@/lib/nostr/nip21', () => ({
  decodeProfileReference: () => null,
}))

vi.mock('@/lib/nostr/nip05', () => ({
  parseNip05Identifier: (value: string) => value.includes('@') ? ({ identifier: value.toLowerCase(), localPart: 'alice', domain: 'example.com' }) : null,
  resolveNip05Identifier: (...args: unknown[]) => resolveNip05IdentifierMock(...args),
}))

vi.mock('@/lib/nostr/ndk', () => ({
  loginWithNsec: vi.fn(),
  loginWithPubkey: (...args: unknown[]) => loginWithPubkeyMock(...args),
  performLogout: vi.fn(),
  getNDK: vi.fn(),
  STORAGE_KEY_NSEC: 'nostr-paper:nsec',
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

describe('OnboardPage NIP-05 onboarding', () => {
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

  it('resolves a NIP-05 identifier and continues in read-only mode', async () => {
    const dispatch = vi.fn()
    resolveNip05IdentifierMock.mockResolvedValue({
      identifier: 'alice@example.com',
      pubkey: 'a'.repeat(64),
      relays: [],
    })

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

    const readOnlyButton = Array
      .from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('NIP-05 supported'))

    expect(readOnlyButton).toBeTruthy()
    await click(readOnlyButton!)

    const input = container.querySelector('input') as HTMLInputElement | null
    expect(input).toBeTruthy()
    await setInputValue(input!, 'alice@example.com')

    const submitButton = Array
      .from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Browse Read-Only'))

    expect(submitButton).toBeTruthy()
    await click(submitButton!)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(resolveNip05IdentifierMock).toHaveBeenCalledWith('alice@example.com')
    expect(loginWithPubkeyMock).toHaveBeenCalledWith('a'.repeat(64))
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_USER', payload: { pubkey: 'a'.repeat(64) } })
    expect(container.textContent).toContain('home')
  })
})
