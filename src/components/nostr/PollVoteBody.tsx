import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { useEvent } from '@/hooks/useEvent'
import { parsePollEvent, parsePollVoteEvent } from '@/lib/nostr/polls'
import { TwemojiText } from '@/components/ui/TwemojiText'
import type { NostrEvent } from '@/types'

interface PollVoteBodyProps {
  event: NostrEvent
  className?: string
}

export function PollVoteBody({ event, className = '' }: PollVoteBodyProps) {
  const vote = parsePollVoteEvent(event)
  const { event: pollEvent, loading } = useEvent(vote?.pollEventId)
  const poll = pollEvent ? parsePollEvent(pollEvent) : null

  if (!vote) return null

  const selectedLabels = poll
    ? vote.responses
      .map((response) => poll.options.find((option) => option.optionId === response)?.label)
      .filter((label): label is string => typeof label === 'string')
    : vote.responses

  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          Poll Vote
        </p>
        <p className="mt-2 text-[15px] leading-7 text-[rgb(var(--color-label-secondary))]">
          {selectedLabels.length > 0
            ? `Selected ${selectedLabels.length} option${selectedLabels.length === 1 ? '' : 's'}.`
            : 'Submitted a vote without a valid counted response.'}
        </p>
      </div>

      {selectedLabels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedLabels.map((label) => (
            <span
              key={label}
              className="
                rounded-full border border-[rgb(var(--color-fill)/0.12)]
                bg-[rgb(var(--color-bg-secondary))] px-3 py-1.5
                text-[13px] text-[rgb(var(--color-label))]
              "
            >
              <TwemojiText text={label} />
            </span>
          ))}
        </div>
      )}

      {pollEvent ? (
        <EventPreviewCard event={pollEvent} compact />
      ) : (
        <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
          <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
            {loading ? 'Loading poll…' : 'Referenced poll unavailable.'}
          </p>
        </div>
      )}
    </div>
  )
}
