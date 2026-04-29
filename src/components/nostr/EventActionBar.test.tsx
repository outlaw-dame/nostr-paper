// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppContext, type AppContextValue } from '@/contexts/app-context'
import { getSocialTelemetrySnapshot, resetSocialTelemetryForTests } from '@/lib/nostr/socialTelemetry'
import { Kind, type EventEngagementSummary, type NostrEvent } from '@/types'
import { EventActionBar } from './EventActionBar'

const publishReactionMock = vi.fn()
const getEventEngagementSummaryMock = vi.fn()

vi.mock('@/lib/nostr/reaction', () => ({
  publishReaction: (...args: unknown[]) => publishReactionMock(...args),
}))

vi.mock('@/lib/db/nostr', () => ({
  getEventEngagementSummary: (...args: unknown[]) => getEventEngagementSummaryMock(...args),
}))

vi.mock('@/lib/nostr/repost', () => ({
  publishRepost: vi.fn(),
}))

vi.mock('@/lib/nostr/deletion', () => ({
  publishDeletionRequest: vi.fn(),
}))

vi.mock('@/lib/nostr/lists', () => ({
  canBookmarkEvent: () => false,
  getFreshNip51ListEvent: vi.fn(),
  isEventInBookmarkList: vi.fn(),
  toggleGlobalBookmark: vi.fn(),
}))

vi.mock('@/components/nostr/ReportSheet', () => ({
  ReportSheet: () => null,
}))

vi.mock('@/components/nostr/ZapSheet', () => ({
  ZapSheet: () => null,
}))

const EMPTY_SUMMARY: EventEngagementSummary = {
  replyCount: 0,
  repostCount: 0,
  reactionCount: 0,
  likeCount: 0,
  dislikeCount: 0,
  emojiReactions: [],
  zapCount: 0,
  zapTotalMsats: 0,
  currentUserHasReposted: false,
  currentUserHasLiked: false,
  currentUserHasDisliked: false,
}

const EVENT: NostrEvent = {
  id: 'e'.repeat(64),
  kind: Kind.ShortNote,
  pubkey: 'b'.repeat(64),
  created_at: 1_700_000_000,
  tags: [],
  content: 'hello',
  sig: 's'.repeat(128),
}

function appContext(): AppContextValue {
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

function renderActionBar(container: HTMLElement) {
  const root = createRoot(container)
  root.render(
    <AppContext.Provider value={appContext()}>
      <MemoryRouter>
        <EventActionBar event={EVENT} />
      </MemoryRouter>
    </AppContext.Provider>,
  )
  return root
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('EventActionBar reactions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    vi.clearAllMocks()
    resetSocialTelemetryForTests()
    container = document.createElement('div')
    document.body.appendChild(container)
    getEventEngagementSummaryMock.mockResolvedValue({ ...EMPTY_SUMMARY })

    await act(async () => {
      root = renderActionBar(container)
    })
    await flush()
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('rolls back optimistic like state and records telemetry on publish failure', async () => {
    publishReactionMock.mockRejectedValueOnce(new Error('relay publish failed'))

    const likeButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Like')
    expect(likeButton).toBeTruthy()

    await act(async () => {
      likeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('0 likes')
    expect(container.textContent).toContain('relay publish failed')
    expect(getSocialTelemetrySnapshot()).toMatchObject({
      'reaction:relay': 1,
    })
  })

  it('guards rapid duplicate like publishes', async () => {
    let resolvePublish: (event: NostrEvent) => void = () => {}
    publishReactionMock.mockReturnValueOnce(new Promise<NostrEvent>((resolve) => {
      resolvePublish = resolve
    }))

    const likeButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Like')
    expect(likeButton).toBeTruthy()

    await act(async () => {
      likeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      likeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(publishReactionMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolvePublish(EVENT)
      await Promise.resolve()
      await Promise.resolve()
    })
  })
})
