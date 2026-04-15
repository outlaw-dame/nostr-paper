/**
 * NoteContent
 *
 * Renders Nostr note content safely:
 * - All HTML stripped, plain text only
 * - URLs rendered as clickable links (https only)
 * - Hashtags linkified (#tag)
 * - Cashtags linkified ($BTC)
 * - nostr: URIs rendered as mention chips
 * - Newlines preserved
 *
 * Never uses dangerouslySetInnerHTML — builds React elements directly.
 */

import React from 'react'
import { Link } from 'react-router-dom'
import { MarkdownContent } from '@/components/article/MarkdownContent'
import { EntityPreviewStack } from '@/components/cards/EntityPreviewStack'
import { Nip21Mention } from '@/components/nostr/Nip21Mention'
import { TranslateTextPanel } from '@/components/translation/TranslateTextPanel'
import { collectEntityCandidates } from '@/lib/text/entityPreview'
import { CASHTAG_PATTERN, HASHTAG_PATTERN, NOSTR_PATTERN, URL_PATTERN, hasEntityBoundaryBefore } from '@/lib/text/entities'
import { normalizeHashtag, sanitizeText, isSafeURL, stripUrlTrailingPunct } from '@/lib/security/sanitize'
import { TwemojiText } from '@/components/ui/TwemojiText'

interface NoteContentProps {
  content:   string
  className?: string
  compact?:  boolean  // Single line, truncated
  hiddenUrls?: string[]
  interactive?: boolean
  allowTranslation?: boolean
  enableMarkdown?: boolean
  showEntityPreviews?: boolean
}

type ContentToken =
  | { type: 'text';   value: string }
  | { type: 'url';    value: string }
  | { type: 'hashtag'; value: string }
  | { type: 'cashtag'; value: string }
  | { type: 'nostr';  value: string }
  | { type: 'newline' }

function tryParseBridgeContent(content: string): string {
  const trimmed = content.trim()

  if (trimmed.startsWith('xitchat-broadcast-v1-')) {
    try {
      const data = JSON.parse(trimmed.slice(21))
      if (data.type === 'discovery' && typeof data.content === 'string') {
        const info = JSON.parse(data.content)
        const name = info.handle || info.name || 'User'
        return `📡 XitChat: ${name}`
      }
    } catch { /* keep original */ }
    return content
  }

  if (trimmed.startsWith('nlogpost:')) {
    const parts = trimmed.split(':')
    if (parts.length >= 3) {
      return parts.slice(2).join(':')
    }
    return content
  }

  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return content

  try {
    const data = JSON.parse(trimmed)

    // Handle "zone_presence" (Holepunch/Keet/P2P Gateway status)
    if (data && data.type === 'zone_presence') {
      const role = typeof data.role === 'string' ? data.role : 'Node'
      const cpu = data.metrics?.cpuPct
      return `📡 Zone Presence: ${role}${cpu !== undefined ? ` (CPU: ${cpu}%)` : ''}`
    }

    // Handle common chat-bridge JSON format (e.g. YouTube/Twitch bridges)
    // { p: platform, u: user, m: message, ... }
    if (data && typeof data === 'object' && typeof data.m === 'string' && typeof data.u === 'string') {
      return `${data.u}: ${data.m}`
    }
  } catch {
    // Not JSON, return original content
  }
  return content
}

function tokenize(raw: string): ContentToken[] {
  const text = sanitizeText(raw)
  const tokens: ContentToken[] = []

  // Combined regex for all patterns
  const COMBINED = new RegExp(
    `(${URL_PATTERN.source})|(${HASHTAG_PATTERN.source})|(${CASHTAG_PATTERN.source})|(${NOSTR_PATTERN.source})|\n`,
    'g'
  )

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = COMBINED.exec(text)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }

    const matched = match[0]!

    if (matched === '\n') {
      tokens.push({ type: 'newline' })
    } else if (matched.startsWith('http')) {
      const cleaned = stripUrlTrailingPunct(matched)
      if (isSafeURL(cleaned)) {
        tokens.push({ type: 'url', value: cleaned })
      } else {
        tokens.push({ type: 'text', value: matched })
      }
    } else if (matched.startsWith('#')) {
      if (!hasEntityBoundaryBefore(text, match.index)) {
        tokens.push({ type: 'text', value: matched })
        lastIndex = COMBINED.lastIndex
        continue
      }
      tokens.push({ type: 'hashtag', value: matched.slice(1) })
    } else if (matched.startsWith('$')) {
      if (!hasEntityBoundaryBefore(text, match.index)) {
        tokens.push({ type: 'text', value: matched })
        lastIndex = COMBINED.lastIndex
        continue
      }
      tokens.push({ type: 'cashtag', value: matched.slice(1) })
    } else if (matched.startsWith('nostr:')) {
      if (!hasEntityBoundaryBefore(text, match.index)) {
        tokens.push({ type: 'text', value: matched })
        lastIndex = COMBINED.lastIndex
        continue
      }
      tokens.push({ type: 'nostr', value: matched })
    } else {
      tokens.push({ type: 'text', value: matched })
    }

    lastIndex = COMBINED.lastIndex
  }

  // Remaining text
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return tokens
}

