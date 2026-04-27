import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { tApp } from '@/lib/i18n/app'
import { SearchBar } from '@/components/search/SearchBar'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { useApp } from '@/contexts/app-context'
import { useSavedTagFeeds } from '@/hooks/useSavedTagFeeds'
import { usePopularProfiles } from '@/hooks/usePopularProfiles'
import { useProfile } from '@/hooks/useProfile'
import { searchProfiles } from '@/lib/db/nostr'
import { deleteTagFeed, saveTagFeed, type SavedTagFeed } from '@/lib/feed/tagFeeds'
import {
  buildTagTimelineHref,
  describeTagTimeline,
  normalizeTagTimelineTags,
  type TagTimelineMode,
} from '@/lib/feed/tagTimeline'
import { isSafeMediaURL, sanitizeAbout, sanitizeName } from '@/lib/security/sanitize'
import type { Profile } from '@/types'

const PROFILE_SEARCH_DEBOUNCE_MS = 180
const PROFILE_SUGGESTION_LIMIT = 8

function formatTagInput(tags: string[]): string {
  return tags.map((tag) => `#${tag}`).join(', ')
}

function formatTagChip(tag: string, excluded = false): string {
  return excluded ? `-#${tag}` : `#${tag}`
}

function getSafeMediaPreview(url: string): string | null {
  const trimmed = url.trim()
  return trimmed.length > 0 && isSafeMediaURL(trimmed) ? trimmed : null
}

function getProfileDisplayName(profile: Profile | null | undefined, pubkey: string): string {
  const displayName = sanitizeName(profile?.display_name ?? profile?.name ?? '')
  return displayName || `${pubkey.slice(0, 8)}…`
}

function getProfileSubtitle(profile: Profile | null | undefined, pubkey: string): string {
  return profile?.nip05?.trim()
    || sanitizeName(profile?.name ?? '')
    || sanitizeName(profile?.display_name ?? '')
    || `${pubkey.slice(0, 16)}…`
}

function dedupeProfiles(profiles: Profile[]): Profile[] {
  const seen = new Set<string>()
  const next: Profile[] = []

  for (const profile of profiles) {
    if (seen.has(profile.pubkey)) continue
    seen.add(profile.pubkey)
    next.push(profile)
  }

  return next
}

interface FeedAvatarProps {
  src: string | null
  title: string
  size: number
  className?: string
}

