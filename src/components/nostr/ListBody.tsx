import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { naddrEncode } from 'nostr-tools/nip19'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { useApp } from '@/contexts/app-context'
import { useProfile } from '@/hooks/useProfile'
import { getEvent, getLatestAddressableEvent } from '@/lib/db/nostr'
import { parseAddressCoordinate } from '@/lib/nostr/addressable'
import { saveCurrentUserContactEntries } from '@/lib/nostr/contacts'
import {
  canDecryptNip51PrivateItems,
  decryptNip51PrivateItems,
  isNip51ProfilePackKind,
  parseNip51ListEvent,
  type Nip51ListItem,
} from '@/lib/nostr/lists'
import { getNDK } from '@/lib/nostr/ndk'
import { sanitizeText } from '@/lib/security/sanitize'
import { TwemojiText } from '@/components/ui/TwemojiText'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

interface ListBodyProps {
  event: NostrEvent
  className?: string
}

interface ItemLinkTarget {
  to?: string
  href?: string
}

const MAX_SPECIALIZED_ITEMS = 24

function formatHex(value: string, keep = 10): string {
  if (value.length <= keep * 2) return value
  return `${value.slice(0, keep)}…${value.slice(-keep)}`
}

function getAddressHref(address: string): string | null {
  const parsed = parseAddressCoordinate(address)
  if (!parsed) return null

  try {
    const naddr = naddrEncode({
      kind: parsed.kind,
      pubkey: parsed.pubkey,
      identifier: parsed.identifier,
    })
    return `/a/${naddr}`
  } catch {
    return null
  }
}

function getItemLinkTarget(item: Nip51ListItem): ItemLinkTarget | null {
  switch (item.tagName) {
    case 'p':
      return item.values[0] ? { to: `/profile/${item.values[0]}` } : null
    case 'e':
      return item.values[0] ? { to: `/note/${item.values[0]}` } : null
    case 'a': {
      const href = item.values[0] ? getAddressHref(item.values[0]) : null
      return href ? { to: href } : null
    }
    case 't':
      return item.values[0] ? { to: `/t/${encodeURIComponent(item.values[0])}` } : null
    case 'emoji':
      return null
    default:
      return null
  }
}

function getItemPrimaryText(item: Nip51ListItem): string {
  switch (item.tagName) {
    case 'p':
      return item.values[2] || formatHex(item.values[0] ?? '')
    case 'e':
      return `Event ${formatHex(item.values[0] ?? '')}`
    case 'a':
      return item.values[0] ?? 'Address'
    case 't':
      return `#${item.values[0] ?? ''}`
    case 'word':
      return item.values[0] ?? ''
    case 'group':
      return item.values[2] || item.values[0] || 'Group'
    case 'emoji':
      return `:${item.values[0] ?? ''}:`
    case 'relay':
    case 'r':
      return item.values[0] ?? ''
    default:
      return item.values[0] ?? item.tagName
  }
}

function getItemSecondaryText(item: Nip51ListItem): string | null {
  switch (item.tagName) {
    case 'p': {
      const extras = [item.values[0], item.values[1]].filter(Boolean)
      return extras.length > 0 ? extras.join(' • ') : null
    }
    case 'e': {
      const extras = [item.values[1], item.values[2]].filter(Boolean)
      return extras.length > 0 ? extras.join(' • ') : null
    }
    case 'a':
      return null
    case 't':
      return 'Hashtag'
    case 'word':
      return 'Muted word'
    case 'group': {
      const extras = [item.values[0], item.values[1]].filter(Boolean)
      return extras.length > 0 ? extras.join(' • ') : null
    }
    case 'emoji':
      return item.values[1] ?? null
    case 'relay':
    case 'r':
      return item.values[1] ?? null
    default:
      return item.values.slice(1).filter(Boolean).join(' • ') || null
  }
}

function getEventTagValue(event: NostrEvent, tagNames: string[]): string | undefined {
  for (const tag of event.tags) {
    if (typeof tag[0] !== 'string') continue
    if (!tagNames.includes(tag[0])) continue
    if (typeof tag[1] !== 'string') continue
    const normalized = sanitizeText(tag[1]).trim()
    if (normalized.length > 0) return normalized
  }
  return undefined
}

function getGenericTargetTitle(event: NostrEvent, fallback: string): string {
  return getEventTagValue(event, ['title', 'name', 'd', 'alt']) ?? fallback
}

function getGenericTargetSummary(event: NostrEvent): string | null {
  const summary = getEventTagValue(event, ['summary', 'description', 'about', 'url', 'website', 'repository'])
  if (summary) return summary

  const content = sanitizeText(event.content).trim().replace(/\s+/g, ' ')
  if (content.length === 0) return null
  return content.length > 180 ? `${content.slice(0, 180)}…` : content
}

