import { TwemojiText } from '@/components/ui/TwemojiText'
import {
  getHandlerDisplayName,
  getHandlerSummary,
  parseHandlerInformationEvent,
} from '@/lib/nostr/appHandlers'
import type { NostrEvent } from '@/types'

interface HandlerInformationBodyProps {
  event: NostrEvent
  className?: string
}

export function HandlerInformationBody({
  event,
  className = '',
}: HandlerInformationBodyProps) {
  const handler = parseHandlerInformationEvent(event)
  if (!handler) return null

  const website = handler.metadata?.website
  const picture = handler.metadata?.picture
  const displayName = getHandlerDisplayName(handler)
  const summary = getHandlerSummary(handler)

  return (
    <div className={`rounded-[20px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-4 ${className}`}>
      <div className="flex items-start gap-3">
        {picture ? (
          <img
            src={picture}
            alt=""
            className="h-14 w-14 rounded-[16px] object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-[rgb(var(--color-fill)/0.10)] text-[20px] font-semibold text-[rgb(var(--color-label))]">
            ⌘
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            NIP-89 Handler
          </p>
          <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
            <TwemojiText text={displayName} />
          </h3>
          <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
            <TwemojiText text={summary} />
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {handler.supportedKinds.map((kind) => (
          <span
            key={kind}
            className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]"
          >
            Kind {kind}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {handler.links.map((link) => (
          <span
            key={`${link.platform}:${link.urlTemplate}:${link.entityType ?? 'generic'}`}
            className="rounded-full border border-[rgb(var(--color-fill)/0.14)] px-2.5 py-1 text-[12px] text-[rgb(var(--color-label-secondary))]"
          >
            {link.platform}
            {link.entityType ? ` • ${link.entityType}` : ' • generic'}
          </span>
        ))}
      </div>

      {(website || handler.naddr) && (
        <div className="mt-4 space-y-2 text-[13px] text-[rgb(var(--color-label-secondary))]">
          {website && (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="block break-all text-[#007AFF]"
            >
              {website}
            </a>
          )}
          {handler.naddr && (
            <p className="break-all font-mono text-[12px] text-[rgb(var(--color-label-tertiary))]">
              nostr:{handler.naddr}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
