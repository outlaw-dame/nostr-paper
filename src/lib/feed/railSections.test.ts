import { describe, expect, it } from 'vitest'
import { buildFeedRailSections } from './railSections'

interface TestRailSection {
  id: string
  label: string
}

const DEFAULT_SECTIONS: TestRailSection[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'notes', label: 'Notes' },
  { id: 'articles', label: 'Articles' },
]

describe('buildFeedRailSections', () => {
  it('places saved tag feeds after Feed and before the rest of the defaults', () => {
    const sections = buildFeedRailSections({
      defaultSections: DEFAULT_SECTIONS,
      savedTagSections: [
        { id: 'tag-feed:intelligence', label: '#intelligence' },
        { id: 'tag-feed:apple', label: 'Apple' },
      ],
      routeSection: null,
    })

    expect(sections.map((section) => section.id)).toEqual([
      'feed',
      'tag-feed:intelligence',
      'tag-feed:apple',
      'notes',
      'articles',
    ])
  })

  it('places an ephemeral route tag feed before Notes', () => {
    const sections = buildFeedRailSections({
      defaultSections: DEFAULT_SECTIONS,
      savedTagSections: [{ id: 'tag-feed:apple', label: 'Apple' }],
      routeSection: { id: 'tag-route:intelligence', label: '#intelligence' },
    })

    expect(sections.map((section) => section.id)).toEqual([
      'feed',
      'tag-route:intelligence',
      'tag-feed:apple',
      'notes',
      'articles',
    ])
  })

  it('does not duplicate a matched saved route section', () => {
    const sections = buildFeedRailSections({
      defaultSections: DEFAULT_SECTIONS,
      savedTagSections: [{ id: 'tag-feed:intelligence', label: '#intelligence' }],
      routeSection: { id: 'tag-feed:intelligence', label: '#intelligence' },
    })

    expect(sections.map((section) => section.id)).toEqual([
      'feed',
      'tag-feed:intelligence',
      'notes',
      'articles',
    ])
  })
})
