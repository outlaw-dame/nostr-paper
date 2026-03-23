import { useState } from 'react'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { NoteContent } from '@/components/cards/NoteContent'
import { useApp } from '@/contexts/app-context'
import { useEvent } from '@/hooks/useEvent'
import {
  canDecryptDvmEvent,
  decryptDvmEncryptedContent,
  isKnownDvmFeedbackStatus,
  parseDvmJobFeedbackEvent,
} from '@/lib/nostr/dvm'
import type { NostrEvent } from '@/types'

interface DvmFeedbackBodyProps {
  event: NostrEvent
  className?: string
}

function formatMsats(msats: number): string {
  return `${msats.toLocaleString()} msats`
}

export function DvmFeedbackBody({
  event,
  className = '',
}: DvmFeedbackBodyProps) {
  const feedback = parseDvmJobFeedbackEvent(event)
  const { currentUser } = useApp()
  const { event: fetchedRequest, loading: requestLoading } = useEvent(
    feedback?.requestEvent ? null : feedback?.requestEventId,
  )
  const [decrypting, setDecrypting] = useState(false)
  const [decryptError, setDecryptError] = useState<string | null>(null)
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null)

  if (!feedback) return null

  const requestEvent = feedback.requestEvent ?? fetchedRequest
  const canDecrypt = feedback.hasEncryptedPayload && canDecryptDvmEvent(event, currentUser?.pubkey)
  const statusLabel = isKnownDvmFeedbackStatus(feedback.status)
    ? feedback.status.replace(/-/g, ' ')
    : feedback.status
  const visibleContent = decryptedContent ?? (!feedback.isEncrypted ? feedback.content : '')

  const handleDecrypt = async () => {
    if (!canDecrypt || decrypting) return
    setDecrypting(true)
    setDecryptError(null)

    try {
      const plaintext = await decryptDvmEncryptedContent(event, currentUser?.pubkey)
      setDecryptedContent(plaintext)
    } catch (loadError: unknown) {
      setDecryptError(loadError instanceof Error ? loadError.message : 'Failed to decrypt DVM feedback.')
    } finally {
      setDecrypting(false)
    }
  }

  return (
    <div className={`space-y-4 rounded-[20px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            NIP-90 Job Feedback
          </p>
          <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
            {statusLabel}
          </h3>
          {feedback.statusMessage && (
            <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {feedback.statusMessage}
            </p>
          )}
        </div>

        {feedback.isEncrypted && (
          <span className="rounded-full bg-[rgb(var(--color-fill)/0.10)] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            Encrypted
          </span>
        )}
      </div>

      {feedback.amount && (
        <div className="rounded-[14px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] p-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">
            Requested Payment
          </p>
          <p className="mt-1 text-[14px] text-[rgb(var(--color-label-secondary))]">
            {formatMsats(feedback.amount.msats)}
          </p>
          {feedback.amount.invoice && (
            <p className="mt-2 break-all font-mono text-[12px] text-[rgb(var(--color-label-tertiary))]">
              {feedback.amount.invoice}
            </p>
          )}
        </div>
      )}

      {feedback.hasEncryptedPayload && (
        <div className="space-y-3 rounded-[16px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] p-3">
          <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
            This feedback content is encrypted for the customer and service provider.
          </p>

          {canDecrypt && !decryptedContent && (
            <button
              type="button"
              onClick={() => void handleDecrypt()}
              disabled={decrypting}
              className="rounded-[14px] bg-[rgb(var(--color-label))] px-4 py-2 text-[14px] font-medium text-white disabled:opacity-45"
            >
              {decrypting ? 'Decrypting…' : 'Decrypt feedback'}
            </button>
          )}

          {!canDecrypt && (
            <p className="text-[13px] leading-6 text-[rgb(var(--color-label-tertiary))]">
              Connect the participating signer with NIP-04 support to decrypt this feedback.
            </p>
          )}

          {decryptError && (
            <p className="text-[13px] text-[rgb(var(--color-system-red))]">
              {decryptError}
            </p>
          )}
        </div>
      )}

      {visibleContent.trim().length > 0 && (
        <NoteContent content={visibleContent} className="mt-1" />
      )}

      <div className="space-y-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          Original Request
        </p>

        {requestEvent ? (
          <EventPreviewCard event={requestEvent} compact linked />
        ) : (
          <div className="rounded-[14px] border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg))] p-3 text-[14px] text-[rgb(var(--color-label-secondary))]">
            {requestLoading ? 'Loading original request…' : 'Original request unavailable.'}
          </div>
        )}
      </div>
    </div>
  )
}
