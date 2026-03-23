/**
 * TwemojiText
 *
 * Renders a plain-text string with emoji replaced by Twemoji SVG images,
 * providing consistent cross-platform emoji appearance.
 *
 * Uses twemoji-parser to detect emoji codepoint sequences and builds
 * React img elements (no dangerouslySetInnerHTML).
 */

import React from 'react'
import { parse } from 'twemoji-parser'

// Prefer the jsdelivr CDN mirror (no maxcdn dependency)
function buildUrl(codepoints: string): string {
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codepoints}.svg`
}

interface TwemojiTextProps {
  text: string
}

export function TwemojiText({ text }: TwemojiTextProps) {
  const entities = React.useMemo(
    () => parse(text, { buildUrl }),
    [text]
  )

  if (entities.length === 0) {
    return <>{text}</>
  }

  const parts: React.ReactNode[] = []
  let cursor = 0

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]!
    const [start, end] = entity.indices

    if (start > cursor) {
      parts.push(text.slice(cursor, start))
    }

    parts.push(
      <img
        key={i}
        src={entity.url}
        alt={entity.text}
        aria-label={entity.text}
        draggable={false}
        className="inline-block align-[-0.125em] w-[1.1em] h-[1.1em]"
      />
    )

    cursor = end
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return <>{parts}</>
}
