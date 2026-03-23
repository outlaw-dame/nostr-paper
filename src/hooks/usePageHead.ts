/**
 * usePageHead
 *
 * Lightweight imperative head management for a client-side SPA.
 * Injects meta/link tags and updates <title> on mount, restores on unmount.
 *
 * No external library — uses the DOM directly.
 *
 * Usage:
 *   usePageHead({
 *     title: 'My Article — Nostr Paper',
 *     tags: [
 *       { tag: 'meta', name: 'description', content: 'Summary text' },
 *       { tag: 'meta', property: 'og:title', content: 'My Article' },
 *       { tag: 'link', rel: 'author', href: 'nostr:npub1...' },
 *     ],
 *   })
 */

import { useEffect } from 'react'

// ── Descriptor Types ─────────────────────────────────────────

export type MetaTagDescriptor =
  | { tag: 'meta'; name: string; content: string }
  | { tag: 'meta'; property: string; content: string }
  | { tag: 'link'; rel: string; href: string }

export interface PageHeadOptions {
  title?: string
  tags?: MetaTagDescriptor[]
}

// ── Helpers ──────────────────────────────────────────────────

const INJECTED_ATTR = 'data-nostr-paper'

function createElement(descriptor: MetaTagDescriptor): HTMLElement {
  if (descriptor.tag === 'link') {
    const el = document.createElement('link')
    el.rel  = descriptor.rel
    el.href = descriptor.href
    el.setAttribute(INJECTED_ATTR, '')
    return el
  }

  const el = document.createElement('meta')
  if ('name' in descriptor) {
    el.name    = descriptor.name
  } else {
    el.setAttribute('property', descriptor.property)
  }
  el.content = descriptor.content
  el.setAttribute(INJECTED_ATTR, '')
  return el
}

// ── Hook ─────────────────────────────────────────────────────

export function usePageHead({ title, tags = [] }: PageHeadOptions): void {
  useEffect(() => {
    if (typeof document === 'undefined') return

    // --- Title ---
    const previousTitle = document.title
    if (title) document.title = title

    // --- Tags ---
    const inserted: HTMLElement[] = []
    for (const descriptor of tags) {
      const el = createElement(descriptor)
      document.head.appendChild(el)
      inserted.push(el)
    }

    return () => {
      if (title) document.title = previousTitle
      for (const el of inserted) {
        el.parentNode?.removeChild(el)
      }
    }
  // Tags array identity doesn't change across re-renders unless rebuilt — serialize
  // to a stable string to prevent infinite loops from inline array literals.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, JSON.stringify(tags)])
}
