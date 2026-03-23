/**
 * Tests: Security & Sanitization
 *
 * Validates that all user input is correctly sanitized,
 * that XSS vectors are neutralized, and URL validation
 * correctly allowlists safe schemes only.
 */

import { describe, it, expect } from 'vitest'
import {
  sanitizeHTML,
  sanitizeText,
  sanitizeName,
  isSafeURL,
  isSafeMediaURL,
  isValidRelayURL,
  isValidHex32,
  isValidSig,
  isStructurallyValidEvent,
  extractURLs,
  extractHashtags,
  isValidNip05Format,
  normalizeHashtag,
  normalizeNip05Identifier,
  normalizeDomain,
  extractNip05Domain,
  LIMITS,
} from './sanitize'

describe('sanitizeHTML', () => {
  it('strips script tags', () => {
    const input  = '<p>Hello</p><script>alert(1)</script>'
    const result = sanitizeHTML(input)
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert')
    expect(result).toContain('Hello')
  })

  it('strips event handlers', () => {
    const result = sanitizeHTML('<p onclick="alert(1)">click</p>')
    expect(result).not.toContain('onclick')
  })

  it('strips javascript: hrefs', () => {
    const result = sanitizeHTML('<a href="javascript:alert(1)">link</a>')
    expect(result).not.toContain('javascript:')
  })

  it('strips data: URIs in img src', () => {
    const result = sanitizeHTML('<img src="data:image/svg+xml,<svg/onload=alert(1)>">')
    expect(result).not.toContain('onload')
  })

  it('preserves safe HTML', () => {
    const result = sanitizeHTML('<strong>Bold</strong> and <em>italic</em>')
    expect(result).toContain('<strong>Bold</strong>')
    expect(result).toContain('<em>italic</em>')
  })

  it('handles empty string', () => {
    expect(sanitizeHTML('')).toBe('')
  })

  it('handles non-string input gracefully', () => {
    expect(sanitizeHTML(null as unknown as string)).toBe('')
    expect(sanitizeHTML(undefined as unknown as string)).toBe('')
    expect(sanitizeHTML(42 as unknown as string)).toBe('')
  })

  it('truncates content over LIMITS.CONTENT_BYTES', () => {
    const oversized = 'a'.repeat(LIMITS.CONTENT_BYTES + 100)
    const result    = sanitizeHTML(oversized)
    expect(result.length).toBeLessThanOrEqual(LIMITS.CONTENT_BYTES)
  })
})

describe('sanitizeText', () => {
  it('strips all HTML tags', () => {
    expect(sanitizeText('<b>bold</b>')).toBe('bold')
    expect(sanitizeText('<script>alert(1)</script>')).not.toContain('<')
  })

  it('preserves plain text', () => {
    expect(sanitizeText('Hello world')).toBe('Hello world')
  })
})

describe('sanitizeName', () => {
  it('respects NAME_CHARS limit', () => {
    const long = 'a'.repeat(LIMITS.NAME_CHARS + 50)
    expect(sanitizeName(long).length).toBeLessThanOrEqual(LIMITS.NAME_CHARS)
  })

  it('strips HTML from display names', () => {
    expect(sanitizeName('<b>Alice</b>')).toBe('Alice')
  })
})