function ListItemCard({ item, index }: { item: Nip51ListItem; index: number }) {
  const primary = getItemPrimaryText(item)
  const secondary = getItemSecondaryText(item)
  const linkTarget = getItemLinkTarget(item)
  const key = `${item.tagName}:${item.values.join('\u0001')}:${index}`

  const content = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            {item.tagName}
          </p>
          <p className="mt-1 break-words text-[14px] font-medium text-[rgb(var(--color-label))]">
            <TwemojiText text={primary} />
          </p>
          {secondary && (
            <p className="mt-1 break-all text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
              <TwemojiText text={secondary} />
            </p>
          )}
        </div>

        {item.tagName === 'emoji' && item.values[1] && (
          <img
            src={item.values[1]}
            alt={`:${item.values[0] ?? ''}:`}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-10 w-10 shrink-0 rounded-[12px] border border-[rgb(var(--color-fill)/0.12)] object-cover"
          />
        )}
      </div>
    </>
  )

  const className = `
    block rounded-[16px] border border-[rgb(var(--color-fill)/0.12)]
    bg-[rgb(var(--color-bg))] px-3 py-3 transition-opacity active:opacity-80
  `

  if (linkTarget?.to) {
    return (
      <Link key={key} to={linkTarget.to} className={className}>
        {content}
      </Link>
    )
  }

  if (linkTarget?.href) {
    return (
      <a
        key={key}
        href={linkTarget.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={className}
      >
        {content}
      </a>
    )
  }

  return (
    <div key={key} className={className}>
      {content}
    </div>
  )
}

function FollowSetProfileCard({ item, index }: { item: Nip51ListItem; index: number }) {
  const pubkey = item.values[0] ?? ''
  const { profile } = useProfile(pubkey, { background: false })
  const relayHint = item.values[1]
  const petname = item.values[2]

  return (
    <Link
      key={`${pubkey}:${index}`}
      to={`/profile/${pubkey}`}
      className="
        block rounded-[16px] border border-[rgb(var(--color-fill)/0.12)]
        bg-[rgb(var(--color-bg))] px-3 py-3 transition-opacity active:opacity-80
      "
    >
      <AuthorRow pubkey={pubkey} profile={profile} />
      {(petname || relayHint) && (
        <p className="mt-2 break-all text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
          {[petname ? `Petname: ${petname}` : null, relayHint].filter(Boolean).join(' • ')}
        </p>
      )}
    </Link>
  )
}