function stopPropagation(event: React.MouseEvent<HTMLElement>) {
  event.stopPropagation()
}

function renderToken(token: ContentToken, key: number, compact: boolean, interactive: boolean) {
  switch (token.type) {
    case 'text':
      return <React.Fragment key={key}><TwemojiText text={token.value} /></React.Fragment>

    case 'newline':
      return compact ? <span key={key}> </span> : <br key={key} />

    case 'url': {
      let display = token.value
      try {
        const parsed = new URL(token.value)
        display = parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '')
        if (display.length > 40) display = display.slice(0, 40) + '…'
      } catch { /* use full URL */ }

      if (!interactive) {
        return (
          <span
            key={key}
            className="
              text-[#007AFF] underline decoration-[#007AFF]/30
              underline-offset-2 break-all
            "
          >
            <TwemojiText text={display} />
          </span>
        )
      }

      return (
        <a
          key={key}
          href={token.value}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={stopPropagation}
          className="
            text-[#007AFF] underline decoration-[#007AFF]/30
            underline-offset-2 break-all
          "
        >
          <TwemojiText text={display} />
        </a>
      )
    }

    case 'hashtag': {
      const normalized = normalizeHashtag(token.value)
      if (!normalized) {
        return <React.Fragment key={key}>#{token.value}</React.Fragment>
      }

      if (!interactive) {
        return (
          <span
            key={key}
            className="text-[#007AFF] font-medium"
          >
            <TwemojiText text={`#${token.value}`} />
          </span>
        )
      }

      return (
        <Link
          key={key}
          to={`/t/${encodeURIComponent(normalized)}`}
          onClick={stopPropagation}
          className="text-[#007AFF] font-medium"
        >
          <TwemojiText text={`#${token.value}`} />
        </Link>
      )
    }

    case 'cashtag': {
      const ticker = token.value.toUpperCase()
      if (!interactive) {
        return (
          <span key={key} className="text-[rgb(var(--color-system-green))] font-medium">
            ${ticker}
          </span>
        )
      }

      return (
        <Link
          key={key}
          to={`/t/${encodeURIComponent(ticker)}`} // Route cashtags to tag search
          onClick={stopPropagation}
          className="text-[rgb(var(--color-system-green))] font-medium"
        >
          ${ticker}
        </Link>
      )
    }

    case 'nostr':
      {
        return (
          <Nip21Mention
            key={key}
            value={token.value}
            interactive={interactive}
          />
        )
      }

    default:
      return null
  }
}

function filterTokens(tokens: ContentToken[], hiddenUrls: Set<string>): ContentToken[] {
  if (hiddenUrls.size === 0) return tokens

  const filtered = tokens.filter((token) => token.type !== 'url' || !hiddenUrls.has(token.value))
  const collapsed: ContentToken[] = []

  for (const token of filtered) {
    if (token.type === 'newline') {
      const previous = collapsed[collapsed.length - 1]
      if (!previous || previous.type === 'newline') continue
      collapsed.push(token)
      continue
    }

    if (token.type === 'text' && token.value.length === 0) {
      continue
    }

    collapsed.push(token)
  }

  while (collapsed[0]?.type === 'newline') collapsed.shift()
  while (collapsed[collapsed.length - 1]?.type === 'newline') collapsed.pop()

  return collapsed
}

function tokensToPlainText(tokens: ContentToken[]): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case 'text':
        case 'url':
        case 'nostr':
          return token.value
        case 'hashtag':
          return `#${token.value}`
        case 'cashtag':
          return `$${token.value}`
        case 'newline':
          return '\n'
        default:
          return ''
      }
    })
    .join('')
    .trim()
}

/**
 * Calculate text length excluding URLs (they don't count against character limit).
 */
function getTextLengthWithoutUrls(tokens: ContentToken[]): number {
  let length = 0
  for (const token of tokens) {
    switch (token.type) {
      case 'url':
        // URLs don't count
        break
      case 'text':
        length += token.value.length
        break
      case 'hashtag':
        length += token.value.length + 1 // +1 for '#'
        break
      case 'cashtag':
        length += token.value.length + 1 // +1 for '$'
        break
      case 'nostr':
        length += token.value.length
        break
      case 'newline':
        length += 1
        break
    }
  }
  return length
}

/**
 * Truncate tokens to a maximum display length on word boundaries.
 * URLs do NOT count against the character limit.
 * This ensures Tailwind's line-clamp doesn't cut mid-word.
 */
