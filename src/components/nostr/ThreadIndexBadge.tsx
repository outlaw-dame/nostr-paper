import { TwemojiText } from '@/components/ui/TwemojiText'
import type { SelfThreadIndex } from '@/lib/nostr/threadIndex'

interface ThreadIndexBadgeProps {
  threadIndex: SelfThreadIndex | null
  className?: string
}

export function ThreadIndexBadge({
  threadIndex,
  className = '',
}: ThreadIndexBadgeProps) {
  if (!threadIndex) return null

  return (
    <span
      className={`inline-flex items-center rounded-full bg-[rgb(var(--color-system-blue)/0.12)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.02em] text-[rgb(var(--color-system-blue))] ${className}`}
    >
      <TwemojiText text={`🧵 Thread ${threadIndex.index}/${threadIndex.total}`} />
    </span>
  )
}
