import { Link } from 'react-router-dom'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { useApp } from '@/contexts/app-context'
import { useDirectMessages, type DirectMessageViewModel } from '@/hooks/useDirectMessages'
import { useProfile } from '@/hooks/useProfile'
import { getDirectMessageCapability } from '@/lib/nostr/dm'

const DM_SEEN_PREFIX = 'nostr-paper:dm-seen:'

function getSeenAt(pubkey: string): number {
  const value = localStorage.getItem(`${DM_SEEN_PREFIX}${pubkey}`)
  const parsed = value ? Number(value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

function formatTimestamp(seconds: number): string {
  const date = new Date(seconds * 1000)
  const now = Date.now()
  const ageMs = Math.max(0, now - date.getTime())
  if (ageMs < 60_000) return 'now'
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)}m`
  if (ageMs < 24 * 60 * 60_000) return `${Math.floor(ageMs / (60 * 60_000))}h`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function previewMessage(message: DirectMessageViewModel): string {
  if (message.decrypted?.plaintext) return message.decrypted.plaintext
  return message.error ?? 'Encrypted message'
}

function ConversationRow({
  pubkey,
  latest,
  unreadCount,
}: {
  pubkey: string
  latest: DirectMessageViewModel
  unreadCount: number
}) {
  const { profile } = useProfile(pubkey)

  return (
    <Link
      to={`/dm/${pubkey}`}
      className="
        flex items-start gap-3 rounded-[8px] border border-[rgb(var(--color-fill)/0.14)]
        bg-[rgb(var(--color-bg-secondary))] p-3
        transition-opacity active:opacity-75
      "
    >
      <div className="min-w-0 flex-1">
        <AuthorRow pubkey={pubkey} profile={profile} timestamp={latest.createdAt} />
        <p className="mt-2 line-clamp-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
          {latest.direction === 'outbound' ? 'You: ' : ''}
          {previewMessage(latest)}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
          {formatTimestamp(latest.createdAt)}
        </span>
        {unreadCount > 0 && (
          <span className="min-w-5 rounded-full bg-[#007AFF] px-2 py-0.5 text-center text-[11px] font-semibold text-white">
            {unreadCount}
          </span>
        )}
      </div>
    </Link>
  )
}

export default function DmInboxPage() {
  const { currentUser } = useApp()
  const capability = getDirectMessageCapability()
  const { messages, loading, error, refresh } = useDirectMessages({
    currentUserPubkey: currentUser?.pubkey,
    limit: 300,
  })

  const conversations = [...messages.reduce((map, message) => {
    const existing = map.get(message.counterpartyPubkey)
    if (!existing || message.createdAt > existing.latest.createdAt) {
      map.set(message.counterpartyPubkey, {
        latest: message,
        unreadCount: 0,
      })
    }

    const current = map.get(message.counterpartyPubkey)
    if (current && message.direction === 'inbound' && message.createdAt > getSeenAt(message.counterpartyPubkey)) {
      current.unreadCount += 1
    }

    return map
  }, new Map<string, { latest: DirectMessageViewModel; unreadCount: number }>()).entries()]
    .map(([pubkey, value]) => ({ pubkey, ...value }))
    .sort((a, b) => b.latest.createdAt - a.latest.createdAt || a.pubkey.localeCompare(b.pubkey))

  if (!currentUser) {
    return (
      <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe pt-safe">
        <div className="mx-auto max-w-3xl py-6">
          <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-[rgb(var(--color-label))]">
            Messages
          </h1>
          <p className="mt-3 text-[15px] leading-6 text-[rgb(var(--color-label-secondary))]">
            Connect a signer to read and send encrypted direct messages.
          </p>
          <Link
            to="/onboard"
            className="mt-5 inline-flex rounded-[8px] bg-[rgb(var(--color-label))] px-4 py-2.5 text-[14px] font-medium text-white"
          >
            Connect Signer
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe pt-safe">
      <div className="mx-auto max-w-3xl py-5">
        <div className="sticky top-0 z-10 -mx-4 bg-[rgb(var(--color-bg)/0.9)] px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-[30px] font-semibold tracking-[-0.03em] text-[rgb(var(--color-label))]">
                Messages
              </h1>
              <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                {capability.preferredEncryption === 'nip44'
                  ? 'NIP-44 encryption ready'
                  : capability.preferredEncryption === 'nip04'
                    ? 'NIP-04 fallback ready'
                    : 'Encryption unavailable'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void refresh()}
                className="rounded-[8px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
              >
                Refresh
              </button>
              <Link
                to="/dm/compose"
                className="rounded-[8px] bg-[rgb(var(--color-label))] px-3 py-2 text-[13px] font-medium text-white"
              >
                Compose
              </Link>
            </div>
          </div>
        </div>

        {!capability.canEncrypt && (
          <div className="mt-4 rounded-[8px] border border-[rgb(var(--color-system-red)/0.18)] bg-[rgb(var(--color-system-red)/0.08)] p-3 text-[13px] leading-6 text-[rgb(var(--color-system-red))]">
            Your signer does not expose NIP-44 or NIP-04 encryption. You can see encrypted events, but message text cannot be decrypted here.
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-[8px] border border-[rgb(var(--color-system-red)/0.18)] bg-[rgb(var(--color-system-red)/0.08)] p-3 text-[13px] leading-6 text-[rgb(var(--color-system-red))]">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-2">
          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.pubkey}
              pubkey={conversation.pubkey}
              latest={conversation.latest}
              unreadCount={conversation.unreadCount}
            />
          ))}

          {loading && conversations.length === 0 && (
            <div className="rounded-[8px] bg-[rgb(var(--color-fill)/0.07)] p-4 text-[14px] text-[rgb(var(--color-label-secondary))]">
              Loading messages...
            </div>
          )}

          {!loading && conversations.length === 0 && (
            <div className="rounded-[8px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-4">
              <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                No conversations yet.
              </p>
              <p className="mt-1 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                Start a direct message from a profile or compose one by pubkey.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