describe('isSafeURL', () => {
  it('allows https URLs', () => {
    expect(isSafeURL('https://example.com')).toBe(true)
    expect(isSafeURL('https://relay.damus.io/image.jpg')).toBe(true)
  })

  it('allows http URLs', () => {
    expect(isSafeURL('http://example.com')).toBe(true)
  })

  it('blocks javascript: scheme', () => {
    expect(isSafeURL('javascript:alert(1)')).toBe(false)
  })

  it('blocks data: scheme', () => {
    expect(isSafeURL('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('blocks vbscript: scheme', () => {
    expect(isSafeURL('vbscript:msgbox(1)')).toBe(false)
  })

  it('blocks file: scheme', () => {
    expect(isSafeURL('file:///etc/passwd')).toBe(false)
  })

  it('returns false for non-string', () => {
    expect(isSafeURL(null as unknown as string)).toBe(false)
  })

  it('returns false for oversized URL', () => {
    const long = 'https://example.com/' + 'a'.repeat(LIMITS.URL_CHARS)
    expect(isSafeURL(long)).toBe(false)
  })
})

describe('isSafeMediaURL', () => {
  it('allows known image extensions over https', () => {
    expect(isSafeMediaURL('https://cdn.example.com/photo.jpg')).toBe(true)
    expect(isSafeMediaURL('https://cdn.example.com/photo.png')).toBe(true)
    expect(isSafeMediaURL('https://cdn.example.com/photo.webp')).toBe(true)
    expect(isSafeMediaURL('https://cdn.example.com/avatar.svg')).toBe(true)
    expect(isSafeMediaURL(' https://cdn.example.com/header.jfif ')).toBe(true)
    expect(isSafeMediaURL('https://cdn.example.com/portrait.heic')).toBe(true)
    expect(isSafeMediaURL('https://cdn.example.com/banner.jxl')).toBe(true)
  })

  it('blocks http media (not https)', () => {
    expect(isSafeMediaURL('http://cdn.example.com/photo.jpg')).toBe(false)
  })

  it('blocks JS files disguised as media', () => {
    expect(isSafeMediaURL('https://cdn.example.com/malware.js')).toBe(false)
    expect(isSafeMediaURL('https://cdn.example.com/page.html')).toBe(false)
    expect(isSafeMediaURL('https://cdn.example.com/script.php')).toBe(false)
  })
})

describe('isValidRelayURL', () => {
  it('accepts wss:// URLs', () => {
    expect(isValidRelayURL('wss://relay.damus.io')).toBe(true)
    expect(isValidRelayURL('wss://nos.lol')).toBe(true)
  })

  it('accepts ws:// in non-HTTPS contexts', () => {
    // jsdom is not HTTPS context so ws should pass
    expect(isValidRelayURL('ws://localhost:8080')).toBe(true)
  })

  it('rejects https:// URLs', () => {
    expect(isValidRelayURL('https://relay.damus.io')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isValidRelayURL('not-a-url')).toBe(false)
    expect(isValidRelayURL('')).toBe(false)
  })
})

describe('isValidHex32', () => {
  const VALID_HEX = 'a'.repeat(64)

  it('accepts 64-char lowercase hex', () => {
    expect(isValidHex32(VALID_HEX)).toBe(true)
  })

  it('rejects wrong length', () => {
    expect(isValidHex32('a'.repeat(63))).toBe(false)
    expect(isValidHex32('a'.repeat(65))).toBe(false)
  })

  it('rejects uppercase hex (Nostr uses lowercase)', () => {
    expect(isValidHex32('A'.repeat(64))).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(isValidHex32('g'.repeat(64))).toBe(false)
    expect(isValidHex32('z'.repeat(64))).toBe(false)
  })
})

describe('isValidSig', () => {
  it('accepts 128-char lowercase hex', () => {
    expect(isValidSig('a'.repeat(128))).toBe(true)
  })

  it('rejects wrong length', () => {
    expect(isValidSig('a'.repeat(64))).toBe(false)
  })
})

describe('isStructurallyValidEvent', () => {
  const validEvent = {
    id:         'a'.repeat(64),
    pubkey:     'b'.repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind:       1,
    tags:       [['e', 'c'.repeat(64)], ['p', 'd'.repeat(64)]],
    content:    'Hello Nostr',
    sig:        'e'.repeat(128),
  }

  it('accepts a well-formed event', () => {
    expect(isStructurallyValidEvent(validEvent)).toBe(true)
  })

  it('rejects null', () => {
    expect(isStructurallyValidEvent(null)).toBe(false)
  })

  it('rejects events with future timestamps > 10min', () => {
    expect(isStructurallyValidEvent({
      ...validEvent,
      created_at: Math.floor(Date.now() / 1000) + 700,
    })).toBe(false)
  })

  it('rejects events with invalid id length', () => {
    expect(isStructurallyValidEvent({ ...validEvent, id: 'short' })).toBe(false)
  })

  it('rejects events with oversized content', () => {
    expect(isStructurallyValidEvent({
      ...validEvent,
      content: 'x'.repeat(LIMITS.CONTENT_BYTES + 1),
    })).toBe(false)
  })

  it('rejects events with too many tags', () => {
    expect(isStructurallyValidEvent({
      ...validEvent,
      tags: Array.from({ length: LIMITS.MAX_TAGS + 1 }, () => ['t', 'value']),
    })).toBe(false)
  })
})

describe('extractURLs', () => {
  it('extracts https URLs from content', () => {
    const content = 'Check https://example.com and https://other.org/path'
    expect(extractURLs(content)).toEqual([
      'https://example.com',
      'https://other.org/path',
    ])
  })

  it('filters out unsafe URLs', () => {
    const content = 'Bad javascript:alert(1) and good https://safe.com'
    const urls = extractURLs(content)
    expect(urls).not.toContain('javascript:alert(1)')
    expect(urls).toContain('https://safe.com')
  })

  it('caps at 10 URLs', () => {
    const content = Array.from(
      { length: 15 },
      (_, i) => `https://example${i}.com`
    ).join(' ')
    expect(extractURLs(content).length).toBeLessThanOrEqual(10)
  })
})

describe('extractHashtags', () => {
  it('extracts hashtags', () => {
    expect(extractHashtags('Hello #nostr and #bitcoin')).toEqual(['nostr', 'bitcoin'])
  })

  it('deduplicates hashtags', () => {
    expect(extractHashtags('#nostr #nostr #NOSTR')).toHaveLength(1)
  })

  it('normalizes to lowercase', () => {
    expect(extractHashtags('#Bitcoin')).toContain('bitcoin')
  })
})

describe('normalizeHashtag', () => {
  it('normalizes valid hashtags', () => {
    expect(normalizeHashtag('#Nostr_Dev')).toBe('nostr_dev')
  })

  it('rejects invalid hashtags', () => {
    expect(normalizeHashtag('#123nostr')).toBeNull()
    expect(normalizeHashtag('')).toBeNull()
  })
})

describe('isValidNip05Format', () => {
  it('accepts valid NIP-05 identifiers', () => {
    expect(isValidNip05Format('alice@example.com')).toBe(true)
    expect(isValidNip05Format('_@example.com')).toBe(true)
  })

  it('rejects identifiers without @', () => {
    expect(isValidNip05Format('noatsign')).toBe(false)
  })

  it('rejects identifiers with multiple @', () => {
    expect(isValidNip05Format('a@b@c.com')).toBe(false)
  })

  it('rejects oversized identifiers', () => {
    expect(isValidNip05Format('a'.repeat(LIMITS.NIP05_CHARS + 1))).toBe(false)
  })
})

describe('normalizeNip05Identifier', () => {
  it('normalizes case and surrounding whitespace', () => {
    expect(normalizeNip05Identifier(' Alice@Example.COM ')).toBe('alice@example.com')
  })

  it('rejects invalid identifiers', () => {
    expect(normalizeNip05Identifier('not-an-identifier')).toBeNull()
  })
})

describe('normalizeDomain', () => {
  it('normalizes valid domains', () => {
    expect(normalizeDomain('Example.COM.')).toBe('example.com')
  })

  it('rejects invalid domains', () => {
    expect(normalizeDomain('localhost')).toBeNull()
    expect(normalizeDomain('-example.com')).toBeNull()
  })
})

describe('extractNip05Domain', () => {
  it('extracts the normalized domain from a valid NIP-05 identifier', () => {
    expect(extractNip05Domain('alice@Example.COM')).toBe('example.com')
  })

  it('returns null for invalid identifiers', () => {
    expect(extractNip05Domain('not-an-identifier')).toBeNull()
  })
})
