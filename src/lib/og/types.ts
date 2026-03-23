/**
 * Open Graph / link preview data types.
 *
 * Populated by the OG proxy and consumed by useLinkPreview / LinkPreviewCard.
 */

export interface OGData {
  /** Canonical URL of the page (may differ from the input after redirects) */
  url:           string
  title?:        string
  description?:  string
  /** og:image or twitter:image, resolved to an absolute URL */
  image?:        string
  /** og:site_name */
  siteName?:     string
  /**
   * Author string — sourced (in priority order) from:
   *   JSON-LD Article.author.name → meta[name=author] →
   *   meta[property=article:author] → meta[name=twitter:creator]
   */
  author?:       string
  /**
   * If the page carries <meta name="nostr:creator" content="npub1...">,
   * this is the raw npub value. Lets us link to the author's Nostr profile.
   */
  nostrCreator?: string
  /**
   * NIP-05 identifier from <meta name="nostr:creator:nip05">.
   * Only present when the site explicitly publishes it (and it is verified).
   */
  nostrNip05?:   string
  /** Resolved favicon URL */
  favicon?:      string
}
