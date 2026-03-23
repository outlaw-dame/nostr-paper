import { parseDeletionEvent } from '@/lib/nostr/deletion'
import type { NostrEvent } from '@/types'

interface DeletionRequestBodyProps {
  event: NostrEvent
  className?: string
}

export function DeletionRequestBody({
  event,
  className = '',
}: DeletionRequestBodyProps) {
  const deletion = parseDeletionEvent(event)
  if (!deletion) return null

  const totalTargets = deletion.eventIds.length + deletion.coordinates.length

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="rounded-[20px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] p-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          Deletion Request
        </p>
        <p className="mt-2 text-[16px] leading-7 text-[rgb(var(--color-label))]">
          Requested deletion of {totalTargets} target{totalTargets === 1 ? '' : 's'}.
        </p>

        {deletion.eventIds.length > 0 && (
          <p className="mt-2 text-[14px] text-[rgb(var(--color-label-secondary))]">
            Event references: {deletion.eventIds.length}
          </p>
        )}

        {deletion.coordinates.length > 0 && (
          <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">
            Addressable references: {deletion.coordinates.length}
          </p>
        )}

        {deletion.kinds.length > 0 && (
          <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">
            Declared kinds: {deletion.kinds.join(', ')}
          </p>
        )}

        {deletion.reason && (
          <p className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-[rgb(var(--color-label))]">
            {deletion.reason}
          </p>
        )}
      </div>
    </div>
  )
}
