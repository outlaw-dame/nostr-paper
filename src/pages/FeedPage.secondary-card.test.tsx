import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SecondaryCard } from './FeedPage'
import type { FilterCheckResult } from '@/lib/filters/types'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

function stripMotionProps(props: Record<string, unknown>) {
  const {
    animate,
    drag,
    dragConstraints,
    dragElastic,
    dragMomentum,
    exit,
    initial,
    layoutId,
    onDragEnd,
    style,
    transition,
    whileHover,
    whileTap,
    ...rest
  } = props

  return { ...rest, style }
}

vi.mock('motion/react', async () => {
  const React = await import('react')

  const createMotionTag = (tag: string) => React.forwardRef(
    ({ children, ...props }: Record<string, unknown>, ref) => React.createElement(tag, { ...stripMotionProps(props), ref }, children as never),
  )

  return {
    motion: new Proxy({}, {
      get: (_target, property) => createMotionTag(String(property)),
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    useMotionValue: (initial: number) => ({ get: () => initial, set: vi.fn() }),
    useTransform: () => 0,
  }
})

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: {
      name: 'Paper Author',
      display_name: 'Paper Author',
    },
  }),
}))

vi.mock('@/hooks/useFollowStatus', () => ({
  useFollowStatus: () => true,
}))

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

    if (url?.includes('youtube.com')) {
      return {
        data: {
          url,
          title: 'Launch Demo',
          description: 'A launch trailer for the latest demo.',
          image: 'https://img.youtube.com/demo.jpg',
          siteName: 'youtube.com',
          author: 'Studio Channel',
        },
        loading: false,
      }
    }

    return { data: null, loading: false }
  },
}))

vi.mock('@/components/profile/AuthorRow', () => ({
  AuthorRow: ({ pubkey }: { pubkey: string }) => <div>{pubkey}</div>,
}))

vi.mock('@/components/cards/HeroCard', () => ({
  HeroCard: () => null,
}))

vi.mock('@/components/feed/FeedSkeleton', () => ({
  FeedSkeleton: () => null,
}))

vi.mock('@/components/feed/SectionRail', () => ({
  SectionRail: () => null,
}))

vi.mock('@/components/ui/TwemojiText', () => ({
  TwemojiText: ({ text }: { text: string }) => <>{text}</>,
}))

vi.mock('@/components/media/SensitiveImage', () => ({
  SensitiveImage: ({ src, className }: { src: string; className?: string }) => (
    <img src={src} className={className} alt="" />
  ),
}))

vi.mock('@/components/filters/FilteredGate', () => ({
  FilteredGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/cards/NoteContent', () => ({
  NoteContent: ({ content, className }: { content: string; className?: string }) => (
    <div className={className}>{content}</div>
  ),
}))

vi.mock('@/components/nostr/NoteMediaAttachments', () => ({
  NoteMediaAttachments: () => null,
}))

vi.mock('@/components/nostr/PollPreview', () => ({
  PollPreview: () => null,
}))

vi.mock('@/components/nostr/QuotePreviewList', () => ({
  QuotePreviewList: () => null,
}))

vi.mock('@/components/nostr/RepostBody', () => ({
  RepostBody: () => null,
}))

vi.mock('@/components/translation/TranslateTextPanel', () => ({
  TranslateTextPanel: () => null,
}))

function baseEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_710_000_000,
    kind: Kind.ShortNote,
    tags: [],
    content: '',
    sig: 'c'.repeat(128),
    ...overrides,
  }
}

const allowResult: FilterCheckResult = {
  action: null,
  matches: [],
}

describe('SecondaryCard', () => {
  it('renders article metadata and OG image in story cards', () => {
    const event = baseEvent({
      kind: Kind.LongFormContent,
      tags: [['d', 'funding-round']],
      content: 'https://techcrunch.com/example-story',
    })

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SecondaryCard
          event={event}
          index={0}
          checkEvent={() => allowResult}
          semanticResult={allowResult}
        />
      </MemoryRouter>,
    )

    expect(html).toContain('TechCrunch Funding Round')
    expect(html).toContain('By Sara Perez • techcrunch.com')
    expect(html).toContain('A concise OG description for the funding round.')
    expect(html).toContain('src="https://techcrunch.com/hero.jpg"')
  })

  it('renders playable video previews and external bylines for video cards', () => {
    const event = baseEvent({
      kind: Kind.Video,
      content: '',
      tags: [
        ['title', 'Launch Demo'],
        ['r', 'https://youtube.com/watch?v=launch-demo'],
        [
          'imeta',
          'url https://video.example.com/demo.mp4',
          'm video/mp4',
          `x ${'d'.repeat(64)}`,
          'image https://video.example.com/poster.jpg',
        ],
      ],
    })

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SecondaryCard
          event={event}
          index={0}
          checkEvent={() => allowResult}
          semanticResult={allowResult}
        />
      </MemoryRouter>,
    )

    expect(html).toContain('<video')
    expect(html).toContain('src="https://video.example.com/demo.mp4"')
    expect(html).toContain('poster="https://video.example.com/poster.jpg"')
    expect(html).toContain('By Studio Channel • youtube.com')
  })
})
