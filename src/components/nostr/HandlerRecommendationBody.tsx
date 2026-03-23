import { Link } from 'react-router-dom'
import { TwemojiText } from '@/components/ui/TwemojiText'
import {
  encodeHandlerAddressNaddr,
  getHandlerRecommendationSummary,
  parseHandlerRecommendationEvent,
} from '@/lib/nostr/appHandlers'
import type { NostrEvent } from '@/types'

interface HandlerRecommendationBodyProps {
  event: NostrEvent
  className?: string
}

export function HandlerRecommendationBody({
  event,
  className = '',
}: HandlerRecommendationBodyProps) {
  const recommendation = parseHandlerRecommendationEvent(event)
  if (!recommendation) return null

  return (
    <div className={`rounded-[20px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-4 ${className}`}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        NIP-89 Recommendation
      </p>
      <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
        Kind {recommendation.supportedKind}
      </h3>
      <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
        <TwemojiText text={getHandlerRecommendationSummary(recommendation)} />
      </p>

      <div className="mt-4 space-y-2">
        {recommendation.recommendations.map((item) => {
          const naddr = encodeHandlerAddressNaddr(item.address, item.relayHint)

          return naddr ? (
            <Link
              key={`${item.address}:${item.platform ?? ''}`}
              to={`/a/${naddr}`}
              className="
                flex items-center justify-between rounded-[16px]
                border border-[rgb(var(--color-fill)/0.12)]
                bg-[rgb(var(--color-bg))] px-3 py-3
                transition-opacity active:opacity-80
              "
            >
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
                  {item.platform ? `${item.platform} handler` : 'Handler info'}
                </p>
                <p className="mt-1 break-all font-mono text-[12px] text-[rgb(var(--color-label-tertiary))]">
                  {item.address}
                </p>
              </div>
              <span className="ml-3 shrink-0 text-[12px] font-medium text-[#007AFF]">
                Open
              </span>
            </Link>
          ) : (
            <div
              key={`${item.address}:${item.platform ?? ''}`}
              className="
                rounded-[16px] border border-[rgb(var(--color-fill)/0.12)]
                bg-[rgb(var(--color-bg))] px-3 py-3
              "
            >
              <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
                {item.platform ? `${item.platform} handler` : 'Handler info'}
              </p>
              <p className="mt-1 break-all font-mono text-[12px] text-[rgb(var(--color-label-tertiary))]">
                {item.address}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