function ReferencedEventCard({ item, index }: { item: Nip51ListItem; index: number }) {
  const target = getItemLinkTarget(item)
  const [resolvedEvent, setResolvedEvent] = useState<NostrEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const itemKey = `${item.tagName}:${item.values.join('\u0001')}`

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller

    async function load(): Promise<void> {
      setLoading(true)

      let local: NostrEvent | null = null
      if (item.tagName === 'e' && item.values[0]) {
        local = await getEvent(item.values[0])
      } else if (item.tagName === 'a' && item.values[0]) {
        const coordinate = parseAddressCoordinate(item.values[0])
        if (coordinate) {
          local = await getLatestAddressableEvent(
            coordinate.pubkey,
            coordinate.kind,
            coordinate.identifier,
          )
        }
      }

      if (signal.aborted) return
      if (local) {
        setResolvedEvent(local)
        setLoading(false)
        return
      }

      let ndk
      try {
        ndk = getNDK()
      } catch {
        setLoading(false)
        return
      }

      try {
        if (item.tagName === 'e' && item.values[0]) {
          await ndk.fetchEvents({
            ids: [item.values[0]],
            limit: 1,
          })
          local = await getEvent(item.values[0])
        } else if (item.tagName === 'a' && item.values[0]) {
          const coordinate = parseAddressCoordinate(item.values[0])
          if (coordinate) {
            await ndk.fetchEvents({
              authors: [coordinate.pubkey],
              kinds: [coordinate.kind],
              '#d': [coordinate.identifier],
              limit: 8,
            })
            local = await getLatestAddressableEvent(
              coordinate.pubkey,
              coordinate.kind,
              coordinate.identifier,
            )
          }
        }
      } catch {
        // Degrade to raw list-item fallback when the target cannot be fetched.
      }

      if (!signal.aborted) {
        setResolvedEvent(local)
        setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [item.tagName, itemKey])

  if (resolvedEvent && resolvedEvent.kind !== Kind.SoftwareApplication) {
    return <EventPreviewCard event={resolvedEvent} compact />
  }

  const fallbackTitle = resolvedEvent
    ? getGenericTargetTitle(resolvedEvent, getItemPrimaryText(item))
    : getItemPrimaryText(item)
  const fallbackSummary = resolvedEvent
    ? getGenericTargetSummary(resolvedEvent)
    : getItemSecondaryText(item)

  const content = (
    <div
      className="
        rounded-[16px] border border-[rgb(var(--color-fill)/0.12)]
        bg-[rgb(var(--color-bg))] px-3 py-3
      "
    >
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        {resolvedEvent?.kind === Kind.SoftwareApplication ? 'Software application' : item.tagName}
      </p>
      <p className="mt-1 break-words text-[14px] font-medium text-[rgb(var(--color-label))]">
        <TwemojiText text={fallbackTitle} />
      </p>
      {fallbackSummary && (
        <p className="mt-1 break-all text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
          <TwemojiText text={fallbackSummary} />
        </p>
      )}
      {loading && (
        <p className="mt-2 text-[12px] text-[rgb(var(--color-label-tertiary))]">
          Resolving referenced event…
        </p>
      )}
    </div>
  )

  if (target?.to) {
    return (
      <Link key={`${itemKey}:${index}`} to={target.to} className="block transition-opacity active:opacity-80">
        {content}
      </Link>
    )
  }

  return <div key={`${itemKey}:${index}`}>{content}</div>
}

export function ListBody({ event, className = '' }: ListBodyProps) {
  const parsed = parseNip51ListEvent(event)
  const { currentUser } = useApp()
  const [privateItems, setPrivateItems] = useState<Nip51ListItem[] | null>(null)
  const [decrypting, setDecrypting] = useState(false)
  const [decryptError, setDecryptError] = useState<string | null>(null)
  const [followingAll, setFollowingAll] = useState(false)
  const [followAllMessage, setFollowAllMessage] = useState<string | null>(null)
  const [followAllError, setFollowAllError] = useState<string | null>(null)
  const followTargets = useMemo(() => {
    if (!parsed) return []

    const deduped = new Map<string, { pubkey: string; relayUrl?: string | null; petname?: string | null }>()
    for (const item of parsed.publicItems) {
      if (item.tagName !== 'p') continue
      const pubkey = item.values[0]
      if (!pubkey || deduped.has(pubkey)) continue
      deduped.set(pubkey, {
        pubkey,
        ...(item.values[1] ? { relayUrl: item.values[1] } : {}),
        ...(item.values[2] ? { petname: item.values[2] } : {}),
      })
    }

    return [...deduped.values()]
  }, [parsed])

  if (!parsed) return null

  const isAuthor = currentUser?.pubkey === event.pubkey
  const canDecrypt = canDecryptNip51PrivateItems(event, currentUser?.pubkey)
  const encryptionLabel = parsed.privateEncryption === 'nip04' ? 'legacy NIP-04' : 'NIP-44'
  const visiblePublicItems = parsed.publicItems.slice(0, MAX_SPECIALIZED_ITEMS)
  const hiddenPublicItemCount = Math.max(parsed.publicItems.length - visiblePublicItems.length, 0)
  const isProfilePack = parsed.kind === Kind.StarterPack || parsed.kind === Kind.MediaStarterPack

  const handleDecrypt = async () => {
    if (decrypting || !canDecrypt) return

    setDecrypting(true)
    setDecryptError(null)

    try {
      const decrypted = await decryptNip51PrivateItems(event, currentUser?.pubkey)
      setPrivateItems(decrypted)
    } catch (error) {
      setDecryptError(error instanceof Error ? error.message : 'Failed to decrypt the private list items.')
    } finally {
      setDecrypting(false)
    }
  }

  const handleFollowAll = async () => {
    if (followingAll || !currentUser || isAuthor || followTargets.length === 0) return

    setFollowingAll(true)
    setFollowAllMessage(null)
    setFollowAllError(null)

    try {
      await saveCurrentUserContactEntries(followTargets)
      setFollowAllMessage(
        `Merged ${followTargets.length} profile${followTargets.length === 1 ? '' : 's'} into your Kind-3 contact list.`,
      )
    } catch (error) {
      setFollowAllError(error instanceof Error ? error.message : 'Failed to follow starter pack profiles.')
    } finally {
      setFollowingAll(false)
    }
  }

  const renderPublicItems = () => {
    if (visiblePublicItems.length === 0) {
      return (
        <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
          No public items are published on this list yet.
        </p>
      )
    }

    if (isNip51ProfilePackKind(parsed.kind)) {
      return (
        <div className="mt-3 space-y-2">
          {visiblePublicItems.map((item, index) => (
            <FollowSetProfileCard key={`${item.values[0] ?? index}:${index}`} item={item} index={index} />
          ))}
        </div>
      )
    }

    if (parsed.kind === Kind.ArticleCurationSet || parsed.kind === Kind.AppCurationSet) {
      return (
        <div className="mt-3 space-y-3">
          {visiblePublicItems.map((item, index) => (
            <ReferencedEventCard key={`${item.tagName}:${item.values.join('\u0001')}:${index}`} item={item} index={index} />
          ))}
        </div>
      )
    }

    return (
      <div className="mt-3 space-y-2">
        {visiblePublicItems.map((item, index) => (
          <ListItemCard key={`${item.tagName}:${item.values.join('\u0001')}:${index}`} item={item} index={index} />
        ))}
      </div>
    )
  }

  return (
    <div className={`rounded-[20px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-4 ${className}`}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        {parsed.definition.addressable ? 'NIP-51 Set' : 'NIP-51 List'}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
          <TwemojiText text={parsed.title ?? parsed.definition.name} />
        </h3>
        <span className="rounded-full bg-[rgb(var(--color-fill)/0.1)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
          Kind {parsed.kind}
        </span>
      </div>

      {parsed.identifier && (
        <p className="mt-2 break-all font-mono text-[12px] text-[rgb(var(--color-label-tertiary))]">
          d={parsed.identifier}
        </p>
      )}

      <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
        <TwemojiText text={parsed.description ?? parsed.definition.description} />
      </p>

      {isProfilePack && (
        <div className="mt-4 rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Shared profiles
              </p>
              <p className="mt-1 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                {followTargets.length} profile{followTargets.length === 1 ? '' : 's'}{parsed.kind === Kind.MediaStarterPack ? ' for media-first clients' : ''} can be followed together.
              </p>
            </div>

            {!isAuthor && currentUser && followTargets.length > 0 && (
              <button
                type="button"
                onClick={() => void handleFollowAll()}
                disabled={followingAll}
                className="rounded-[14px] bg-[rgb(var(--color-label))] px-3 py-2 text-[13px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
              >
                {followingAll ? 'Following…' : 'Follow All'}
              </button>
            )}
          </div>

          {!currentUser && (
            <p className="mt-3 text-[13px] leading-6 text-[rgb(var(--color-label-tertiary))]">
              Connect a NIP-07 signer to follow this {parsed.kind === Kind.MediaStarterPack ? 'media starter pack' : 'starter pack'} with one Kind-3 publish.
            </p>
          )}

          {followAllMessage && (
            <p className="mt-3 text-[13px] text-[rgb(var(--color-system-green))]">
              {followAllMessage}
            </p>
          )}

          {followAllError && (
            <p className="mt-3 text-[13px] text-[rgb(var(--color-system-red))]">
              {followAllError}
            </p>
          )}
        </div>
      )}

      {parsed.image && (
        <img
          src={parsed.image}
          alt={parsed.title ?? parsed.definition.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mt-4 h-40 w-full rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] object-cover"
        />
      )}

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
            Public items
          </p>
          <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
            {parsed.publicItems.length} item{parsed.publicItems.length === 1 ? '' : 's'}
          </p>
        </div>

        {renderPublicItems()}
        {hiddenPublicItemCount > 0 && (
          <p className="mt-3 text-[13px] leading-6 text-[rgb(var(--color-label-tertiary))]">
            {hiddenPublicItemCount} additional public item{hiddenPublicItemCount === 1 ? '' : 's'} are not shown in this preview.
          </p>
        )}
      </div>

      {parsed.hasPrivateItems && (
        <div className="mt-5 rounded-[18px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                Private items
              </p>
              <p className="mt-1 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                Encrypted in `.content` using {encryptionLabel}.
              </p>
            </div>

            {canDecrypt && privateItems === null && (
              <button
                type="button"
                onClick={() => void handleDecrypt()}
                disabled={decrypting}
                className="rounded-[14px] bg-[rgb(var(--color-label))] px-3 py-2 text-[13px] font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-40"
              >
                {decrypting ? 'Decrypting…' : 'Decrypt'}
              </button>
            )}
          </div>

          {privateItems && privateItems.length > 0 && (
            <div className="mt-3 space-y-2">
              {privateItems.map((item, index) => (
                <ListItemCard key={`private:${item.tagName}:${item.values.join('\u0001')}:${index}`} item={item} index={index} />
              ))}
            </div>
          )}

          {privateItems && privateItems.length === 0 && (
            <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              This encrypted section does not contain any valid private items.
            </p>
          )}

          {!privateItems && !canDecrypt && (
            <p className="mt-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {isAuthor
                ? 'Unlock a signer that supports NIP-44 or legacy NIP-04 decryption to view the private items.'
                : 'Private items are only visible to the list author.'}
            </p>
          )}

          {decryptError && (
            <p className="mt-3 text-[14px] text-[rgb(var(--color-system-red))]">
              {decryptError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