function FeedAvatar({ src, title, size, className = '' }: FeedAvatarProps) {
  const initial = (title.trim().replace(/^#/, '')[0] ?? 'F').toUpperCase()

  return (
    <div
      className={`overflow-hidden rounded-full bg-[rgb(var(--color-fill)/0.12)] ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(145deg,rgba(var(--color-accent),0.18),rgba(var(--color-fill),0.12))] text-[rgb(var(--color-label))]">
          <span className="text-[20px] font-semibold">{initial}</span>
        </div>
      )}
    </div>
  )
}

interface FeedProfileItemProps {
  pubkey: string
  profile?: Profile | null
  actionLabel: string
  onAction: () => void
  actionVariant?: 'add' | 'remove' | 'selected'
  disabled?: boolean
}

function FeedProfileItem({
  pubkey,
  profile: profileOverride,
  actionLabel,
  onAction,
  actionVariant = 'add',
  disabled = false,
}: FeedProfileItemProps) {
  const { profile: cachedProfile } = useProfile(pubkey, { background: false })
  const profile = profileOverride ?? cachedProfile
  const displayName = getProfileDisplayName(profile, pubkey)
  const subtitle = getProfileSubtitle(profile, pubkey)
  const avatar = getSafeMediaPreview(profile?.picture ?? '')

  const buttonClassName = actionVariant === 'remove'
    ? 'border border-[rgb(var(--color-system-red)/0.2)] bg-[rgb(var(--color-system-red)/0.08)] text-[rgb(var(--color-system-red))]'
    : actionVariant === 'selected'
      ? 'border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-fill)/0.08)] text-[rgb(var(--color-label-secondary))]'
      : 'border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] text-[rgb(var(--color-label))]'

  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-[rgb(var(--color-fill)/0.1)] bg-[rgb(var(--color-bg))] px-3 py-3">
      <FeedAvatar src={avatar} title={displayName} size={44} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-[rgb(var(--color-label))]">
          <TwemojiText text={displayName} />
        </p>
        <p className="truncate text-[13px] text-[rgb(var(--color-label-secondary))]">
          <TwemojiText text={subtitle} />
        </p>
      </div>

      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className={`shrink-0 rounded-[12px] px-4 py-2 text-[13px] font-medium transition-opacity active:opacity-80 disabled:cursor-default disabled:opacity-100 ${buttonClassName}`}
      >
        {actionLabel}
      </button>
    </div>
  )
}

function getTopicChip(count: number): string {
  if (count === 0) return tApp('tagFeedsNoTopicsLabel')
  return `${count} ${count === 1 ? tApp('tagFeedsTopicSingular') : tApp('tagFeedsTopicPlural')}`
}

function getProfileChip(count: number): string {
  if (count === 0) return tApp('tagFeedsNoProfilesLabel')
  return `${count} ${count === 1 ? tApp('tagFeedsProfileSingular') : tApp('tagFeedsProfilePlural')}`
}

interface SavedTagFeedCardProps {
  feed: SavedTagFeed
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}

function SavedTagFeedCard({ feed, onOpen, onEdit, onDelete }: SavedTagFeedCardProps) {
  const details = describeTagTimeline(feed)
  const summary = feed.description || details?.summary || tApp('tagFeedsSavedTagFeedFallback')
  const avatar = getSafeMediaPreview(feed.avatar)
  const banner = getSafeMediaPreview(feed.banner)

  return (
    <div className="overflow-hidden rounded-[24px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))]">
      <div className="relative h-28 overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(var(--color-accent),0.16),_transparent_55%),linear-gradient(180deg,_rgba(var(--color-fill),0.14),_rgba(var(--color-fill),0.04))]">
        {banner && (
          <img
            src={banner}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,0.18))]" />
      </div>

      <div className="relative px-4 pb-4">
        <div className="-mt-8 flex items-end justify-between gap-3">
          <FeedAvatar
            src={avatar}
            title={feed.title}
            size={64}
            className="ring-4 ring-[rgb(var(--color-bg))]"
          />

          <div className="flex flex-wrap justify-end gap-2">
            <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
              {feed.mode === 'all' ? tApp('tagFeedsModeAll') : tApp('tagFeedsModeAny')}
            </span>
            {feed.profilePubkeys.length > 0 && (
              <span className="rounded-full bg-[rgb(var(--color-accent)/0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
                {getProfileChip(feed.profilePubkeys.length)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3">
          <p className="text-[17px] font-semibold leading-tight text-[rgb(var(--color-label))]">
            <TwemojiText text={feed.title} />
          </p>
          <p className="mt-1 line-clamp-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
            {summary}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {feed.includeTags.map((tag) => (
            <span
              key={`${feed.id}:include:${tag}`}
              className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]"
            >
              {formatTagChip(tag)}
            </span>
          ))}
          {feed.excludeTags.map((tag) => (
            <span
              key={`${feed.id}:exclude:${tag}`}
              className="rounded-full bg-[rgb(var(--color-accent)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]"
            >
              {formatTagChip(tag, true)}
            </span>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="rounded-full bg-[rgb(var(--color-label))] px-3 py-2 text-[12px] font-medium text-[rgb(var(--color-bg))] transition-opacity active:opacity-80"
          >
            {tApp('tagFeedsOpenFeed')}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-full border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2 text-[12px] font-medium text-[rgb(var(--color-label))] transition-opacity active:opacity-80"
          >
            {tApp('tagFeedsEdit')}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full border border-[rgb(var(--color-system-red)/0.2)] bg-[rgb(var(--color-system-red)/0.08)] px-3 py-2 text-[12px] font-medium text-[rgb(var(--color-system-red))] transition-opacity active:opacity-80"
          >
            {tApp('tagFeedsDelete')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TagFeedsPage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()
  const scopeId = useMemo(() => currentUser?.pubkey ?? 'anon', [currentUser?.pubkey])
  const savedFeeds = useSavedTagFeeds(scopeId)
  const { profiles: popularProfiles, loading: popularProfilesLoading } = usePopularProfiles(12)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [avatarDraft, setAvatarDraft] = useState('')
  const [bannerDraft, setBannerDraft] = useState('')
  const [includeDraft, setIncludeDraft] = useState('')
  const [excludeDraft, setExcludeDraft] = useState('')
  const [modeDraft, setModeDraft] = useState<TagTimelineMode>('any')
  const [profilePubkeysDraft, setProfilePubkeysDraft] = useState<string[]>([])
  const [profileSearchQuery, setProfileSearchQuery] = useState('')
  const [profileSearchResults, setProfileSearchResults] = useState<Profile[]>([])
  const [profileSearchLoading, setProfileSearchLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const previewSpec = useMemo(() => {
    const includeTags = normalizeTagTimelineTags(includeDraft)
    if (includeTags.length === 0) return null

    const excludeTags = normalizeTagTimelineTags(excludeDraft).filter(
      (tag) => !includeTags.includes(tag),
    )

    return {
      includeTags,
      excludeTags,
      mode: includeTags.length > 1 && modeDraft === 'all' ? 'all' : 'any',
    } satisfies {
      includeTags: string[]
      excludeTags: string[]
      mode: TagTimelineMode
    }
  }, [excludeDraft, includeDraft, modeDraft])

  const previewDescription = useMemo(
    () => describeTagTimeline(previewSpec),
    [previewSpec],
  )
  const previewTitle = useMemo(
    () => sanitizeName(titleDraft) || previewDescription?.title || tApp('tagFeedsFeedNameFallback'),
    [previewDescription?.title, titleDraft],
  )
  const previewSummary = useMemo(
    () => sanitizeAbout(descriptionDraft)
      || previewDescription?.summary
      || tApp('tagFeedsPreviewSummaryHint'),
    [descriptionDraft, previewDescription?.summary],
  )
  const previewAvatar = useMemo(() => getSafeMediaPreview(avatarDraft), [avatarDraft])
  const previewBanner = useMemo(() => getSafeMediaPreview(bannerDraft), [bannerDraft])
  const selectedProfileSet = useMemo(
    () => new Set(profilePubkeysDraft),
    [profilePubkeysDraft],
  )

  const suggestedProfiles = useMemo(() => {
    const source = profileSearchQuery.trim().length > 0 ? profileSearchResults : popularProfiles
    return dedupeProfiles(source)
      .filter((profile) => !selectedProfileSet.has(profile.pubkey))
      .slice(0, PROFILE_SUGGESTION_LIMIT)
  }, [popularProfiles, profileSearchQuery, profileSearchResults, selectedProfileSet])

  function clearFormError(): void {
    if (formError) setFormError(null)
  }

  function resetForm(): void {
    setEditingId(null)
    setTitleDraft('')
    setDescriptionDraft('')
    setAvatarDraft('')
    setBannerDraft('')
    setIncludeDraft('')
    setExcludeDraft('')
    setModeDraft('any')
    setProfilePubkeysDraft([])
    setProfileSearchQuery('')
    setProfileSearchResults([])
    setProfileSearchLoading(false)
    setFormError(null)
  }

  function handleEdit(feed: SavedTagFeed): void {
    setEditingId(feed.id)
    setTitleDraft(feed.title)
    setDescriptionDraft(feed.description)
    setAvatarDraft(feed.avatar)
    setBannerDraft(feed.banner)
    setIncludeDraft(formatTagInput(feed.includeTags))
    setExcludeDraft(formatTagInput(feed.excludeTags))
    setModeDraft(feed.mode)
    setProfilePubkeysDraft(feed.profilePubkeys)
    setProfileSearchQuery('')
    setProfileSearchResults([])
    setProfileSearchLoading(false)
    setFormError(null)
    window.scrollTo({ top: 0 })
  }

  function handleDelete(feed: SavedTagFeed): void {
    if (!window.confirm(tApp('tagFeedsDeleteConfirm', { title: feed.title }))) return
    deleteTagFeed(feed.id, scopeId)

    if (editingId === feed.id) {
      resetForm()
    }
  }

  function handleToggleProfile(pubkey: string): void {
    setProfilePubkeysDraft((current) => (
      current.includes(pubkey)
        ? current.filter((entry) => entry !== pubkey)
        : [...current, pubkey]
    ))
    clearFormError()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    const includeTags = normalizeTagTimelineTags(includeDraft)
    if (includeTags.length === 0) {
      setFormError(tApp('tagFeedsErrorNoTopics'))
      return
    }

    if (avatarDraft.trim().length > 0 && !isSafeMediaURL(avatarDraft.trim())) {
      setFormError(tApp('tagFeedsErrorAvatarUrl'))
      return
    }

    if (bannerDraft.trim().length > 0 && !isSafeMediaURL(bannerDraft.trim())) {
      setFormError(tApp('tagFeedsErrorBannerUrl'))
      return
    }

    const saved = saveTagFeed({
      id: editingId ?? undefined,
      title: titleDraft,
      description: descriptionDraft,
      avatar: avatarDraft,
      banner: bannerDraft,
      profilePubkeys: profilePubkeysDraft,
      includeTags,
      excludeTags: normalizeTagTimelineTags(excludeDraft).filter((tag) => !includeTags.includes(tag)),
      mode: includeTags.length > 1 && modeDraft === 'all' ? 'all' : 'any',
    }, scopeId)

    if (!saved) {
      setFormError(tApp('tagFeedsErrorSave'))
      return
    }

    resetForm()
  }

  useEffect(() => {
    const query = profileSearchQuery.trim()

    if (!query) {
      setProfileSearchResults([])
      setProfileSearchLoading(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setProfileSearchLoading(true)
      searchProfiles(query, 16)
        .then((profiles) => {
          if (cancelled) return
          setProfileSearchResults(profiles)
          setProfileSearchLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setProfileSearchResults([])
          setProfileSearchLoading(false)
        })
    }, PROFILE_SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [profileSearchQuery])

  useEffect(() => {
    if (!editingId) return
    if (savedFeeds.some((feed) => feed.id === editingId)) return
    resetForm()
  }, [editingId, savedFeeds])

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="
              app-panel-muted
              h-10 w-10 rounded-full
              text-[rgb(var(--color-label))]
              flex items-center justify-center
              active:opacity-80
            "
            aria-label={tApp('tagFeedsGoBack')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M9.5 3.25L4.75 8l4.75 4.75"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-tertiary))]">
              {tApp('tagFeedsBreadcrumb')}
            </p>
            <h1 className="text-[20px] font-semibold text-[rgb(var(--color-label))]">
              {tApp('tagFeedsTitle')}
            </h1>
          </div>
        </div>
      </div>

      <div className="space-y-8 pb-10 pt-2">
        <section>
          <h2 className="section-kicker px-1 mb-3">{editingId ? tApp('tagFeedsEditSection') : tApp('tagFeedsCreateSection')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {tApp('tagFeedsFormIntro')}
            </p>

            <form className="mt-4 space-y-6" onSubmit={handleSubmit}>
              <div className="overflow-hidden rounded-[26px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))]">
                <div className="relative h-36 overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(var(--color-accent),0.18),_transparent_55%),linear-gradient(180deg,_rgba(var(--color-fill),0.14),_rgba(var(--color-fill),0.05))]">
                  {previewBanner && (
                    <img
                      src={previewBanner}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  )}
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,0.22))]" />
                </div>

                <div className="relative px-4 pb-4">
                  <div className="-mt-10 flex items-end justify-between gap-3">
                    <FeedAvatar
                      src={previewAvatar}
                      title={previewTitle}
                      size={80}
                      className="ring-4 ring-[rgb(var(--color-bg))]"
                    />
                    <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
                      {editingId ? tApp('tagFeedsBadgeEditing') : tApp('tagFeedsBadgeNew')}
                    </span>
                  </div>

                  <div className="mt-3">
                    <p className="section-kicker">{tApp('tagFeedsPreviewSection')}</p>
                    <h3 className="mt-1 text-[24px] font-semibold leading-tight tracking-[-0.03em] text-[rgb(var(--color-label))]">
                      <TwemojiText text={previewTitle} />
                    </h3>
                    <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                      {previewSummary}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]">
                      {getTopicChip(previewSpec?.includeTags.length ?? 0)}
                    </span>
                    <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]">
                      {getProfileChip(profilePubkeysDraft.length)}
                    </span>
                    <span className="rounded-full bg-[rgb(var(--color-accent)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]">
                      {modeDraft === 'all' ? tApp('tagFeedsModeAll') : tApp('tagFeedsModeAny')}
                    </span>
                  </div>

                  {(previewSpec?.includeTags.length || previewSpec?.excludeTags.length) ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {previewSpec?.includeTags.map((tag) => (
                        <span
                          key={`preview-include:${tag}`}
                          className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]"
                        >
                          {formatTagChip(tag)}
                        </span>
                      ))}
                      {previewSpec?.excludeTags.map((tag) => (
                        <span
                          key={`preview-exclude:${tag}`}
                          className="rounded-full bg-[rgb(var(--color-accent)/0.08)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))]"
                        >
                          {formatTagChip(tag, true)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <section className="space-y-4">
                <div>
                  <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">{tApp('tagFeedsIdentitySection')}</p>
                  <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                    {tApp('tagFeedsIdentityHint')}
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]" htmlFor="tag-feed-title">
                    {tApp('tagFeedsFeedNameLabel')}
                  </label>
                  <input
                    id="tag-feed-title"
                    type="text"
                    value={titleDraft}
                    onChange={(event) => {
                      setTitleDraft(event.target.value)
                      clearFormError()
                    }}
                    placeholder={tApp('tagFeedsFeedNamePlaceholder')}
                    className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]" htmlFor="tag-feed-description">
                    {tApp('tagFeedsDescriptionLabel')}
                  </label>
                  <textarea
                    id="tag-feed-description"
                    value={descriptionDraft}
                    onChange={(event) => {
                      setDescriptionDraft(event.target.value)
                      clearFormError()
                    }}
                    rows={3}
                    placeholder={tApp('tagFeedsDescriptionPlaceholder')}
                    className="w-full resize-y rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]" htmlFor="tag-feed-avatar">
                      {tApp('tagFeedsAvatarUrlLabel')}
                    </label>
                    <input
                      id="tag-feed-avatar"
                      type="url"
                      value={avatarDraft}
                      onChange={(event) => {
                        setAvatarDraft(event.target.value)
                        clearFormError()
                      }}
                      placeholder={tApp('tagFeedsAvatarUrlPlaceholder')}
                      className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]" htmlFor="tag-feed-banner">
                      {tApp('tagFeedsBannerUrlLabel')}
                    </label>
                    <input
                      id="tag-feed-banner"
                      type="url"
                      value={bannerDraft}
                      onChange={(event) => {
                        setBannerDraft(event.target.value)
                        clearFormError()
                      }}
                      placeholder={tApp('tagFeedsBannerUrlPlaceholder')}
                      className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div>
                  <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">{tApp('tagFeedsTopicsSection')}</p>
                  <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                    {tApp('tagFeedsTopicsHint')}
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]" htmlFor="tag-feed-include">
                    {tApp('tagFeedsIncludeLabel')}
                  </label>
                  <input
                    id="tag-feed-include"
                    type="text"
                    value={includeDraft}
                    onChange={(event) => {
                      setIncludeDraft(event.target.value)
                      clearFormError()
                    }}
                    placeholder={tApp('tagFeedsIncludePlaceholder')}
                    className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]" htmlFor="tag-feed-exclude">
                    {tApp('tagFeedsExcludeLabel')}
                  </label>
                  <input
                    id="tag-feed-exclude"
                    type="text"
                    value={excludeDraft}
                    onChange={(event) => {
                      setExcludeDraft(event.target.value)
                      clearFormError()
                    }}
                    placeholder={tApp('tagFeedsExcludePlaceholder')}
                    className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
                  />
                </div>

                <div>
                  <span className="mb-2 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
                    {tApp('tagFeedsMatchLogicLabel')}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {(['any', 'all'] as const).map((mode) => {
                      const includeCount = previewSpec?.includeTags.length ?? 0
                      const disabled = mode === 'all' && includeCount < 2
                      const selected = modeDraft === mode

                      return (
                        <button
                          key={mode}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setModeDraft(mode)
                            clearFormError()
                          }}
                          className={`
                            rounded-full px-4 py-2 text-[13px] font-medium transition-colors
                            ${selected
                              ? 'bg-[rgb(var(--color-label))] text-[rgb(var(--color-bg))]'
                              : 'bg-[rgb(var(--color-fill)/0.08)] text-[rgb(var(--color-label-secondary))]'}
                            ${disabled ? 'cursor-not-allowed opacity-60' : ''}
                          `}
                        >
                          {mode === 'any' ? tApp('tagFeedsModeAny') : tApp('tagFeedsModeAll')}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {previewDescription && (
                  <div className="rounded-[16px] bg-[rgb(var(--color-bg-secondary))] p-3">
                    <p className="text-[13px] font-medium text-[rgb(var(--color-label))]">
                      {tApp('tagFeedsFeedLogic')}
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                      {previewDescription.summary}
                    </p>
                  </div>
                )}
              </section>

              <section className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                  <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">{tApp('tagFeedsProfilesSuggestSection')}</p>
                  <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                    {tApp('tagFeedsProfilesSuggestHint')}
                    </p>
                  </div>
                  <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
                    {profilePubkeysDraft.length}
                  </span>
                </div>

                {profilePubkeysDraft.length === 0 ? (
                  <div className="rounded-[18px] border border-dashed border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-4 py-5 text-center">
                    <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
                      {tApp('tagFeedsNoProfilesTitle')}
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                      {tApp('tagFeedsNoProfilesHint')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {profilePubkeysDraft.map((pubkey) => (
                      <FeedProfileItem
                        key={`selected:${pubkey}`}
                        pubkey={pubkey}
                        actionLabel={tApp('tagFeedsRemove')}
                        actionVariant="remove"
                        onAction={() => handleToggleProfile(pubkey)}
                      />
                    ))}
                  </div>
                )}

                <div>
                  <SearchBar
                    value={profileSearchQuery}
                    onChange={(value) => {
                      setProfileSearchQuery(value)
                      clearFormError()
                    }}
                    onClear={() => setProfileSearchQuery('')}
                    placeholder={tApp('tagFeedsSearchPlaceholder')}
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
                      {profileSearchQuery.trim().length > 0 ? tApp('tagFeedsSearchResultsLabel') : tApp('tagFeedsSuggestedProfilesLabel')}
                    </p>
                    <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
                      {profileSearchLoading
                          ? tApp('tagFeedsSearching')
                          : profileSearchQuery.trim().length === 0 && popularProfilesLoading
                            ? tApp('tagFeedsLoadingSuggestions')
                          : ''}
                    </p>
                  </div>

                  {suggestedProfiles.length > 0 ? (
                    <div className="space-y-2">
                      {suggestedProfiles.map((profile) => (
                        <FeedProfileItem
                          key={`suggested:${profile.pubkey}`}
                          pubkey={profile.pubkey}
                          profile={profile}
                          actionLabel={tApp('tagFeedsAdd')}
                          onAction={() => handleToggleProfile(profile.pubkey)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[18px] border border-[rgb(var(--color-fill)/0.1)] bg-[rgb(var(--color-bg))] px-4 py-5 text-center">
                      <p className="text-[14px] font-medium text-[rgb(var(--color-label))]">
                        {profileSearchQuery.trim().length > 0 ? tApp('tagFeedsNoResultsTitle') : tApp('tagFeedsSuggestionsTitle')}
                      </p>
                      <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                        {profileSearchQuery.trim().length > 0
                          ? tApp('tagFeedsNoResultsHint')
                          : tApp('tagFeedsSuggestionsHint')}
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {formError && (
                <p className="text-[13px] text-[rgb(var(--color-system-red))]">
                  {formError}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="rounded-[14px] bg-[rgb(var(--color-label))] px-4 py-3 text-[15px] font-medium text-[rgb(var(--color-bg))] transition-opacity active:opacity-80"
                >
                  {editingId ? tApp('tagFeedsSubmitSave') : tApp('tagFeedsSubmitCreate')}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-[14px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] font-medium text-[rgb(var(--color-label))] transition-opacity active:opacity-80"
                >
                  {editingId ? tApp('tagFeedsCancelEditing') : tApp('tagFeedsClear')}
                </button>
              </div>
            </form>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <h2 className="section-kicker">{tApp('tagFeedsSavedSection')}</h2>
            <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
              {savedFeeds.length}
            </span>
          </div>

          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            {savedFeeds.length === 0 ? (
              <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                {tApp('tagFeedsNoSaved')}
              </p>
            ) : (
              <div className="space-y-4">
                {savedFeeds.map((feed) => (
                  <SavedTagFeedCard
                    key={feed.id}
                    feed={feed}
                    onOpen={() => navigate(buildTagTimelineHref(feed))}
                    onEdit={() => handleEdit(feed)}
                    onDelete={() => handleDelete(feed)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
