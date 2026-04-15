import { NoteContent } from '@/components/cards/NoteContent'
import { QuotePreviewList } from '@/components/nostr/QuotePreviewList'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { parseThreadEvent } from '@/lib/nostr/thread'
import type { NostrEvent } from '@/types'

interface ThreadBodyProps {
  event: NostrEvent
  className?: string
}

export function ThreadBody({ event, className = '' }: ThreadBodyProps) {
  const thread = parseThreadEvent(event)
  if (!thread) return null

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          Thread
        </p>
        {thread.title && (
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em] text-[rgb(var(--color-label))]">
            <TwemojiText text={thread.title} />
          </h1>
        )}
      </div>

      {thread.content.length > 0 && (
        <NoteContent content={thread.content} allowTranslation enableMarkdown />
      )}

      <QuotePreviewList event={event} compact />
    </div>
  )
}
