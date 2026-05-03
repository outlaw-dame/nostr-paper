import React from 'react'
import { Link } from 'react-router-dom'
import { Nip21Mention } from '@/components/nostr/Nip21Mention'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { useMediaModerationDocument } from '@/hooks/useMediaModeration'
import { MediaRevealGate, getMediaRevealReason } from '@/components/media/MediaRevealGate'
import { buildMediaModerationDocument } from '@/lib/moderation/mediaContent'
import { getNip21Route } from '@/lib/nostr/nip21'
import { isSafeMarkdownLinkDestination } from '@/lib/nostr/longForm'
import { CASHTAG_PATTERN, HASHTAG_PATTERN, NOSTR_PATTERN, URL_PATTERN, hasEntityBoundaryBefore, isNostrReferenceToken } from '@/lib/text/entities'
import { isSafeMediaURL, isSafeURL, normalizeHashtag, sanitizeText } from '@/lib/security/sanitize'

interface MarkdownContentProps {
  content: string
  className?: string
  interactive?: boolean
}

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'code'; code: string; language?: string }
  | { type: 'image'; alt?: string; url: string }
  | { type: 'hr' }

type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; label: string; href: string }
  | { type: 'strong'; value: string }
  | { type: 'em'; value: string }
  | { type: 'strikethrough'; value: string }
  | { type: 'nostr'; value: string }
  | { type: 'hashtag'; value: string }
  | { type: 'cashtag'; value: string }

const CODE_FENCE = /^```([a-z0-9_+-]{0,24})\s*$/i
const HEADING = /^(#{1,6})\s+(.+?)\s*$/
const BLOCKQUOTE = /^>\s?(.*)$/
const UNORDERED_ITEM = /^[-*+]\s+(.+)$/
const ORDERED_ITEM = /^\d+\.\s+(.+)$/
const HR = /^([-*_])(?:\s*\1){2,}\s*$/
const STANDALONE_IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/
const INLINE_PATTERN = new RegExp(
  [
    '(`[^`\\n]+`)',
    '(\\[([^\\]\\n]{1,300})\\]\\(([^)\\s]{1,2048})\\))',
    '(\\*\\*([^*\\n][\\s\\S]*?[^*\\n])\\*\\*)',
    '(\\*([^*\\n][\\s\\S]*?[^*\\n])\\*)',
    '(~~([^~\\n]+)~~)',
    `(${NOSTR_PATTERN.source})`,
    `(${URL_PATTERN.source})`,
    `(${HASHTAG_PATTERN.source})`,
    `(${CASHTAG_PATTERN.source})`,
  ].join('|'),
  'g',
)

function stopPropagation(event: React.MouseEvent<HTMLElement>) {
  event.stopPropagation()
}

function parseBlocks(rawContent: string): MarkdownBlock[] {
  const content = rawContent.replace(/\r\n?/g, '\n')
  const lines = content.split('\n')
  const blocks: MarkdownBlock[] = []

  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (trimmed.length === 0) {
      index++
      continue
    }

    const fence = trimmed.match(CODE_FENCE)
    if (fence) {
      const codeLines: string[] = []
      index++
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[index] ?? '')
        index++
      }
      if (index < lines.length) index++
      const language = sanitizeText(fence[1] ?? '').trim()
      blocks.push({
        type: 'code',
        code: codeLines.join('\n'),
        ...(language ? { language } : {}),
      })
      continue
    }

    if (HR.test(trimmed)) {
      blocks.push({ type: 'hr' })
      index++
      continue
    }

    const heading = trimmed.match(HEADING)
    if (heading?.[1] && heading[2]) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: heading[2],
      })
      index++
      continue
    }

    const image = trimmed.match(STANDALONE_IMAGE)
    if (image?.[2] && isSafeMediaURL(image[2])) {
      blocks.push({
        type: 'image',
        url: image[2],
        ...(image[1] ? { alt: sanitizeText(image[1]).trim() } : {}),
      })
      index++
      continue
    }

    if (BLOCKQUOTE.test(trimmed)) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim()
        const match = current.match(BLOCKQUOTE)
        if (!match) break
        quoteLines.push(match[1] ?? '')
        index++
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join(' ') })
      continue
    }

    if (UNORDERED_ITEM.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim()
        const match = current.match(UNORDERED_ITEM)
        if (!match?.[1]) break
        items.push(match[1])
        index++
      }
      blocks.push({ type: 'unordered-list', items })
      continue
    }

    if (ORDERED_ITEM.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim()
        const match = current.match(ORDERED_ITEM)
        if (!match?.[1]) break
        items.push(match[1])
        index++
      }
      blocks.push({ type: 'ordered-list', items })
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      const currentTrimmed = current.trim()
      if (
        currentTrimmed.length === 0 ||
        CODE_FENCE.test(currentTrimmed) ||
        HR.test(currentTrimmed) ||
        HEADING.test(currentTrimmed) ||
        STANDALONE_IMAGE.test(currentTrimmed) ||
        BLOCKQUOTE.test(currentTrimmed) ||
        UNORDERED_ITEM.test(currentTrimmed) ||
        ORDERED_ITEM.test(currentTrimmed)
      ) {
        break
      }
      paragraphLines.push(currentTrimmed)
      index++
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') })
  }

  return blocks
}

