import { NoteContent } from '@/components/cards/NoteContent'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { isPollClosed, type ParsedPollEvent } from '@/lib/nostr/polls'

interface PollPreviewProps {
  poll: ParsedPollEvent
  className?: string
  compact?: boolean
}

function formatEndsAt(endsAt: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(endsAt * 1000))
  } catch {
    return new Date(endsAt * 1000).toLocaleString()
  }
}

export function PollPreview({
  poll,
  className = '',
  compact = false,
}: PollPreviewProps) {
  const closed = isPollClosed(poll)
  const visibleOptions = compact ? poll.options.slice(0, 2) : poll.options.slice(0, 4)
  const remainingOptionCount = poll.options.length - visibleOptions.length

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        <span>Poll</span>
        <span>{poll.pollType === 'multiplechoice' ? 'Multiple choice' : 'Single choice'}</span>
        <span>{poll.options.length} option{poll.options.length === 1 ? '' : 's'}</span>
        <span>{closed ? 'Closed' : 'Open'}</span>
        {poll.endsAt !== undefined && (
          <span>{closed ? 'Ended' : 'Ends'} {formatEndsAt(poll.endsAt)}</span>
        )}
      </div>

      <NoteContent
        content={poll.question}
        compact={compact}
        className={compact ? '' : 'text-[16px] leading-7 text-[rgb(var(--color-label))]'}
      />

      <div className="space-y-2">
        {visibleOptions.map((option) => (
          <div
            key={option.optionId}
            className="
              rounded-[16px] border border-[rgb(var(--color-fill)/0.12)]
              bg-[rgb(var(--color-fill)/0.05)] px-3 py-2.5
              text-[14px] text-[rgb(var(--color-label))]
            "
          >
            <TwemojiText text={option.label} />
          </div>
        ))}

        {remainingOptionCount > 0 && (
          <p className="px-1 text-[13px] text-[rgb(var(--color-label-tertiary))]">
            +{remainingOptionCount} more option{remainingOptionCount === 1 ? '' : 's'}
          </p>
        )}
      </div>
    </div>
  )
}
