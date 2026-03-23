import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { noteEncode, npubEncode } from 'nostr-tools/nip19'
import { NoteContent } from './NoteContent'

vi.mock('@/hooks/useProfile', () => ({
  useProfile: (pubkey: string) => ({
    profile: pubkey === 'a'.repeat(64)
      ? {
        name: 'damon',
        display_name: 'Damon',
      }
      : null,
  }),
}))

vi.mock('@/components/ui/TwemojiText', () => ({
  TwemojiText: ({ text }: { text: string }) => <>{text}</>,
}))

vi.mock('@/components/links/LinkPreviewCard', () => ({
  LinkPreviewCard: () => null,
}))

vi.mock('@/components/translation/TranslateTextPanel', () => ({
  TranslateTextPanel: () => null,
}))

describe('NoteContent', () => {
  it('renders profile mentions, event references, and standalone cashtags in plain text mode', () => {
    const npub = npubEncode('a'.repeat(64))
    const note = noteEncode('b'.repeat(64))

    const html = renderToStaticMarkup(
      <StaticRouter location="/">
        <NoteContent content={`See nostr:${npub} and nostr:${note} with $btc but not wallet$btc.`} />
      </StaticRouter>,
    )

    expect(html).toContain('@Damon')
    expect(html).toContain(`href="/profile/${npub}"`)
    expect(html).toContain(`href="/note/${note}"`)
    expect(html.match(/href="\/t\/BTC"/g)).toHaveLength(1)
    expect(html).toContain('wallet$btc')
  })

  it('applies the same smart entity rendering in markdown mode', () => {
    const npub = npubEncode('a'.repeat(64))
    const note = noteEncode('c'.repeat(64))

    const html = renderToStaticMarkup(
      <StaticRouter location="/">
        <NoteContent
          enableMarkdown
          content={`Paragraph with nostr:${npub}, $nostr, and [source](nostr:${note}) plus wallet$nostr.`}
        />
      </StaticRouter>,
    )

    expect(html).toContain('@Damon')
    expect(html).toContain(`href="/profile/${npub}"`)
    expect(html).toContain(`href="/note/${note}"`)
    expect(html.match(/href="\/t\/NOSTR"/g)).toHaveLength(1)
    expect(html).toContain('wallet$nostr')
    expect(html).toContain('source')
  })

  it('parses nlogpost content correctly', () => {
    const html = renderToStaticMarkup(
      <StaticRouter location="/">
        <NoteContent content="nlogpost:1774054938:[[[[haxx ready xepicstrange]]]]" />
      </StaticRouter>,
    )

    expect(html).toContain('[[[[haxx ready xepicstrange]]]]')
    expect(html).not.toContain('nlogpost:1774054938:')
  })
})
