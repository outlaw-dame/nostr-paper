import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { noteEncode, npubEncode } from 'nostr-tools/nip19'
import { EntityPreviewStack } from './EntityPreviewStack'
import { collectEntityCandidates } from '@/lib/text/entityPreview'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

vi.mock('@/hooks/useLinkPreview', () => ({
  useLinkPreview: (url: string | null | undefined) => {
    if (url?.includes('techcrunch.com')) {
      return {
        data: {
          url,
          title: 'TechCrunch Funding Round',
          description: 'A concise OG description for the funding round.',
          image: 'https://techcrunch.com/hero.jpg',
          siteName: 'techcrunch.com',
          author: 'Sara Perez',
        },
        loading: false,
      }
    }

    return { data: null, loading: false }
  },
}))

vi.mock('@/hooks/useProfile', () => ({
  useProfile: (pubkey: string) => ({
    profile: pubkey === 'a'.repeat(64)
      ? {
        name: 'damon',
        display_name: 'Damon',
        about: 'Builds on Nostr.',
        picture: 'https://example.com/avatar.jpg',
      }
      : null,
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/useEvent', () => ({
  useEvent: (eventId: string | null | undefined) => ({
    event: eventId === 'b'.repeat(64)
      ? {
        id: 'b'.repeat(64),
        pubkey: 'c'.repeat(64),
        created_at: 1_710_000_000,
        kind: Kind.ShortNote,
        tags: [],
        content: 'Resolved event preview',
        sig: 'd'.repeat(128),
      } satisfies NostrEvent
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

vi.mock('@/components/nostr/EventPreviewCard', () => ({
  EventPreviewCard: ({ event }: { event: NostrEvent }) => (
    <div>Event Card {event.id}</div>
  ),
}))

vi.mock('@/components/ui/TwemojiText', () => ({
  TwemojiText: ({ text }: { text: string }) => <>{text}</>,
}))

let activeRoot: Root | null = null
let activeContainer: HTMLDivElement | null = null

async function flushReact(cycles = 4) {
  await act(async () => {
    for (let index = 0; index < cycles; index += 1) {
      await Promise.resolve()
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
  })
}

async function renderClient(element: ReactNode): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  activeRoot = root
  activeContainer = container

  await act(async () => {
    root.render(<MemoryRouter>{element}</MemoryRouter>)
  })
  await flushReact()

  return container
}

afterEach(async () => {
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

describe('EntityPreviewStack', () => {
  it('renders a rich primary URL card with a supporting source rail', async () => {
    const npub = npubEncode('a'.repeat(64))
    const candidates = collectEntityCandidates([
      { type: 'url', value: 'https://techcrunch.com/example-story' },
      { type: 'nostr', value: `nostr:${npub}` },
    ])

    const container = await renderClient(
      <EntityPreviewStack candidates={candidates} />,
    )

    expect(container.textContent).toContain('TechCrunch Funding Round')
    expect(container.textContent).toContain('Sources')
    expect(container.textContent).toContain('techcrunch.com')
    expect(container.textContent).toContain('@Damon')
  })

  it('falls through to the next resolvable entity when the top-ranked candidate is unavailable', async () => {
    const note = noteEncode('b'.repeat(64))
    const candidates = collectEntityCandidates([
      { type: 'url', value: 'https://dead.example.com/story' },
      { type: 'nostr', value: `nostr:${note}` },
    ])

    const container = await renderClient(
      <EntityPreviewStack candidates={candidates} />,
    )

    expect(container.textContent).toContain(`Event Card ${'b'.repeat(64)}`)
    expect(container.textContent).toContain('Sources')
  })
})
