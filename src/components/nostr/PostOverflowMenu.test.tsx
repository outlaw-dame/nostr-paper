// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PostOverflowMenu } from './PostOverflowMenu'
import { AppContext, type AppContextValue } from '@/contexts/app-context'
import { Kind, type NostrEvent, type Profile } from '@/types'

const isMutedMock = vi.fn<(pubkey: string) => boolean>(() => false)
const muteMock = vi.fn<(pubkey: string) => Promise<void>>(async () => {})
const unmuteMock = vi.fn<(pubkey: string) => Promise<void>>(async () => {})

vi.mock('@/hooks/useMuteList', () => ({
  useMuteList: () => ({
    isMuted: (pubkey: string) => isMutedMock(pubkey),
    mute: (pubkey: string) => muteMock(pubkey),
    unmute: (pubkey: string) => unmuteMock(pubkey),
  }),
}))

vi.mock('@/components/nostr/ReportSheet', () => ({
  ReportSheet: () => null,
}))

const EVENT: NostrEvent = {
  id: 'e'.repeat(64),
  kind: Kind.ShortNote,
  pubkey: 'b'.repeat(64),
  created_at: 1_700_000_000,
  tags: [],
  content: 'hello',
  sig: 'f'.repeat(128),
}

const PROFILE: Profile = {
  pubkey: EVENT.pubkey,
  name: 'author',
  display_name: 'Author',
  updatedAt: 0,
}

function appContext(currentUser: AppContextValue['currentUser']): AppContextValue {
  return {
    status: 'ready',
    bootstrap: null,
    currentUser,
    errors: [],
    isOnline: true,
    dispatch: vi.fn(),
    logout: vi.fn(),
  }
}

describe.runIf(typeof document !== 'undefined')('PostOverflowMenu report action', () => {
  let container: HTMLDivElement | null
  let root: Root | null

  beforeEach(() => {
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    container?.remove()
    root = null
    container = null
  })

  async function renderWithUser(currentUser: AppContextValue['currentUser']) {
    await act(async () => {
      if (!root) throw new Error('Root not initialized')
      root.render(
        <AppContext.Provider value={appContext(currentUser)}>
          <PostOverflowMenu event={EVENT} profile={PROFILE} />
        </AppContext.Provider>,
      )
    })
  }

  async function openMenu() {
    if (!container) throw new Error('Container not initialized')
    const trigger = container.querySelector('button[aria-label="Post actions"]') as HTMLButtonElement | null
    expect(trigger).toBeTruthy()
    if (!trigger) throw new Error('Missing post action trigger')

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('shows disabled sign-in report action for signed-out users', async () => {
    await renderWithUser(null)
    await openMenu()

    if (!container) throw new Error('Container not initialized')
    const reportButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Sign in to report')) as HTMLButtonElement | undefined
    expect(reportButton).toBeTruthy()
    expect(reportButton?.disabled).toBe(true)
  })

  it('shows enabled report action for signed-in users', async () => {
    await renderWithUser({ pubkey: 'a'.repeat(64) })
    await openMenu()

    if (!container) throw new Error('Container not initialized')
    const reportButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Report post')) as HTMLButtonElement | undefined
    expect(reportButton).toBeTruthy()
    expect(reportButton?.disabled).toBe(false)
  })
})
