import { Link } from 'react-router-dom'
import { NoteContent } from '@/components/cards/NoteContent'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { parseHighlightEvent, getHighlightSourceLabel } from '@/lib/nostr/highlight'
import type { NostrEvent } from '@/types'

interface HighlightBodyProps {
  event: NostrEvent
  className?: string
}

export function HighlightBody({ event, className = '' }: HighlightBodyProps) {
  const highlight = parseHighlightEvent(event)
  if (!highlight) return null

  const sourceLabel = getHighlightSourceLabel(highlight)
  const sourceHref =
    highlight.sourceUrl ??
    (highlight.sourceEventId ? `/note/${highlight.sourceEventId}` : null)

  return (
    <div className={`space-y-3 ${className}`}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        Highlight
      </p>

      {/* Quoted excerpt */}
      <blockquote className="rounded-[14px] border-l-[3px] border-[rgb(var(--color-system-yellow,255_214_10))] bg-[rgb(var(--color-system-yellow,255_214_10)/0.08)] py-3 pl-4 pr-3">
        <p className="text-[16px] leading-7 text-[rgb(var(--color-label))] italic">
          &ldquo;<TwemojiText text={highlight.excerpt} />&rdquo;
        </p>
      </blockquote>

      {/* Annotator comment */}
      {highlight.comment && (
        <NoteContent
          content={highlight.comment}
          className="text-[15px] leading-6 text-[rgb(var(--color-label))]"
          enableMarkdown
        />
      )}

      {/* Context passage — collapsed, smaller text */}
      {highlight.context && (
        <details className="group">
          <summary className="cursor-pointer select-none text-[13px] font-medium text-[rgb(var(--color-label-secondary))] group-open:mb-2">
            Show context
          </summary>
          <p className="text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
            <TwemojiText text={highlight.context} />
          </p>
        </details>
      )}

      {/* Source attribution */}
      <p className="text-[12px] text-[rgb(var(--color-label-tertiary,var(--color-label-secondary)))]">
        Source:{' '}
        {sourceHref ? (
          sourceHref.startsWith('http') ? (
            <a
              href={sourceHref}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 text-[rgb(var(--color-tint))]"
            >
              {sourceLabel}
            </a>
          ) : (
            <Link
              to={sourceHref}
              className="underline underline-offset-2 text-[rgb(var(--color-tint))]"
            >
              {sourceLabel}
            </Link>
          )
        ) : (
          <span>{sourceLabel}</span>
        )}
      </p>
    </div>
  )
}
