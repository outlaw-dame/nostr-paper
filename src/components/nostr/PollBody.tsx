import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NoteContent } from '@/components/cards/NoteContent'
import { useApp } from '@/contexts/app-context'
import {
  fetchPollVotesFromRelays,
  getLocalPollResults,
  isPollClosed,
  parsePollEvent,
  publishPollVote,
  type ParsedPollEvent,
  type PollResults,
} from '@/lib/nostr/polls'
import { TwemojiText } from '@/components/ui/TwemojiText'
import type { NostrEvent } from '@/types'

interface PollBodyProps {
  event: NostrEvent
  className?: string
}

function formatEndsAt(endsAt: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(endsAt * 1000))
  } catch {
    return new Date(endsAt * 1000).toLocaleString()
  }
}

function getPercentage(count: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((count / total) * 100)
}

function hasSameResponses(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

export function PollBody({ event, className = '' }: PollBodyProps) {
  const poll = useMemo(() => parsePollEvent(event), [event])
  const { currentUser } = useApp()
  const dirtySelectionRef = useRef(false)
  const [results, setResults] = useState<PollResults | null>(null)
  const [selectedResponses, setSelectedResponses] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [relayLoading, setRelayLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  const refreshLocalResults = useCallback(async (
    resolvedPoll: ParsedPollEvent,
    signal?: AbortSignal,
  ) => {
    const nextResults = await getLocalPollResults(resolvedPoll, currentUser?.pubkey)
    if (signal?.aborted) return nextResults

    setResults(nextResults)
    setLoading(false)
    if (!dirtySelectionRef.current) {
      setSelectedResponses(nextResults.currentUserResponses)
    }

    return nextResults
  }, [currentUser?.pubkey])

  useEffect(() => {
    if (!poll) {
      setResults(null)
      setSelectedResponses([])
      setLoading(false)
      setRelayLoading(false)
      setLoadError('Malformed poll event.')
      return
    }

    const controller = new AbortController()
    dirtySelectionRef.current = false
    setLoading(true)
    setRelayLoading(false)
    setLoadError(null)
    setPublishError(null)

    refreshLocalResults(poll, controller.signal)
      .then(async () => {
        if (controller.signal.aborted || poll.relayUrls.length === 0) return
        setRelayLoading(true)
        try {
          await fetchPollVotesFromRelays(poll, controller.signal)
          if (controller.signal.aborted) return
          await refreshLocalResults(poll, controller.signal)
        } catch (error: unknown) {
          if (controller.signal.aborted) return
          setLoadError(error instanceof Error ? error.message : 'Failed to refresh poll votes from relays.')
        } finally {
          if (!controller.signal.aborted) {
            setRelayLoading(false)
          }
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoading(false)
        setLoadError(error instanceof Error ? error.message : 'Failed to load poll results.')
      })

    return () => controller.abort()
  }, [poll, refreshLocalResults])

  const closed = poll ? isPollClosed(poll) : true
  const validSelection = poll
    ? (poll.pollType === 'singlechoice' ? selectedResponses.length === 1 : selectedResponses.length > 0)
    : false
  const voteChanged = results
    ? !hasSameResponses(results.currentUserResponses, selectedResponses)
    : selectedResponses.length > 0

  const toggleResponse = (optionId: string) => {
    if (!poll || closed || publishing || !currentUser) return

    dirtySelectionRef.current = true
    setPublishError(null)
    setSelectedResponses((current) => {
      if (poll.pollType === 'singlechoice') {
        return [optionId]
      }

      if (current.includes(optionId)) {
        return current.filter((value) => value !== optionId)
      }

      return [...current, optionId]
    })
  }

  const handleVote = async () => {
    if (!poll || !validSelection || publishing) return

    setPublishing(true)
    setPublishError(null)

    try {
      await publishPollVote({
        poll,
        responses: selectedResponses,
      })
      dirtySelectionRef.current = false
      await refreshLocalResults(poll)
    } catch (error: unknown) {
      setPublishError(error instanceof Error ? error.message : 'Failed to publish vote.')
    } finally {
      setPublishing(false)
    }
  }

  if (!poll) {
    return (
      <div className={`rounded-[20px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-4 ${className}`}>
        <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
          Malformed poll event.
        </p>
      </div>
    )
  }

  return (
    <div className={`space-y-4 ${className}`}>
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
        className="text-[18px] leading-8 text-[rgb(var(--color-label))]"
      />

      <div className="space-y-3">
        {poll.options.map((option) => {
          const count = results?.optionCounts[option.optionId] ?? 0
          const percentage = getPercentage(count, results?.totalVotes ?? 0)
          const selected = selectedResponses.includes(option.optionId)
          const winner = results?.winningOptionIds.includes(option.optionId) ?? false

          return (
            <button
              key={option.optionId}
              type="button"
              onClick={() => toggleResponse(option.optionId)}
              disabled={!currentUser || closed || publishing}
              className={`
                relative w-full overflow-hidden rounded-[18px] border px-4 py-3 text-left transition-colors
                disabled:cursor-default disabled:opacity-100
                ${selected
                  ? 'border-[#007AFF]/45 bg-[#007AFF]/10'
                  : 'border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))]'
                }
              `}
            >
              <div
                className="absolute inset-y-0 left-0 bg-[rgb(var(--color-fill)/0.08)] transition-[width]"
                style={{ width: `${percentage}%` }}
                aria-hidden="true"
              />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`
                      mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold
                      ${selected
                        ? 'border-[#007AFF] bg-[#007AFF] text-white'
                        : 'border-[rgb(var(--color-fill)/0.20)] text-[rgb(var(--color-label-secondary))]'
                      }
                    `}>
                      {poll.pollType === 'multiplechoice' ? (selected ? '✓' : '+') : (selected ? '●' : '○')}
                    </span>
                    <span className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                      <TwemojiText text={option.label} />
                    </span>
                    {winner && (results?.totalVotes ?? 0) > 0 && (
                      <span className="rounded-full bg-[rgb(var(--color-label))] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
                        Lead
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex-shrink-0 text-right">
                  <p className="text-[14px] font-semibold text-[rgb(var(--color-label))]">
                    {percentage}%
                  </p>
                  <p className="text-[12px] text-[rgb(var(--color-label-secondary))]">
                    {count} vote{count === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg-secondary))] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
            {results ? `${results.totalVotes} counted ballot${results.totalVotes === 1 ? '' : 's'}` : 'Loading ballots…'}
          </p>
          <p className="mt-1 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
            {closed
              ? 'Voting has ended for this poll.'
              : currentUser
                ? (results?.currentUserHasVoted ? 'You can republish a newer vote to update your selection.' : 'Your latest vote per pubkey is the one that counts.')
                : 'Connect a signer to publish a vote.'}
          </p>
        </div>

        {!closed && (
          <button
            type="button"
            onClick={() => void handleVote()}
            disabled={!currentUser || !validSelection || !voteChanged || publishing}
            className="
              rounded-[14px] bg-[rgb(var(--color-label))] px-4 py-2.5
              text-[14px] font-medium text-white transition-opacity
              active:opacity-75 disabled:opacity-35
            "
          >
            {publishing
              ? 'Voting…'
              : results?.currentUserHasVoted
                ? 'Update Vote'
                : 'Vote'}
          </button>
        )}
      </div>

      {poll.relayUrls.length === 0 && (
        <p className="text-[13px] text-[#C65D2E]">
          This poll does not declare any valid `relay` tags, so remote vote refresh and compliant vote publishing are unavailable.
        </p>
      )}

      {relayLoading && (
        <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
          Refreshing votes from the poll’s relay set…
        </p>
      )}

      {loading && !relayLoading && (
        <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
          Loading cached poll votes…
        </p>
      )}

      {loadError && (
        <p className="text-[13px] text-[#C65D2E]">
          Vote refresh degraded: {loadError}
        </p>
      )}

      {publishError && (
        <p className="text-[13px] text-[rgb(var(--color-system-red))]">
          {publishError}
        </p>
      )}
    </div>
  )
}
