import { Link } from 'react-router-dom'
import { NoteContent } from '@/components/cards/NoteContent'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { useEvent } from '@/hooks/useEvent'
import { useProfile } from '@/hooks/useProfile'
import {
  formatReportType,
  getReportSummary,
  parseReportEvent,
} from '@/lib/nostr/report'
import type { NostrEvent } from '@/types'

interface ReportBodyProps {
  event: NostrEvent
  className?: string
}

export function ReportBody({ event, className = '' }: ReportBodyProps) {
  const report = parseReportEvent(event)
  const primaryEventId = report?.eventTargets[0]?.eventId ?? null
  const { event: targetEvent, loading: targetEventLoading } = useEvent(primaryEventId)
  const standaloneProfilePubkey = !primaryEventId
    ? report?.profileTargets[0]?.pubkey ?? null
    : null
  const { profile: targetProfile } = useProfile(standaloneProfilePubkey)

  if (!report) return null

  const primaryBlob = report.blobTargets[0]
  const labelChips = report.labels.slice(0, 6)

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="rounded-[20px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] p-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          Report
        </p>

        <p className="mt-2 text-[16px] leading-7 text-[rgb(var(--color-label))]">
          {getReportSummary(report)}
        </p>

        {report.reportTypes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {report.reportTypes.map((reportType) => (
              <span
                key={reportType}
                className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[12px] text-[rgb(var(--color-label-secondary))]"
              >
                {formatReportType(reportType)}
              </span>
            ))}
          </div>
        )}

        {(report.profileTargets.length > 0 || report.eventTargets.length > 0 || report.blobTargets.length > 0) && (
          <div className="mt-4 space-y-1 text-[14px] text-[rgb(var(--color-label-secondary))]">
            {report.profileTargets.length > 0 && (
              <p>
                Profile references: {report.profileTargets.length}
              </p>
            )}
            {report.eventTargets.length > 0 && (
              <p>
                Event references: {report.eventTargets.length}
              </p>
            )}
            {report.blobTargets.length > 0 && (
              <p>
                Blob references: {report.blobTargets.length}
              </p>
            )}
          </div>
        )}

        {primaryBlob && (
          <p className="mt-3 break-all text-[13px] text-[rgb(var(--color-label-tertiary))]">
            Blob hash: <span className="font-mono">{primaryBlob.hash}</span>
          </p>
        )}

        {report.serverUrls.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
              Media servers: {report.serverUrls.length}
            </p>
            <a
              href={report.serverUrls[0]}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="break-all text-[13px] text-[#007AFF]"
            >
              {report.serverUrls[0]}
            </a>
          </div>
        )}

        {labelChips.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {labelChips.map((label) => (
              <span
                key={`${label.namespace}:${label.value}`}
                className="rounded-full border border-[rgb(var(--color-fill)/0.16)] px-2.5 py-1 text-[12px] text-[rgb(var(--color-label-secondary))]"
              >
                {label.namespace}:{label.value}
              </span>
            ))}
          </div>
        )}

        {report.reason && (
          <NoteContent content={report.reason} className="mt-4" />
        )}
      </div>

      {targetEvent ? (
        <EventPreviewCard event={targetEvent} linked />
      ) : primaryEventId ? (
        <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
          <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
            {targetEventLoading ? 'Loading reported event…' : 'Reported event unavailable.'}
          </p>
        </div>
      ) : standaloneProfilePubkey ? (
        <Link
          to={`/profile/${standaloneProfilePubkey}`}
          className="block rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3"
        >
          <AuthorRow
            pubkey={standaloneProfilePubkey}
            profile={targetProfile}
          />
        </Link>
      ) : null}
    </div>
  )
}
