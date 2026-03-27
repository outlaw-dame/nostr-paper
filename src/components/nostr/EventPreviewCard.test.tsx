import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventPreviewCard } from './EventPreviewCard'
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

vi.mock('@/hooks/useModeration', () => ({
  useEventModeration: () => moderationState,
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ profile: null }),
}))

let activeRoot: Root | null = null
let activeContainer: HTMLDivElement | null = null

function makeEvent(): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 1_710_000_000,
    kind: Kind.ShortNote,
    tags: [],
    content: 'apple update',
    sig: 'b'.repeat(128),
  }
}

async function renderCard() {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const root = createRoot(container)
  activeRoot = root
  activeContainer = container

  await act(async () => {
    root.render(
      <MemoryRouter>
        <EventPreviewCard event={makeEvent()} />
      </MemoryRouter>,
    )
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

describe('EventPreviewCard moderation handling', () => {
  it('renders a visible placeholder when blocked by Tagr', async () => {
    moderationState.blocked = true
    moderationState.decision = {
      id: 'e'.repeat(64),
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

    const container = await renderCard()

    expect(container.textContent).toContain('Content hidden')
    expect(container.textContent).toContain('Blocked by Tagr.')
  })

  it('keeps silent-hide behavior for non-Tagr blocked decisions', async () => {
    moderationState.blocked = true
    moderationState.decision = {
      id: 'e'.repeat(64),
      action: 'block',
      reason: 'toxicity',
      scores: {
        toxic: 0.9,
        severe_toxic: 0,
        obscene: 0,
        threat: 0,
        insult: 0,
        identity_hate: 0,
      },
      model: 'mod-model',
      policyVersion: 'test',
    }

    const container = await renderCard()

    expect(container.textContent).toBe('')
  })
})
