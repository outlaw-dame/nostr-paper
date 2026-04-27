import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './SettingsPage'
import { AppContext, type AppContextValue } from '@/contexts/app-context'

const publishMock = vi.fn().mockResolvedValue(undefined)
const eventInstances: Array<{ kind?: number; content?: string }> = []

vi.mock('@nostr-dev-kit/ndk', () => {
  class MockNDKEvent {
    kind?: number
    content = ''
    tags: string[][] = []

    constructor(_ndk: unknown) {
      eventInstances.push(this)
    }

    publish() {
      return publishMock()
    }
  }

  return { NDKEvent: MockNDKEvent }
})

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: {
      pubkey: 'a'.repeat(64),
      name: 'alice',
      display_name: 'Alice',
      about: 'Hello from bio',
      website: 'https://example.com',
      picture: 'https://example.com/avatar.jpg',
      banner: 'https://example.com/banner.jpg',
      nip05: 'alice@example.com',
      lud16: 'alice@getalby.com',
      updatedAt: 1,
    },
  }),
}))

vi.mock('@/hooks/useUserStatus', () => ({
  useUserStatus: () => ({ status: null }),
}))

vi.mock('@/components/profile/AuthorRow', () => ({
  AuthorRow: () => <div>author-row</div>,
}))

vi.mock('@/components/nostr/UserStatusBody', () => ({
  UserStatusBody: () => null,
}))

vi.mock('@/components/cards/AppearanceSettingsCard', () => ({
  AppearanceSettingsCard: () => null,
}))

vi.mock('@/lib/feed/resumeSettings', () => ({
  getFeedResumeEnabled: () => true,
  setFeedResumeEnabled: vi.fn(),
}))

vi.mock('@/lib/nostr/ndk', () => ({
  getNDK: () => ({ id: 'mock-ndk' }),
}))

vi.mock('@/lib/retry', () => ({
  withRetry: (task: () => Promise<unknown>) => task(),
}))

function createAppContextValue(): AppContextValue {
  return {
    status: 'ready',
    bootstrap: null,
    currentUser: { pubkey: 'a'.repeat(64) },
    errors: [],
    isOnline: true,
    dispatch: vi.fn(),
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

describe('SettingsPage display name publishing', () => {
  let container: HTMLDivElement
  let root: Root

  afterEach(async () => {
    vi.clearAllMocks()
    eventInstances.length = 0

    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    if (container) container.remove()
  })

  it('publishes kind-0 metadata with updated display_name', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContext.Provider value={createAppContextValue()}>
          <MemoryRouter>
            <SettingsPage />
          </MemoryRouter>
        </AppContext.Provider>,
      )
    })

    const input = Array
      .from(container.querySelectorAll('input'))
      .find((node) => (node as HTMLInputElement).placeholder === 'How your name appears') as HTMLInputElement | undefined

    expect(input).toBeTruthy()
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await setInputValue(input!, 'Alice 🚀 Updated')

    const saveButton = Array
      .from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Save Profile'))

    expect(saveButton).toBeTruthy()
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await click(saveButton!)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(eventInstances.length).toBeGreaterThan(0)

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const published = eventInstances[eventInstances.length - 1]!
    expect(published.kind).toBe(0)

    const payload = JSON.parse(published.content ?? '{}') as Record<string, string>
    expect(payload.display_name).toBe('Alice 🚀 Updated')
    expect(payload.name).toBe('alice')
    expect(payload.about).toBe('Hello from bio')
    expect(payload.nip05).toBe('alice@example.com')
  })
})
