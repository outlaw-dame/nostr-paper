import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'
import { usePublishEvent } from '@/hooks/usePublishEvent'
import { getDirectMessageCapability, publishDirectMessage } from '@/lib/nostr/dm'
import { decodeProfileReference } from '@/lib/nostr/nip21'

function resolveRecipient(input: string): string | null {
  return decodeProfileReference(input)?.pubkey ?? null
}

export default function DmComposePage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()
  const capability = getDirectMessageCapability()
  const { publish, isPublishing, error: publishError, reset } = usePublishEvent()
  const [recipientInput, setRecipientInput] = useState('')
  const [body, setBody] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const recipientPubkey = useMemo(() => resolveRecipient(recipientInput), [recipientInput])

  const handleSend = async () => {
    reset()
    setLocalError(null)

    if (!recipientPubkey) {
      setLocalError('Enter a valid hex pubkey, npub, or nprofile.')
      return
    }
    if (!body.trim()) {
      setLocalError('Write a message before sending.')
      return
    }

    const id = await publish((signal) => publishDirectMessage({
      recipientPubkey,
      plaintext: body,
      signal,
    }))

    if (id) {
      navigate(`/dm/${recipientPubkey}`)
    }
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe pt-safe">
      <div className="mx-auto max-w-3xl py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link to="/dm" className="text-[14px] font-medium text-[rgb(var(--color-label-secondary))]">
              Messages
            </Link>
            <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.03em] text-[rgb(var(--color-label))]">
              New Message
            </h1>
          </div>
        </div>

        {!currentUser && (
          <div className="mt-4 rounded-[8px] border border-[rgb(var(--color-system-red)/0.18)] bg-[rgb(var(--color-system-red)/0.08)] p-3 text-[13px] leading-6 text-[rgb(var(--color-system-red))]">
            Connect a signer before sending encrypted messages.
          </div>
        )}

        {currentUser && !capability.canEncrypt && (
          <div className="mt-4 rounded-[8px] border border-[rgb(var(--color-system-red)/0.18)] bg-[rgb(var(--color-system-red)/0.08)] p-3 text-[13px] leading-6 text-[rgb(var(--color-system-red))]">
            Your signer does not expose NIP-44 or NIP-04 encryption.
          </div>
        )}

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Recipient
            </span>
            <input
              value={recipientInput}
              onChange={(event) => setRecipientInput(event.target.value)}
              placeholder="hex pubkey, npub, or nprofile"
              className="
                mt-2 w-full rounded-[8px] border border-[rgb(var(--color-fill)/0.16)]
                bg-[rgb(var(--color-bg-secondary))] px-3 py-3
                font-mono text-[13px] text-[rgb(var(--color-label))]
                outline-none placeholder:font-sans placeholder:text-[rgb(var(--color-label-tertiary))]
              "
            />
          </label>

          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              Message
            </span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              placeholder="Write a private message"
              className="
                mt-2 w-full resize-none rounded-[8px] border border-[rgb(var(--color-fill)/0.16)]
                bg-[rgb(var(--color-bg-secondary))] px-3 py-3
                text-[15px] leading-6 text-[rgb(var(--color-label))]
                outline-none placeholder:text-[rgb(var(--color-label-tertiary))]
              "
            />
          </label>

          {(localError || publishError) && (
            <p className="rounded-[8px] bg-[rgb(var(--color-system-red)/0.08)] px-3 py-2 text-[13px] leading-6 text-[rgb(var(--color-system-red))]">
              {localError ?? publishError}
            </p>
          )}

          <div className="flex gap-2">
            <Link
              to="/dm"
              className="flex-1 rounded-[8px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-4 py-3 text-center text-[14px] font-medium text-[rgb(var(--color-label))]"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!currentUser || !capability.canEncrypt || isPublishing}
              className="flex-1 rounded-[8px] bg-[#007AFF] px-4 py-3 text-[14px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
            >
              {isPublishing ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
