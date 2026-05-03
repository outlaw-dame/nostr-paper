import {
  orientationLabel,
  resolveSourceLens,
  type SourceOrientation,
} from '@/lib/media/sourceOrientation'

interface SourceLensBadgeProps {
  domainOrUrl: string
  className?: string
  compact?: boolean
}

const BADGE_STYLE: Record<Exclude<SourceOrientation, 'unknown'>, string> = {
  left: 'bg-[rgb(var(--color-system-blue)/0.15)] text-[rgb(var(--color-system-blue))]',
  'lean-left': 'bg-[rgb(var(--color-system-teal)/0.15)] text-[rgb(var(--color-system-teal))]',
  center: 'bg-[rgb(var(--color-label-tertiary)/0.2)] text-[rgb(var(--color-label-secondary))]',
  'lean-right': 'bg-[rgb(var(--color-system-orange)/0.15)] text-[rgb(var(--color-system-orange))]',
  right: 'bg-[rgb(var(--color-system-red)/0.15)] text-[rgb(var(--color-system-red))]',
}

export function SourceLensBadge({
  domainOrUrl,
  className = '',
  compact = false,
}: SourceLensBadgeProps) {
  const lens = resolveSourceLens(domainOrUrl)
  if (lens.orientation === 'unknown') return null

  const style = BADGE_STYLE[lens.orientation]
  const label = orientationLabel(lens.orientation)

  return (
    <span
      className={`
        inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1
        text-[11px] font-semibold ${style} ${className}
      `}
      title={`Source orientation lens (${lens.source}, ${lens.asOf})`}
    >
      {!compact && <span className="uppercase tracking-[0.08em]">Source</span>}
      <span className="truncate">{label}</span>
    </span>
  )
}
