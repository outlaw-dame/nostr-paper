import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuotePreviewList } from './QuotePreviewList'
import type { ModerationDecision, NostrEvent } from '@/types'
import { Kind } from '@/types'

const moderationState: {
  blocked: boolean
  loading: boolean
  decision: ModerationDecision | null
} = {
  blocked: false,
  loading: false,
  decision: null,
}

const quotedEventId = '9'.repeat(64)

vi.mock('@/hooks/useEvent', () => ({
  useEvent: (eventId: string | undefined) => ({
    event: eventId === quotedEventId
      ? {
          id: quotedEventId,
          pubkey: 'a'.repeat(64),
          created_at: 1_710_000_000,
          kind: Kind.ShortNote,
          tags: [],
          content: 'quoted event body',
          sig: 'b'.repeat(128),
        }
      : null,
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/useAddressableEvent', () => ({
  useAddressableEvent: () => ({
    event: null,
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/useModeration', () => ({
  useEventModeration: () => moderationState,
}))

vi.mock('@/components/nostr/EventPreviewCard', () => ({
  EventPreviewCard: () => <div>Rendered Event Preview Card</div>,
}))

let activeRoot: Root | null = null
let activeContainer: HTMLDivElement | null = null

function makeContainerEvent(): NostrEvent {
  return {
    id: 'c'.repeat(64),
    pubkey: 'd'.repeat(64),
    created_at: 1_710_000_100,
    kind: Kind.ShortNote,
    tags: [['q', quotedEventId]],
    content: '',
    sig: 'e'.repeat(128),
  }
}

async function renderList() {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const root = createRoot(container)
  activeRoot = root
  activeContainer = container

  await act(async () => {
    root.render(<QuotePreviewList event={makeContainerEvent()} />)
  })

  return container
}

afterEach(async () => {
  moderationState.blocked = false
  moderationState.loading = false
  moderationState.decision = null

  if (activeRoot) {
    await act(async () => {
      activeRoot?.unmount()
      await Promise.resolve()
    })
  }

  activeRoot = null
  activeContainer?.remove()
  activeContainer = null
})

describe('QuotePreviewList moderation states', () => {
  it('shows a Tagr placeholder for quoted events blocked by Tagr', async () => {
    moderationState.blocked = true
    moderationState.decision = {
      id: quotedEventId,
      action: 'block',
      reason: 'tagr:spam',
      scores: {
        toxic: 0,
        severe_toxic: 0,
        obscene: 0,
        threat: 0,
        insult: 0,
        identity_hate: 0,
      },
      model: 'tagr-bot',
      policyVersion: 'test',
    }

    const container = await renderList()

    expect(container.textContent).toContain('Content hidden')
    expect(container.textContent).toContain('Blocked by Tagr.')
  })

  it('shows quoted unavailable for non-Tagr moderation blocks', async () => {
    moderationState.blocked = true
    moderationState.decision = {
      id: quotedEventId,
      action: 'block',
      reason: 'toxicity',
      scores: {
        toxic: 0.8,
        severe_toxic: 0,
        obscene: 0,
        threat: 0,
        insult: 0,
        identity_hate: 0,
      },
      model: 'mod-model',
      policyVersion: 'test',
    }

    const container = await renderList()

    expect(container.textContent).toContain('Quoted event unavailable.')
  })
})