function tokenizeInline(raw: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = INLINE_PATTERN.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: raw.slice(lastIndex, match.index) })
    }

    const matched = match[0] ?? ''
    if (matched.startsWith('`') && matched.endsWith('`')) {
      tokens.push({ type: 'code', value: matched.slice(1, -1) })
    } else if (matched.startsWith('[') && match[3] && match[4]) {
      tokens.push({ type: 'link', label: match[3], href: match[4] })
    } else if (matched.startsWith('**') && matched.endsWith('**') && match[6]) {
      tokens.push({ type: 'strong', value: match[6] })
    } else if (matched.startsWith('*') && matched.endsWith('*') && match[8]) {
      tokens.push({ type: 'em', value: match[8] })
    } else if (matched.startsWith('~~') && matched.endsWith('~~') && match[10]) {
      tokens.push({ type: 'strikethrough', value: match[10] })
    } else if (isNostrReferenceToken(matched)) {
      if (!hasEntityBoundaryBefore(raw, match.index)) {
        tokens.push({ type: 'text', value: matched })
      } else {
        tokens.push({ type: 'nostr', value: matched })
      }
    } else if (matched.startsWith('http')) {
      tokens.push({ type: 'link', label: matched, href: matched })
    } else if (matched.startsWith('#')) {
      if (!hasEntityBoundaryBefore(raw, match.index)) {
        tokens.push({ type: 'text', value: matched })
      } else {
        tokens.push({ type: 'hashtag', value: matched.slice(1) })
      }
    } else if (matched.startsWith('$')) {
      if (!hasEntityBoundaryBefore(raw, match.index)) {
        tokens.push({ type: 'text', value: matched })
      } else {
        tokens.push({ type: 'cashtag', value: matched.slice(1) })
      }
    } else {
      tokens.push({ type: 'text', value: matched })
    }

    lastIndex = INLINE_PATTERN.lastIndex
  }

  if (lastIndex < raw.length) {
    tokens.push({ type: 'text', value: raw.slice(lastIndex) })
  }

  return tokens
}

function renderText(text: string): React.ReactNode {
  const safeText = sanitizeText(text)
  return <TwemojiText text={safeText} />
}

function renderLink(label: string, href: string, interactive = true): React.ReactNode {
  const safeLabel = sanitizeText(label).trim() || href

  if (!interactive) {
    return (
      <span className="text-[#007AFF] underline decoration-[#007AFF]/30 underline-offset-2 break-all">
        <TwemojiText text={safeLabel} />
      </span>
    )
  }

  const internalRoute = getNip21Route(href)

  if (internalRoute) {
    return (
      <Link
        to={internalRoute}
        onClick={stopPropagation}
        className="text-[#007AFF] underline decoration-[#007AFF]/30 underline-offset-2"
      >
        <TwemojiText text={safeLabel} />
      </Link>
    )
  }

  if (!isSafeMarkdownLinkDestination(href)) {
    return renderText(label)
  }

  const safeHref = href.startsWith('nostr:') ? href : (isSafeURL(href) ? href : null)
  if (!safeHref) {
    return renderText(label)
  }

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={stopPropagation}
      className="text-[#007AFF] underline decoration-[#007AFF]/30 underline-offset-2 break-all"
    >
      <TwemojiText text={safeLabel} />
    </a>
  )
}

