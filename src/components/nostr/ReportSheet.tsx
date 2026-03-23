import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sheet } from 'konsta/react'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { useApp } from '@/contexts/app-context'
import { useProfile } from '@/hooks/useProfile'
import {
  REPORT_TYPES,
  formatReportType,
  parseReportLabelsInput,
  publishReport,
  type ReportPublishTarget,
  type ReportType,
} from '@/lib/nostr/report'
import type { NostrEvent } from '@/types'

interface ReportSheetProps {
  open: boolean
  target: ReportPublishTarget
  onClose: () => void
  onPublished?: (event: NostrEvent) => void
}

export function ReportSheet({
  open,
  target,
  onClose,
  onPublished,
}: ReportSheetProps) {
  const { currentUser } = useApp()
  const [reportType, setReportType] = useState<ReportType | null>(null)
  const [reason, setReason] = useState('')
  const [labelNamespace, setLabelNamespace] = useState('')
  const [labelsInput, setLabelsInput] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const profilePubkey = target.type === 'profile' ? target.pubkey : target.event.pubkey
  const targetResetKey = target.type === 'profile'
    ? `profile:${target.pubkey}`
    : `event:${target.event.id}`
  const { profile } = useProfile(profilePubkey)

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      abortRef.current = null
      setPublishing(false)
      setError(null)
      return
    }

    setReportType(null)
    setReason('')
    setLabelNamespace('')
    setLabelsInput('')
    setPublishing(false)
    setError(null)
  }, [open, targetResetKey])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const labels = useMemo(
    () => parseReportLabelsInput(labelsInput, labelNamespace),
    [labelNamespace, labelsInput],
  )

  const title = target.type === 'profile' ? 'Report Profile' : 'Report Event'
  const description = target.type === 'profile'
    ? 'Publish a signed kind-1984 report about this profile.'
    : 'Publish a signed kind-1984 report about this event or file.'

  const closeSheet = () => {
    if (publishing) return
    onClose()
  }

  const handlePublish = async () => {
    if (publishing) return
    if (!currentUser) {
      setError('No signer available — install and unlock a NIP-07 extension to publish reports.')
      return
    }
    if (!reportType) {
      setError('Select a report type before publishing.')
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setPublishing(true)
    setError(null)

    try {
      const published = await publishReport(
        target,
        {
          reportType,
          reason,
          labels,
        },
        controller.signal,
      )

      abortRef.current = null
      setPublishing(false)
      onPublished?.(published)
      onClose()
    } catch (publishError: unknown) {
      if (publishError instanceof DOMException && publishError.name === 'AbortError') {
        setPublishing(false)
        return
      }
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish report.')
      setPublishing(false)
      abortRef.current = null
    }
  }

  const publishDisabled = publishing || !currentUser || !reportType

  const sheet = (
    <Sheet
      opened={open}
      onBackdropClick={closeSheet}
      className="rounded-t-[28px]"
    >
      <div className="pb-safe min-h-[50vh] flex flex-col">
        <div className="flex justify-center pb-2 pt-3">
          <div className="h-1 w-10 rounded-full bg-[rgb(var(--color-fill)/0.3)]" />
        </div>

        <div className="flex flex-1 flex-col gap-4 px-5 py-4">
          <div>
            <h2 className="text-headline text-[rgb(var(--color-label))]">
              {title}
            </h2>
            <p className="mt-1 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {description}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Target
            </p>
            {target.type === 'event' ? (
              <EventPreviewCard event={target.event} linked={false} compact />
            ) : (
              <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
                <AuthorRow pubkey={target.pubkey} profile={profile} />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Report Type
            </p>
            <div className="flex flex-wrap gap-2">
              {REPORT_TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setReportType(option)}
                  className={`
                    rounded-full border px-3 py-1.5 text-[13px] capitalize
                    transition-opacity active:opacity-80
                    ${reportType === option
                      ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                      : 'border-[rgb(var(--color-fill)/0.16)] text-[rgb(var(--color-label-secondary))]'
                    }
                  `}
                >
                  {formatReportType(option)}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Details
            </span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional context for moderators, relays, or other clients."
              rows={4}
              className="
                mt-2 w-full resize-none rounded-[18px] border border-[rgb(var(--color-fill)/0.18)]
                bg-[rgb(var(--color-bg-secondary))] px-4 py-3
                text-[15px] leading-7 text-[rgb(var(--color-label))]
                outline-none transition-colors focus:border-[#007AFF]
                placeholder:text-[rgb(var(--color-label-tertiary))]
              "
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Label Namespace
              </span>
              <input
                type="text"
                value={labelNamespace}
                onChange={(event) => setLabelNamespace(event.target.value)}
                placeholder="ugc"
                className="
                  mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                  bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5
                  text-[15px] text-[rgb(var(--color-label))]
                  placeholder:text-[rgb(var(--color-label-tertiary))]
                  outline-none
                "
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>

            <label className="block">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Labels
              </span>
              <input
                type="text"
                value={labelsInput}
                onChange={(event) => setLabelsInput(event.target.value)}
                placeholder="Comma-separated labels"
                className="
                  mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                  bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5
                  text-[15px] text-[rgb(var(--color-label))]
                  placeholder:text-[rgb(var(--color-label-tertiary))]
                  outline-none
                "
              />
            </label>
          </div>

          {labels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {labels.map((label) => (
                <span
                  key={`${label.namespace}:${label.value}`}
                  className="rounded-full border border-[rgb(var(--color-fill)/0.16)] px-2.5 py-1 text-[12px] text-[rgb(var(--color-label-secondary))]"
                >
                  {label.namespace}:{label.value}
                </span>
              ))}
            </div>
          )}

          {!currentUser && (
            <p className="text-[13px] text-[rgb(var(--color-system-red))]">
              Install and unlock a NIP-07 signer to publish reports.
            </p>
          )}

          {error && (
            <p className="text-[13px] text-[rgb(var(--color-system-red))]">
              {error}
            </p>
          )}

          <div className="mt-auto flex gap-2">
            <button
              type="button"
              onClick={closeSheet}
              disabled={publishing}
              className="
                flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                bg-[rgb(var(--color-bg-secondary))] px-4 py-2.5
                text-[14px] font-medium text-[rgb(var(--color-label))]
                transition-opacity active:opacity-75 disabled:opacity-40
              "
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={() => void handlePublish()}
              disabled={publishDisabled}
              className="
                flex-1 rounded-[14px] bg-[rgb(var(--color-system-red))]
                px-4 py-2.5 text-[14px] font-semibold text-white
                transition-opacity active:opacity-80 disabled:opacity-40
              "
            >
              {publishing ? 'Publishing…' : 'Publish Report'}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )

  if (typeof document !== 'undefined') {
    return createPortal(sheet, document.body)
  }

  return sheet
}
