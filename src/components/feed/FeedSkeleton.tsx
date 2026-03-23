/**
 * FeedSkeleton
 *
 * Placeholder UI shown while events are loading from SQLite or relays.
 * Uses the global .skeleton CSS class (shimmer animation).
 */

interface FeedSkeletonProps {
  type: 'hero' | 'card'
}

export function FeedSkeleton({ type }: FeedSkeletonProps) {
  if (type === 'hero') {
    return (
      <div
        className="w-full rounded-ios-2xl overflow-hidden skeleton"
        style={{ height: 'clamp(320px, 44svh, 460px)' }}
        role="status"
        aria-label="Loading"
        aria-busy="true"
      >
        <div className="absolute bottom-0 left-0 right-0 p-4 space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full skeleton" />
            <div>
              <div className="w-28 h-3 rounded skeleton mb-1.5" />
              <div className="w-16 h-2.5 rounded skeleton" />
            </div>
          </div>
          <div className="w-full h-3 rounded skeleton" />
          <div className="w-4/5 h-3 rounded skeleton" />
        </div>
      </div>
    )
  }

  return (
    <div
      className="
        app-panel
        rounded-ios-xl p-4 space-y-3
      "
      role="status"
      aria-label="Loading"
      aria-busy="true"
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full skeleton" />
        <div className="space-y-1.5 flex-1">
          <div className="w-32 h-3 rounded skeleton" />
          <div className="w-20 h-2.5 rounded skeleton" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="w-full h-3 rounded skeleton" />
        <div className="w-4/5 h-3 rounded skeleton" />
      </div>
    </div>
  )
}
