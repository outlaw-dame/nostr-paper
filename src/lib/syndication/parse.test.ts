import { describe, expect, it } from 'vitest'
import { parseSyndicationFeedDocument } from '@/lib/syndication/parse'

describe('parseSyndicationFeedDocument', () => {
  it('parses RSS documents', async () => {
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example RSS</title>
    <link>https://example.com</link>
    <description>Sample rss feed</description>
    <item>
      <title>Entry One</title>
      <link>https://example.com/posts/1</link>
      <guid>post-1</guid>
      <description>Entry summary</description>
    </item>
  </channel>
</rss>`

    const parsed = await parseSyndicationFeedDocument(rss, 'https://example.com/feed.xml')

    expect(parsed).not.toBeNull()
    expect(parsed?.format).toBe('rss')
    expect(parsed?.title).toBe('Example RSS')
    expect(parsed?.items).toHaveLength(1)
  })

  it('parses Atom documents', async () => {
    const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <id>https://example.com/atom</id>
  <updated>2026-04-15T00:00:00Z</updated>
  <entry>
    <title>Atom Entry</title>
    <id>tag:example.com,2026:entry-1</id>
    <updated>2026-04-15T00:00:00Z</updated>
    <link href="https://example.com/posts/atom-1" />
    <summary>Atom summary</summary>
  </entry>
</feed>`

    const parsed = await parseSyndicationFeedDocument(atom, 'https://example.com/atom.xml')

    expect(parsed).not.toBeNull()
    expect(parsed?.format).toBe('atom')
    expect(parsed?.title).toBe('Example Atom')
    expect(parsed?.items).toHaveLength(1)
  })

  it('parses RDF documents', async () => {
    const rdf = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns="http://purl.org/rss/1.0/">
  <channel rdf:about="https://example.com/rdf">
    <title>Example RDF</title>
    <link>https://example.com</link>
    <description>Sample RDF feed</description>
  </channel>
  <item rdf:about="https://example.com/posts/rdf-1">
    <title>RDF Entry</title>
    <link>https://example.com/posts/rdf-1</link>
    <description>RDF summary</description>
  </item>
</rdf:RDF>`

    const parsed = await parseSyndicationFeedDocument(rdf, 'https://example.com/rdf.xml')

    expect(parsed).not.toBeNull()
    expect(parsed?.format).toBe('rdf')
    expect(parsed?.title).toBe('Example RDF')
    expect(parsed?.items).toHaveLength(1)
  })

  it('parses JSON Feed and maps Podcasting metadata', async () => {
    const jsonFeed = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Example JSON Feed',
      home_page_url: 'https://example.com',
      feed_url: 'https://example.com/feed.json',
      podcast: {
        medium: 'podcast',
        person: [{ name: 'Host One', role: 'host' }],
      },
      items: [
        {
          id: 'json-1',
          url: 'https://example.com/posts/json-1',
          title: 'JSON Entry',
          content_text: 'Hello world',
          podcast: {
            guid: 'ep-1',
            episode: 1,
            season: 2,
          },
        },
      ],
    })

    const parsed = await parseSyndicationFeedDocument(jsonFeed, 'https://example.com/feed.json')

    expect(parsed).not.toBeNull()
    expect(parsed?.format).toBe('json')
    expect(parsed?.title).toBe('Example JSON Feed')
    expect(parsed?.items).toHaveLength(1)
    expect(parsed?.podcast?.medium).toBe('podcast')
    expect(parsed?.podcast?.persons[0]?.name).toBe('Host One')
    expect(parsed?.items[0]?.podcast?.guid).toBe('ep-1')
  })
})
