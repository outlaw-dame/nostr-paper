import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { useApp } from '@/contexts/app-context'
import { useDirectMessages, type DirectMessageViewModel } from '@/hooks/useDirectMessages'
import { useProfile } from '@/hooks/useProfile'
import { usePublishEvent } from '@/hooks/usePublishEvent'
import { getDirectMessageCapability, publishDirectMessage } from '@/lib/nostr/dm'
import { decodeProfileReference } from '@/lib/nostr/nip21'

const DM_SEEN_PREFIX = 'nostr-paper:dm-seen:'

function formatTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function MessageBubble({ message }: { message: DirectMessageViewModel }) {
  const outbound = message.direction === 'outbound'

  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`
          max-w-[82%] rounded-[8px] px-3 py-2
          ${outbound
            ? 'bg-[#007AFF] text-white'
            : 'border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-label))]'
          }
        `}
      >
        <p className="whitespace-pre-wrap break-words text-[15px] leading-6">
          {message.decrypted?.plaintext ?? message.error ?? 'Encrypted message'}
        </p>
        <p className={`mt-1 text-[11px] ${outbound ? 'text-white/72' : 'text-[rgb(var(--color-label-tertiary))]'}`}>
          {formatTimestamp(message.createdAt)}
        </p>
      </div>
    </div>
  )
}

export default function DmThreadPage() {
  const { pubkey: pubkeyParam } = useParams<{ pubkey: string }>()
  const navigate = useNavigate()
  const decoded = useMemo(() => decodeProfileReference(pubkeyParam), [pubkeyParam])
  const counterpartyPubkey = decoded?.pubkey ?? null
  const { currentUser } = useApp()
  const { profile } = useProfile(counterpartyPubkey ?? undefined)
  const capability = getDirectMessageCapability()
  const { messages, loading, error, refresh } = useDirectMessages({
    currentUserPubkey: currentUser?.pubkey,
    ...(counterpartyPubkey ? { counterpartyPubkey } : {}),
    limit: 300,
  })
  const { publish, isPublishing, error: publishError, reset } = usePublishEvent()
  const [body, setBody] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!counterpartyPubkey || messages.length === 0) return
    const latestInbound = messages
      .filter((message) => message.direction === 'inbound')
      .reduce((latest, message) => Math.max(latest, message.createdAt), 0)
    if (latestInbound > 0) {
      localStorage.setItem(`${DM_SEEN_PREFIX}${counterpartyPubkey}`, String(latestInbound))
    }
  }, [counterpartyPubkey, messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const handleBack = () => {
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/dm')
  }

  const handleSend = async () => {
    if (!counterpartyPubkey || !body.trim()) return
    reset()
    const sent = await publish((signal) => publishDirectMessage({
      recipientPubkey: counterpartyPubkey,
      plaintext: body,
      signal,
    }))
    if (sent) {
      setBody('')
      await refresh()
    }
  }

  if (!currentUser) {
    return (
      <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe pt-safe">
        <div className="mx-auto max-w-3xl py-6">
          <Link to="/dm" className="text-[14px] font-medium text-[rgb(var(--color-label-secondary))]">
            Messages
          </Link>
          <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.03em] text-[rgb(var(--color-label))]">
            Connect a signer
          </h1>
        </div>
      </div>
    )
  }

  if (!counterpartyPubkey) {
    return (
      <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe pt-safe">
        <div className="mx-auto max-w-3xl py-6">
          <button
            type="button"
            onClick={handleBack}
            className="rounded-[8px] bg-[rgb(var(--color-fill)/0.09)] px-3 py-2 text-[14px] text-[rgb(var(--color-label))]"
          >
            Back
          </button>
          <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.03em] text-[rgb(var(--color-label))]">
            Invalid conversation
          </h1>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[rgb(var(--color-bg))] px-4 pb-safe pt-safe">
      <div className="sticky top-0 z-10 -mx-4 border-b border-[rgb(var(--color-fill)/0.1)] bg-[rgb(var(--color-bg)/0.9)] px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="rounded-[8px] bg-[rgb(var(--color-fill)/0.09)] px-3 py-2 text-[14px] text-[rgb(var(--color-label))]"
          >
            Back
          </button>
          <div className="min-w-0 flex-1">
            <AuthorRow pubkey={counterpartyPubkey} profile={profile} />
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-[8px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
          >
            Refresh
          </button>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col py-4">
        {error && (
          <div className="mb-3 rounded-[8px] border border-[rgb(var(--color-system-red)/0.18)] bg-[rgb(var(--color-system-red)/0.08)] p-3 text-[13px] leading-6 text-[rgb(var(--color-system-red))]">
            {error}
          </div>
        )}

        {!capability.canEncrypt && (
          <div className="mb-3 rounded-[8px] border border-[rgb(var(--color-system-red)/0.18)] bg-[rgb(var(--color-system-red)/0.08)] p-3 text-[13px] leading-6 text-[rgb(var(--color-system-red))]">
            Your signer does not expose NIP-44 or NIP-04 encryption, so sending and decrypting DMs is unavailable.
          </div>
        )}

        <div className="flex-1 space-y-2">
          {messages.map((message) => (
            <MessageBubble key={message.event.id} message={message} />
          ))}

          {loading && messages.length === 0 && (
            <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
              Loading conversation...
            </p>
          )}

          {!loading && messages.length === 0 && (
            <div className="rounded-[8px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-4">
              <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                No messages yet.
              </p>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {publishError && (
          <p className="mt-3 text-[13px] leading-6 text-[rgb(var(--color-system-red))]">
            {publishError}
          </p>
        )}

        <div className="mt-4 flex gap-2 border-t border-[rgb(var(--color-fill)/0.1)] pt-3">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write a message"
            rows={2}
            disabled={!capability.canEncrypt || isPublishing}
            className="
              min-h-[48px] flex-1 resize-none rounded-[8px] border border-[rgb(var(--color-fill)/0.16)]
              bg-[rgb(var(--color-bg-secondary))] px-3 py-2
              text-[15px] leading-6 text-[rgb(var(--color-label))]
              outline-none placeholder:text-[rgb(var(--color-label-tertiary))]
              disabled:opacity-50
            "
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!capability.canEncrypt || isPublishing || body.trim().length === 0}
            className="self-end rounded-[8px] bg-[#007AFF] px-4 py-3 text-[14px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
          >
            {isPublishing ? 'Sending...' : 'Send'}
          </button>
        </div>
      </main>
    </div>
  )
}