function renderInline(raw: string, depth = 0, interactive = true): React.ReactNode[] {
  const tokens = tokenizeInline(raw)

  return tokens.map((token, index) => {
    const key = `${depth}-${index}`

    switch (token.type) {
      case 'text':
        return <React.Fragment key={key}>{renderText(token.value)}</React.Fragment>
      case 'code':
        return (
          <code
            key={key}
            className="rounded-md bg-[rgb(var(--color-fill)/0.08)] px-1.5 py-0.5 text-[0.92em] font-mono"
          >
            {sanitizeText(token.value)}
          </code>
        )
      case 'link':
        return <React.Fragment key={key}>{renderLink(token.label, token.href, interactive)}</React.Fragment>
      case 'strong':
        return <strong key={key}>{renderInline(token.value, depth + 1, interactive)}</strong>
      case 'em':
        return <em key={key}>{renderInline(token.value, depth + 1, interactive)}</em>
      case 'strikethrough':
        return <del key={key}>{renderInline(token.value, depth + 1, interactive)}</del>
      case 'nostr':
        return (
          <Nip21Mention
            key={key}
            value={token.value}
            interactive={interactive}
          />
        )
      case 'hashtag': {
        const normalized = normalizeHashtag(token.value)
        if (!normalized) {
          return <React.Fragment key={key}>#{sanitizeText(token.value)}</React.Fragment>
        }
        if (!interactive) {
          return (
            <span key={key} className="text-[#007AFF] font-medium">
              #{sanitizeText(token.value)}
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
            #{sanitizeText(token.value)}
          </Link>
        )
      }
      case 'cashtag': {
        const ticker = sanitizeText(token.value).toUpperCase()
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
            to={`/t/${encodeURIComponent(ticker)}`}
            onClick={stopPropagation}
            className="text-[rgb(var(--color-system-green))] font-medium"
          >
            ${ticker}
          </Link>
        )
      }
      default:
        return null
    }
  })
}

function MarkdownImageBlock({
  url,
  alt,
  id,
}: {
  url: string
  alt?: string
  id: string
}) {
  const moderationDocument = React.useMemo(
    () => buildMediaModerationDocument({
      id,
      kind: 'article_image',
      url,
    }),
    [id, url],
  )
  const { blocked, loading } = useMediaModerationDocument(moderationDocument)
  const revealReason = getMediaRevealReason({
    blocked: moderationDocument !== null && blocked,
    loading: moderationDocument !== null && loading,
  })

  return (
    <figure className="overflow-hidden rounded-ios-xl bg-[rgb(var(--color-bg-secondary))] card-elevated">
      <MediaRevealGate
        reason={revealReason}
        resetKey={`${url}:${revealReason ?? 'none'}`}
        className="min-h-[12rem] w-full"
      >
        <img
          src={url}
          alt={alt ?? ''}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      </MediaRevealGate>
      {alt && (
        <figcaption className="px-4 py-3 text-[13px] text-[rgb(var(--color-label-secondary))]">
          <TwemojiText text={alt} />
        </figcaption>
      )}
    </figure>
  )
}

export function MarkdownContent({ content, className = '', interactive = true }: MarkdownContentProps) {
  const blocks = React.useMemo(() => parseBlocks(content), [content])

  return (
    <div className={`space-y-4 text-[rgb(var(--color-label))] ${className}`}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`

        switch (block.type) {
          case 'heading': {
            const Tag = `h${block.level}` as const
            const className = block.level <= 2
              ? 'text-[30px] leading-tight font-semibold tracking-[-0.03em]'
              : block.level === 3
                ? 'text-[24px] leading-tight font-semibold'
                : 'text-[18px] leading-snug font-semibold'

            return (
              <Tag key={key} className={className}>
                {renderInline(block.text, 0, interactive)}
              </Tag>
            )
          }

          case 'paragraph':
            return (
              <p key={key} className="text-[17px] leading-8">
                {renderInline(block.text, 0, interactive)}
              </p>
            )

          case 'blockquote':
            return (
              <blockquote
                key={key}
                className="border-l-2 border-[rgb(var(--color-fill)/0.22)] pl-4 text-[rgb(var(--color-label-secondary))] text-[17px] leading-8"
              >
                {renderInline(block.text, 0, interactive)}
              </blockquote>
            )

          case 'unordered-list':
            return (
              <ul key={key} className="space-y-2 pl-5 list-disc marker:text-[rgb(var(--color-label-tertiary))]">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`} className="text-[17px] leading-8">
                    {renderInline(item, 0, interactive)}
                  </li>
                ))}
              </ul>
            )

          case 'ordered-list':
            return (
              <ol key={key} className="space-y-2 pl-5 list-decimal marker:text-[rgb(var(--color-label-tertiary))]">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`} className="text-[17px] leading-8">
                    {renderInline(item, 0, interactive)}
                  </li>
                ))}
              </ol>
            )

          case 'code':
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-ios-xl bg-[rgb(var(--color-fill)/0.08)] p-4 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]"
              >
                <code data-language={block.language}>{block.code}</code>
              </pre>
            )

          case 'image':
            return (
              <MarkdownImageBlock
                key={key}
                id={key}
                url={block.url}
                {...(block.alt ? { alt: block.alt } : {})}
              />
            )

          case 'hr':
            return <hr key={key} className="border-0 h-px bg-[rgb(var(--color-fill)/0.16)]" />

          default:
            return null
        }
      })}
    </div>
  )
}
