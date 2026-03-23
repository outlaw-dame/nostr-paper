import { Link } from 'react-router-dom'
import { NoteContent } from '@/components/cards/NoteContent'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { useEvent } from '@/hooks/useEvent'
import { useProfile } from '@/hooks/useProfile'
import { getReactionLabel, parseReactionEvent } from '@/lib/nostr/reaction'
import type { NostrEvent } from '@/types'

interface ReactionBodyProps {
  event: NostrEvent
  className?: string
}

export function ReactionBody({ event, className = '' }: ReactionBodyProps) {
  const reaction = parseReactionEvent(event)
  const { event: targetEvent, loading } = useEvent(reaction?.targetEventId)
  const { profile: targetProfile } = useProfile(targetEvent?.pubkey)

  if (!reaction) return null

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center gap-2 text-[15px] text-[rgb(var(--color-label-secondary))]">
        {reaction.type === 'custom-emoji' && reaction.emojiUrl ? (
          <img
            src={reaction.emojiUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-5 w-5 rounded-sm object-cover"
          />
        ) : null}
        <span>{getReactionLabel(reaction)}</span>
      </div>

      {targetEvent ? (
        <Link
          to={`/note/${targetEvent.id}`}
          className="block rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3"
        >
          <AuthorRow
            pubkey={targetEvent.pubkey}
            profile={targetProfile}
            timestamp={targetEvent.created_at}
          />
          <NoteContent content={targetEvent.content} className="mt-3" compact />
        </Link>
      ) : (
        <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
          <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
            {loading ? 'Loading reacted event…' : 'Reacted event unavailable.'}
          </p>
        </div>
      )}
    </div>
  )
}