function truncateTokensAtWordBoundary(tokens: ContentToken[], maxLength: number): ContentToken[] {
  const result: ContentToken[] = []
  let charCount = 0
  let truncated = false

  for (const token of tokens) {
    if (truncated) break

    switch (token.type) {
      case 'newline':
        // Insert newline but track as character
        result.push(token)
        charCount += 1
        break

      case 'text': {
        const remaining = maxLength - charCount
        if (remaining <= 0) {
          truncated = true
          break
        }

        if (token.value.length <= remaining) {
          // Fits completely
          result.push(token)
          charCount += token.value.length
        } else {
          // Need to truncate - find word boundary
          let truncated_text = token.value.slice(0, remaining)
          
          // Try to find the last space to avoid cutting mid-word
          const lastSpace = truncated_text.lastIndexOf(' ')
          if (lastSpace > Math.max(remaining * 0.6, 10)) {
            // Good word break found (at least 60% of allocated space or 10 chars)
            truncated_text = truncated_text.slice(0, lastSpace).trimEnd()
          }

          if (truncated_text.length > 0) {
            result.push({ type: 'text', value: truncated_text })
            charCount += truncated_text.length
          }
          truncated = true
        }
        break
      }

      case 'url': {
        // URLs don't count against character limit, always include them
        result.push(token)
        break
      }

      case 'hashtag': {
        const hashtagLen = token.value.length + 1 // '#' + tag
        const remaining = maxLength - charCount
        if (remaining >= hashtagLen) {
          result.push(token)
          charCount += hashtagLen
        } else {
          truncated = true
        }
        break
      }

      case 'cashtag': {
        const cashtagLen = token.value.length + 1 // '$' + tag
        const remaining = maxLength - charCount
        if (remaining >= cashtagLen) {
          result.push(token)
          charCount += cashtagLen
        } else {
          truncated = true
        }
        break
      }

      case 'nostr': {
        const nostrLen = token.value.length // rough estimate
        const remaining = maxLength - charCount
        if (remaining >= nostrLen) {
          result.push(token)
          charCount += nostrLen
        } else {
          truncated = true
        }
        break
      }
    }
  }

  return result
}

export function NoteContent({
  content,
  className = '',
  compact = false,
  hiddenUrls = [],
  interactive = true,
  allowTranslation = false,
  enableMarkdown = false,
  showEntityPreviews = true,
}: NoteContentProps) {
  const hiddenUrlSet = React.useMemo(() => new Set(hiddenUrls), [hiddenUrls])
  const tokens = React.useMemo(
    () => filterTokens(tokenize(tryParseBridgeContent(content)), hiddenUrlSet),
    [content, hiddenUrlSet],
  )
  const plainText = React.useMemo(
    () => tokensToPlainText(tokens),
    [tokens],
  )
  const translationSourceText = plainText
  const shouldClampCompactText = React.useMemo(() => {
    if (!plainText) return false
    const textLengthExcludingUrls = getTextLengthWithoutUrls(tokens)
    if (textLengthExcludingUrls <= 500) return false
    return true
  }, [plainText, tokens])
  const entityCandidates = React.useMemo(
    () => collectEntityCandidates(
      tokens.filter(
        (token): token is Extract<ContentToken, { type: 'url' | 'nostr' }> => (
          token.type === 'url' || token.type === 'nostr'
        ),
      ),
    ),
    [tokens],
  )

  // For compact mode, truncate tokens at word boundaries to prevent mid-word cuts
  const compactTokens = React.useMemo(
    () => compact ? truncateTokensAtWordBoundary(tokens, 500) : tokens,
    [tokens, compact],
  )

  if (compact) {
    return (
      <>
        <p className={`
          text-[rgb(var(--color-label-secondary))] text-[15px]
          leading-snug ${shouldClampCompactText ? 'line-clamp-2' : ''} ${className}
        `}>
          {compactTokens.map((token, index) => renderToken(token, index, true, interactive))}
        </p>
        {allowTranslation && translationSourceText && (
          <TranslateTextPanel text={translationSourceText} />
        )}
      </>
    )
  }

  if (enableMarkdown) {
    return (
      <>
        <MarkdownContent content={content} className={className} interactive={interactive} />
        {interactive && showEntityPreviews && entityCandidates.length > 0 && (
          <EntityPreviewStack candidates={entityCandidates} />
        )}
        {allowTranslation && translationSourceText && (
          <TranslateTextPanel text={translationSourceText} />
        )}
      </>
    )
  }

  return (
    <>
      <p className={`
        text-[rgb(var(--color-label))] text-body leading-relaxed
        break-words ${className}
      `}>
        {tokens.map((token, index) => renderToken(token, index, false, interactive))}
      </p>
      {interactive && showEntityPreviews && entityCandidates.length > 0 && (
        <EntityPreviewStack candidates={entityCandidates} />
      )}
      {allowTranslation && translationSourceText && (
        <TranslateTextPanel text={translationSourceText} />
      )}
    </>
  )
}
