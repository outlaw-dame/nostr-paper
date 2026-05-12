import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sheet } from 'konsta/react'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { useApp } from '@/contexts/app-context'
import { useMuteList } from '@/hooks/useMuteList'
import { useProfile } from '@/hooks/useProfile'
import {
  getReportingSettings,
  setReportingSettings,
  type ReportPublishDestination,
} from '@/lib/moderation/reportingSettings'
import { isValidModeratorPubkey } from '@/lib/moderation/reportValidation'
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
  onPublished?: (event: NostrEvent, details: { destination: ReportPublishDestination; mutedAuthor: boolean }) => void
}

export function ReportSheet({
  open,
  target,
  onClose,
  onPublished,
}: ReportSheetProps) {
  const { currentUser } = useApp()
  const { isMuted, mute } = useMuteList()
  const [reportType, setReportType] = useState<ReportType | null>(null)
  const [reason, setReason] = useState('')
  const [labelNamespace, setLabelNamespace] = useState('')
  const [labelsInput, setLabelsInput] = useState('')
  const [destination, setDestination] = useState<ReportPublishDestination>('public')
  const [privateRelayInput, setPrivateRelayInput] = useState('')
  const [moderatorRelayInput, setModeratorRelayInput] = useState('')
  const [moderatorPubkeyInput, setModeratorPubkeyInput] = useState('')
  const [muteAuthorAfterReport, setMuteAuthorAfterReport] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const profilePubkey = target.type === 'profile' ? target.pubkey : target.event.pubkey
  const isSelfTarget = currentUser?.pubkey === profilePubkey
  const targetAlreadyMuted = isMuted(profilePubkey)
  const canMuteTarget = Boolean(currentUser && !isSelfTarget)
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
    const reportingSettings = getReportingSettings()
    setDestination(reportingSettings.destination)
    setPrivateRelayInput(reportingSettings.privateRelayUrls.join('\n'))
    setModeratorRelayInput(reportingSettings.moderatorRelayUrls.join('\n'))
    setModeratorPubkeyInput(reportingSettings.moderatorPubkey)
    setMuteAuthorAfterReport(false)
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

  const parseRelayInput = (value: string): string[] => value
    .split(/[\n,]/)
    .map((relayValue) => relayValue.trim())
    .filter((relayValue) => relayValue.length > 0)

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
          destination,
          ...(destination === 'private'
            ? {
                privateRelayUrls: parseRelayInput(privateRelayInput),
              }
            : {}),
          ...(destination === 'moderator'
            ? {
                moderatorRelayUrls: parseRelayInput(moderatorRelayInput),
                moderatorPubkey: moderatorPubkeyInput.trim().toLowerCase(),
              }
            : {}),
        },
        controller.signal,
      )

      let mutedAuthor = false
      if (canMuteTarget && !targetAlreadyMuted && muteAuthorAfterReport) {
        try {
          await mute(profilePubkey)
          mutedAuthor = true
        } catch (muteError) {
          console.warn('Failed to mute author after report publish', muteError)
        }
      }

      setReportingSettings({
        destination,
        privateRelayUrls: parseRelayInput(privateRelayInput),
        moderatorRelayUrls: parseRelayInput(moderatorRelayInput),
        moderatorPubkey: moderatorPubkeyInput.trim().toLowerCase(),
      })

      abortRef.current = null
      setPublishing(false)
      onPublished?.(published, { destination, mutedAuthor })
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

  const hasValidModeratorPubkey = isValidModeratorPubkey(moderatorPubkeyInput)
  const publishDisabled = publishing
    || !currentUser
    || !reportType
    || (destination === 'moderator' && !hasValidModeratorPubkey)

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

          <div className="space-y-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Visibility
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setDestination('public')}
                className={`
                  rounded-[12px] border px-3 py-2.5 text-[13px] font-medium transition-opacity active:opacity-80
                  ${destination === 'public'
                    ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                    : 'border-[rgb(var(--color-fill)/0.18)] text-[rgb(var(--color-label-secondary))]'
                  }
                `}
              >
                Public to relays
              </button>
              <button
                type="button"
                onClick={() => setDestination('private')}
                className={`
                  rounded-[12px] border px-3 py-2.5 text-[13px] font-medium transition-opacity active:opacity-80
                  ${destination === 'private'
                    ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                    : 'border-[rgb(var(--color-fill)/0.18)] text-[rgb(var(--color-label-secondary))]'
                  }
                `}
              >
                Private relay list
              </button>
              <button
                type="button"
                onClick={() => setDestination('moderator')}
                className={`
                  rounded-[12px] border px-3 py-2.5 text-[13px] font-medium transition-opacity active:opacity-80
                  ${destination === 'moderator'
                    ? 'border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]'
                    : 'border-[rgb(var(--color-fill)/0.18)] text-[rgb(var(--color-label-secondary))]'
                  }
                `}
              >
                Moderator service
              </button>
            </div>
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
              Public uses your normal write/outbox relays. Private uses your relay list only. Moderator service sends an encrypted moderation request to the configured pubkey and relays.
            </p>
          </div>

          {destination === 'private' && (
            <label className="block">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Private Relay URLs
              </span>
              <textarea
                value={privateRelayInput}
                onChange={(event) => setPrivateRelayInput(event.target.value)}
                placeholder="wss://relay.nos.social"
                rows={3}
                className="
                  mt-2 w-full resize-y rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                  bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5
                  text-[14px] leading-6 text-[rgb(var(--color-label))]
                  placeholder:text-[rgb(var(--color-label-tertiary))]
                  outline-none
                "
              />
              <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))]">
                One URL per line (or comma-separated). Invalid relay URLs are ignored.
              </p>
            </label>
          )}

          {destination === 'moderator' && (
            <div className="space-y-3 rounded-[14px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] p-3">
              <label className="block">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                  Moderator Service Pubkey
                </span>
                <input
                  type="text"
                  value={moderatorPubkeyInput}
                  onChange={(event) => setModeratorPubkeyInput(event.target.value)}
                  placeholder="64-char hex pubkey"
                  className="
                    mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                    bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5
                    text-[14px] text-[rgb(var(--color-label))]
                    placeholder:text-[rgb(var(--color-label-tertiary))]
                    outline-none
                  "
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))]">
                  This service can see your report payload and your signer pubkey for triage. Choose only services you trust.
                </p>
              </label>

              <label className="block">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                  Moderator Relay URLs
                </span>
                <textarea
                  value={moderatorRelayInput}
                  onChange={(event) => setModeratorRelayInput(event.target.value)}
                  placeholder="wss://relay.nos.social"
                  rows={3}
                  className="
                    mt-2 w-full resize-y rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                    bg-[rgb(var(--color-bg-secondary))] px-3 py-2.5
                    text-[14px] leading-6 text-[rgb(var(--color-label))]
                    placeholder:text-[rgb(var(--color-label-tertiary))]
                    outline-none
                  "
                />
                <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))]">
                  One URL per line (or comma-separated). Invalid relay URLs are ignored.
                </p>
              </label>
            </div>
          )}

          {canMuteTarget && (
            <label className="flex items-start gap-3 rounded-[14px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg-secondary))] px-3 py-3">
              <input
                type="checkbox"
                checked={muteAuthorAfterReport}
                disabled={targetAlreadyMuted}
                onChange={(event) => setMuteAuthorAfterReport(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <div>
                <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
                  Mute author after publish
                </p>
                <p className="mt-0.5 text-[12px] text-[rgb(var(--color-label-secondary))]">
                  {targetAlreadyMuted
                    ? 'This author is already muted.'
                    : 'Applies your local mute list immediately after the report is published.'}
                </p>
              </div>
            </label>
          )}

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
