import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ReportSheet } from '@/components/nostr/ReportSheet'
import { UserStatusBody } from '@/components/nostr/UserStatusBody'
import { NoteContent } from '@/components/cards/NoteContent'
import { ProfileMetadataEditor } from '@/components/profile/ProfileMetadataEditor'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { ImageLightbox } from '@/components/ui/ImageLightbox'
import { useApp } from '@/contexts/app-context'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { useMediaModerationDocuments } from '@/hooks/useMediaModeration'
import { useProfileModeration } from '@/hooks/useModeration'
import { useMuteList } from '@/hooks/useMuteList'
import { usePageHead } from '@/hooks/usePageHead'
import { useProfile } from '@/hooks/useProfile'
import { useLivePresence } from '@/hooks/useLivePresence'
import { useUserStatus } from '@/hooks/useUserStatus'
import { buildProfileInsightFallback, extractHashtagsFromContents } from '@/lib/ai/insights'
import { generateAssistText, type AiAssistProvider, type AiAssistSource } from '@/lib/ai/gemmaAssist'
import { AI_ASSIST_PROVIDER_UPDATED_EVENT, getAiAssistProvider, setAiAssistProvider } from '@/lib/ai/provider'
import { queryEvents } from '@/lib/db/nostr'
import { buildMediaModerationDocument } from '@/lib/moderation/mediaContent'
import { buildProfileMetaTags, buildProfileTitle } from '@/lib/nostr/meta'
import {
  getFreshContactList,
  saveCurrentUserContactEntry,
  unfollowCurrentUserContact,
} from '@/lib/nostr/contacts'
import {
  getFreshProfileBadges,
  pickBadgeAsset,
  type DisplayedProfileBadge,
} from '@/lib/nostr/badges'
import {
  getFreshHandlerInformationEvents,
  getFreshHandlerRecommendationEvents,
  getHandlerDisplayName,
  getHandlerRecommendationSummary,
  getHandlerSummary,
  type ParsedHandlerInformationEvent,
  type ParsedHandlerRecommendationEvent,
} from '@/lib/nostr/appHandlers'
import {
  getFreshNip51ListEvents,
  getNip51ListLabel,
  type ParsedNip51ListEvent,
} from '@/lib/nostr/lists'
import { decodeProfileReference } from '@/lib/nostr/nip21'
import { formatNip05Identifier, parseNip05Identifier, resolveNip05Identifier } from '@/lib/nostr/nip05'
import { getIdentityUrl, getPlatformDisplayName } from '@/lib/nostr/nip39'
import { tApp } from '@/lib/i18n/app'
import type { ContactList, Profile, ProfileBirthday } from '@/types'
import { Kind } from '@/types'

const PROFILE_INSIGHT_KINDS = [
  Kind.ShortNote,
  Kind.Thread,
  Kind.Poll,
  Kind.LongFormContent,
  Kind.Video,
  Kind.ShortVideo,
  Kind.AddressableVideo,
  Kind.AddressableShortVideo,
] as const

interface ExpandedProfileImage {
  url: string
  alt: string
  title: string
}

const failedBannerUrls = new Map<string, number>()
const FAILED_BANNER_RETRY_MS = 60_000

function hasRecentBannerFailure(url: string | null | undefined): boolean {
  if (!url) return false
  const failedAt = failedBannerUrls.get(url)
  if (!failedAt) return false
  if (Date.now() - failedAt <= FAILED_BANNER_RETRY_MS) return true
  failedBannerUrls.delete(url)
  return false
}

function getNip51SetSummary(event: ParsedNip51ListEvent): string {
  if (event.description) return event.description

  const itemCount = event.publicItems.length
  if (event.kind === Kind.StarterPack) {
    return `${itemCount} profile${itemCount === 1 ? '' : 's'} to follow together.`
  }
  if (event.kind === Kind.MediaStarterPack) {
    return `${itemCount} media-focused profile${itemCount === 1 ? '' : 's'} to follow together.`
  }

  return `${itemCount} public item${itemCount === 1 ? '' : 's'}${event.hasPrivateItems ? ' + encrypted private items' : ''}.`
}

function truncateProfileText(value: string, maxChars: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}…`
}

function getProfileBannerGradient(pubkey: string): string {
  const hueA = parseInt(pubkey.slice(0, 6), 16) % 360
  const hueB = (parseInt(pubkey.slice(6, 12), 16) % 360 + 48) % 360
  const hueC = (parseInt(pubkey.slice(12, 18), 16) % 360 + 96) % 360
  return `linear-gradient(135deg, hsl(${hueA} 72% 48%), hsl(${hueB} 64% 38%), hsl(${hueC} 58% 24%))`
}

function getProfileBannerSubtitle(options: {
  about?: string | null
  nip05?: string | null
  nip05Verified?: boolean | undefined
}): string {
  if (options.about?.trim()) return truncateProfileText(options.about, 120)
  if (options.nip05 && options.nip05Verified) return formatNip05Identifier(options.nip05)
  return 'No banner published'
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getLivePresenceKindLabel(kind: number): string {
  if (kind === Kind.LiveActivity) return 'Live Activity'
  if (kind === Kind.MeetingSpace) return 'Meeting Space'
  if (kind === Kind.MeetingRoom) return 'Meeting Room'
  return `Kind ${kind}`
}

function getLivePresenceStatusLabel(status: 'live' | 'planned' | 'ended' | 'unknown'): string {
  if (status === 'live') return 'Live'
  if (status === 'planned') return 'Planned'
  if (status === 'ended') return 'Ended'
  return 'Status unknown'
}

function formatBirthday(
  birthday: ProfileBirthday | undefined,
): string | null {
  if (!birthday) return null

  const year = birthday.year
  const month = birthday.month
  const day = birthday.day

  if (month && day) {
    const date = new Date(Date.UTC(year ?? 2000, month - 1, day))
    const monthDay = date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
    return year ? `${monthDay}, ${year}` : monthDay
  }

  if (month) {
    const date = new Date(Date.UTC(year ?? 2000, month - 1, 1))
    const monthLabel = date.toLocaleDateString(undefined, {
      month: 'short',
      timeZone: 'UTC',
    })
    return year ? `${monthLabel} ${year}` : monthLabel
  }

  if (year) return String(year)
  if (day) return `Day ${day}`
  return null
}

function ProfileBanner({
  bannerUrl,
  profileLabel,
  subtitle,
  pubkey,
  onOpen,
}: {
  bannerUrl?: string | null
  profileLabel: string
  subtitle: string
  pubkey: string
  onOpen: () => void
}) {
  const [bannerFailed, setBannerFailed] = useState(() => hasRecentBannerFailure(bannerUrl))

  useEffect(() => {
    setBannerFailed(hasRecentBannerFailure(bannerUrl))
  }, [bannerUrl])

  const showImage = Boolean(bannerUrl && !bannerFailed)
  const content = (
    <>
      {showImage ? (
        <img
          src={bannerUrl ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-40 w-full object-cover"
          onError={() => {
            if (bannerUrl) failedBannerUrls.set(bannerUrl, Date.now())
            setBannerFailed(true)
          }}
        />
      ) : (
        <div
          className="h-40 w-full"
          style={{
            backgroundImage: getProfileBannerGradient(pubkey),
            backgroundColor: 'rgb(var(--color-fill))',
          }}
        />
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
        <p className="text-[18px] font-semibold tracking-[-0.02em] text-white">
          <TwemojiText text={profileLabel} />
        </p>
        <p className="mt-1 max-w-[34rem] text-[13px] leading-6 text-white/80">
          <TwemojiText text={subtitle} />
        </p>
      </div>
    </>
  )

  if (showImage) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="relative mb-4 block w-full overflow-hidden rounded-[20px] text-left transition-transform active:scale-[0.995]"
        aria-label={`Open ${profileLabel} banner`}
      >
        {content}
      </button>
    )
  }

  return (
    <div className="relative mb-4 overflow-hidden rounded-[20px]">
      {content}
    </div>
  )
}

function ProfileStatBadge({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] px-3 py-3">
      <p className="text-[18px] font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
        {value}
      </p>
      <p className="mt-1 text-[12px] uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        {label}
      </p>
    </div>
  )
}

function ProfileFactCard({
  label,
  value,
  href,
  monospace = false,
}: {
  label: string
  value: string
  href?: string
  monospace?: boolean
}) {
  const content = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={`mt-1 block break-all text-[14px] text-[#007AFF] ${monospace ? 'font-mono' : ''}`}
    >
      {value}
    </a>
  ) : (
    <p className={`mt-1 break-all text-[14px] text-[rgb(var(--color-label))] ${monospace ? 'font-mono' : ''}`}>
      {value}
    </p>
  )

  return (
    <div className="rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] px-3 py-3">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        {label}
      </p>
      {content}
    </div>
  )
}

function ExpandableSectionCard({
  eyebrow,
  title,
  description,
  countLabel,
  defaultOpen = false,
  children,
  id,
}: {
  eyebrow: string
  title: string
  description?: string | undefined
  countLabel?: string | undefined
  defaultOpen?: boolean | undefined
  children: ReactNode
  id?: string | undefined
}) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (defaultOpen) {
      setOpen(true)
    }
  }, [defaultOpen])

  return (
    <details
      id={id}
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="group rounded-[20px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] p-4"
    >
      <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
              {eyebrow}
            </p>
            <p className="mt-1 text-[18px] font-semibold tracking-[-0.02em] text-[rgb(var(--color-label))]">
              {title}
            </p>
            {description && (
              <p className="mt-1 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                {description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {countLabel && (
              <span className="shrink-0 rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[12px] text-[rgb(var(--color-label-secondary))]">
                {countLabel}
              </span>
            )}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--color-fill)/0.08)] text-[rgb(var(--color-label-secondary))] transition-transform group-open:rotate-180">
              <svg width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden="true">
                <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      </summary>

      <div className="mt-4">
        {children}
      </div>
    </details>
  )
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const { currentUser, logout } = useApp()
  const { pubkey: routePubkey } = useParams<{ pubkey: string }>()
  const routeIdentity = routePubkey?.trim() ?? null
  const [resolvedRoutePubkey, setResolvedRoutePubkey] = useState<string | null>(null)
  const [routeIdentityResolving, setRouteIdentityResolving] = useState(false)
  const [routeIdentityError, setRouteIdentityError] = useState<string | null>(null)

  useEffect(() => {
    if (!routeIdentity) {
      setResolvedRoutePubkey(null)
      setRouteIdentityResolving(false)
      setRouteIdentityError(null)
      return
    }

    const decoded = decodeProfileReference(routeIdentity)?.pubkey ?? null
    if (decoded) {
      setResolvedRoutePubkey(decoded)
      setRouteIdentityResolving(false)
      setRouteIdentityError(null)
      return
    }

    if (!parseNip05Identifier(routeIdentity)) {
      setResolvedRoutePubkey(null)
      setRouteIdentityResolving(false)
      setRouteIdentityError('Invalid profile identifier in the route.')
      return
    }

    const controller = new AbortController()
    setResolvedRoutePubkey(null)
    setRouteIdentityResolving(true)
    setRouteIdentityError(null)

    resolveNip05Identifier(routeIdentity, controller.signal)
      .then((resolved) => {
        if (controller.signal.aborted) return
        if (!resolved) {
          setRouteIdentityError('Could not resolve that NIP-05 identifier.')
          setRouteIdentityResolving(false)
          return
        }

        setResolvedRoutePubkey(resolved.pubkey)
        setRouteIdentityResolving(false)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setRouteIdentityError(error instanceof Error ? error.message : 'Could not resolve that NIP-05 identifier.')
        setRouteIdentityResolving(false)
      })

    return () => controller.abort()
  }, [routeIdentity])

  const pubkey = useMemo(() => {
    if (routeIdentity) return resolvedRoutePubkey
    return currentUser?.pubkey ?? null
  }, [routeIdentity, resolvedRoutePubkey, currentUser])

  // No route pubkey + no logged-in user → send to onboarding
  useEffect(() => {
    if (!routeIdentity && !currentUser) {
      navigate('/onboard', { replace: true })
    }
  }, [routeIdentity, currentUser, navigate])

  const [, startTransition] = useTransition()
  
  // Critical data: load immediately
  const { profile, loading: profileLoading, error: profileError } = useProfile(pubkey)
  const {
    blocked: profileTextBlocked,
    loading: profileModerationLoading,
    decision: profileModerationDecision,
  } = useProfileModeration(profile)
  const { status: musicStatus, loading: musicStatusLoading } = useUserStatus(pubkey, {
    identifier: 'music',
    background: true,
  })
  const { presence: livePresence, loading: livePresenceLoading } = useLivePresence(pubkey, {
    background: true,
  })

  const [contactList, setContactList] = useState<ContactList | null>(null)
  const [contactListLoading, setContactListLoading] = useState(false)
  const [badges, setBadges] = useState<DisplayedProfileBadge[]>([])
  const [badgesLoading, setBadgesLoading] = useState(false)
  const [handlerInfoEvents, setHandlerInfoEvents] = useState<ParsedHandlerInformationEvent[]>([])
  const [handlerInfoLoading, setHandlerInfoLoading] = useState(false)
  const [handlerRecommendations, setHandlerRecommendations] = useState<ParsedHandlerRecommendationEvent[]>([])
  const [handlerRecommendationsLoading, setHandlerRecommendationsLoading] = useState(false)
  const [followSets, setFollowSets] = useState<ParsedNip51ListEvent[]>([])
  const [starterPacks, setStarterPacks] = useState<ParsedNip51ListEvent[]>([])
  const [mediaStarterPacks, setMediaStarterPacks] = useState<ParsedNip51ListEvent[]>([])
  const [articleCurations, setArticleCurations] = useState<ParsedNip51ListEvent[]>([])
  const [appCurations, setAppCurations] = useState<ParsedNip51ListEvent[]>([])
  const [nip51SetsLoading, setNip51SetsLoading] = useState(false)
  const [viewerContacts, setViewerContacts] = useState<ContactList | null>(null)
  const [viewerContactsLoading, setViewerContactsLoading] = useState(false)
  const [petname, setPetname] = useState('')
  const [relayUrl, setRelayUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [reportSheetOpen, setReportSheetOpen] = useState(false)
  const [reported, setReported] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [muting, setMuting] = useState(false)
  const [expandedImage, setExpandedImage] = useState<ExpandedProfileImage | null>(null)
  const [recentProfilePosts, setRecentProfilePosts] = useState<string[]>([])
  const [profileInsights, setProfileInsights] = useState<string[]>([])
  const [profileInsightsLoading, setProfileInsightsLoading] = useState(false)
  const [profileInsightsSource, setProfileInsightsSource] = useState<AiAssistSource | 'fallback'>('fallback')
  const [aiAssistProvider, setAiAssistProviderState] = useState<AiAssistProvider>(() => getAiAssistProvider())
  const profileBlockedByTagr = profileTextBlocked && (profileModerationDecision?.reason?.startsWith('tagr:') ?? false)
  const displayProfile = useMemo<Profile | null>(() => {
    if (!profile || !profileTextBlocked) return profile
    const redactedProfile: Profile = { ...profile }
    delete redactedProfile.about
    delete redactedProfile.name
    delete redactedProfile.display_name
    return redactedProfile
  }, [profile, profileTextBlocked])
  const profileMediaDocuments = useMemo(
    () => (profile ? [
      buildMediaModerationDocument({
        id: `${profile.pubkey}:avatar`,
        kind: 'profile_avatar',
        url: profile.picture ?? null,
        updatedAt: profile.updatedAt,
      }),
      buildMediaModerationDocument({
        id: `${profile.pubkey}:banner`,
        kind: 'profile_banner',
        url: profile.banner ?? null,
        updatedAt: profile.updatedAt,
      }),
    ].filter((document): document is NonNullable<ReturnType<typeof buildMediaModerationDocument>> => document !== null) : []),
    [profile],
  )
  const {
    blockedIds: blockedProfileMediaIds,
  } = useMediaModerationDocuments(profileMediaDocuments)
  const blockedAvatar = profile ? blockedProfileMediaIds.has(`${profile.pubkey}:avatar`) : false
  const blockedBanner = profile ? blockedProfileMediaIds.has(`${profile.pubkey}:banner`) : false
  const renderProfile = useMemo<Profile | null>(() => {
    if (!displayProfile) return displayProfile

    const restProfile: Profile = { ...displayProfile }
    delete restProfile.picture
    delete restProfile.banner

    return {
      ...restProfile,
      ...(displayProfile.picture && !blockedAvatar
        ? { picture: displayProfile.picture }
        : {}),
      ...(displayProfile.banner && !blockedBanner
        ? { banner: displayProfile.banner }
        : {}),
    }
  }, [blockedAvatar, blockedBanner, displayProfile])
  const headProfile = profileModerationLoading ? null : displayProfile

  usePageHead(
    pubkey
      ? {
          title: buildProfileTitle(headProfile),
          tags: buildProfileMetaTags({ profile: headProfile, pubkey }),
        }
      : {},
  )

  const { isMuted, mute, unmute, loading: muteListLoading } = useMuteList()
  const isMutedProfile = pubkey ? isMuted(pubkey) : false

  const handleMuteToggle = async () => {
    if (!pubkey || muting) return
    setMuting(true)
    setError(null)
    setMessage(null)
    try {
      if (isMutedProfile) {
        await unmute(pubkey)
        setMessage('Profile unmuted.')
      } else {
        await mute(pubkey)
        setMessage('Profile muted. You will no longer see their notes.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update mute list.')
    } finally {
      setMuting(false)
    }
  }

  const handleLogout = useCallback(() => {
    if (logout) {
      logout()
      navigate('/', { replace: true })
    }
  }, [logout, navigate])

  const isSelf = pubkey !== null && currentUser?.pubkey === pubkey
  const currentEntry = useMemo(
    () => viewerContacts?.entries.find(entry => entry.pubkey === pubkey) ?? null,
    [viewerContacts, pubkey],
  )
  const profileLabel = useMemo(
    () => displayProfile?.display_name?.trim() || displayProfile?.name?.trim() || `${pubkey?.slice(0, 8) ?? 'profile'}…`,
    [displayProfile?.display_name, displayProfile?.name, pubkey],
  )
  const profileBannerSubtitle = useMemo(
    () => getProfileBannerSubtitle({
      about: displayProfile?.about ?? null,
      nip05: displayProfile?.nip05 ?? null,
      nip05Verified: displayProfile?.nip05Verified,
    }),
    [displayProfile?.about, displayProfile?.nip05, displayProfile?.nip05Verified],
  )
  const avatarUrl = renderProfile?.picture ?? null
  const birthdayLabel = useMemo(
    () => formatBirthday(renderProfile?.birthday),
    [renderProfile?.birthday],
  )
  const totalCuratedSets = followSets.length + starterPacks.length + mediaStarterPacks.length + articleCurations.length + appCurations.length
  const profileContentHashtags = useMemo(
    () => extractHashtagsFromContents(recentProfilePosts),
    [recentProfilePosts],
  )

  const fallbackProfileInsights = useMemo(
    () => buildProfileInsightFallback({
      displayName: profileLabel,
      about: displayProfile?.about ?? '',
      hashtags: profileContentHashtags,
      recentPosts: recentProfilePosts,
    }),
    [displayProfile?.about, profileContentHashtags, profileLabel, recentProfilePosts],
  )

  useEffect(() => {
    const onProviderUpdated = () => {
      setAiAssistProviderState(getAiAssistProvider())
    }

    window.addEventListener(AI_ASSIST_PROVIDER_UPDATED_EVENT, onProviderUpdated)
    window.addEventListener('storage', onProviderUpdated)

    return () => {
      window.removeEventListener(AI_ASSIST_PROVIDER_UPDATED_EVENT, onProviderUpdated)
      window.removeEventListener('storage', onProviderUpdated)
    }
  }, [])

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  useEffect(() => {
    setPetname(currentEntry?.petname ?? '')
    setRelayUrl(currentEntry?.relayUrl ?? '')
  }, [currentEntry?.petname, currentEntry?.relayUrl, currentEntry?.pubkey])

  useEffect(() => {
    if (!pubkey) {
      setContactList(null)
      return
    }

    const controller = new AbortController()
    setContactListLoading(true)

    getFreshContactList(pubkey, { signal: controller.signal })
      .then((list) => {
        if (controller.signal.aborted) return
        setContactList(list)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setContactList(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setContactListLoading(false)
        }
      })

    return () => controller.abort()
  }, [pubkey])

  useEffect(() => {
    if (!pubkey) {
      setHandlerInfoEvents([])
      return
    }

    const controller = new AbortController()
    setHandlerInfoLoading(true)

    getFreshHandlerInformationEvents(pubkey, controller.signal)
      .then((events) => {
        if (controller.signal.aborted) return
        startTransition(() => {
          setHandlerInfoEvents(events)
        })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        startTransition(() => {
          setHandlerInfoEvents([])
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          startTransition(() => {
            setHandlerInfoLoading(false)
          })
        }
      })

    return () => controller.abort()
  }, [pubkey])

  useEffect(() => {
    if (!pubkey) {
      setHandlerRecommendations([])
      return
    }

    const controller = new AbortController()
    setHandlerRecommendationsLoading(true)

    getFreshHandlerRecommendationEvents(pubkey, controller.signal)
      .then((events) => {
        if (controller.signal.aborted) return
        startTransition(() => {
          setHandlerRecommendations(events)
        })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        startTransition(() => {
          setHandlerRecommendations([])
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          startTransition(() => {
            setHandlerRecommendationsLoading(false)
          })
        }
      })

    return () => controller.abort()
  }, [pubkey])

  useEffect(() => {
    if (!pubkey) {
      setBadges([])
      return
    }

    const controller = new AbortController()
    setBadgesLoading(true)

    getFreshProfileBadges(pubkey, controller.signal)
      .then((nextBadges) => {
        if (controller.signal.aborted) return
        startTransition(() => {
          setBadges(nextBadges)
        })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        startTransition(() => {
          setBadges([])
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          startTransition(() => {
            setBadgesLoading(false)
          })
        }
      })

    return () => controller.abort()
  }, [pubkey])

  useEffect(() => {
    if (!pubkey) {
      setFollowSets([])
      setStarterPacks([])
      setMediaStarterPacks([])
      setArticleCurations([])
      setAppCurations([])
      return
    }

    const controller = new AbortController()
    setNip51SetsLoading(true)

    Promise.all([
      getFreshNip51ListEvents(pubkey, Kind.FollowSet, { signal: controller.signal }),
      getFreshNip51ListEvents(pubkey, Kind.StarterPack, { signal: controller.signal }),
      getFreshNip51ListEvents(pubkey, Kind.MediaStarterPack, { signal: controller.signal }),
      getFreshNip51ListEvents(pubkey, Kind.ArticleCurationSet, { signal: controller.signal }),
      getFreshNip51ListEvents(pubkey, Kind.AppCurationSet, { signal: controller.signal }),
    ])
      .then(([
        nextFollowSets,
        nextStarterPacks,
        nextMediaStarterPacks,
        nextArticleCurations,
        nextAppCurations,
      ]) => {
        if (controller.signal.aborted) return
        startTransition(() => {
          setFollowSets(nextFollowSets)
          setStarterPacks(nextStarterPacks)
          setMediaStarterPacks(nextMediaStarterPacks)
          setArticleCurations(nextArticleCurations)
          setAppCurations(nextAppCurations)
        })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        startTransition(() => {
          setFollowSets([])
          setStarterPacks([])
          setMediaStarterPacks([])
          setArticleCurations([])
          setAppCurations([])
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          startTransition(() => {
            setNip51SetsLoading(false)
          })
        }
      })

    return () => controller.abort()
  }, [pubkey])

  useEffect(() => {
    if (!currentUser?.pubkey || !pubkey || currentUser.pubkey === pubkey) {
      setViewerContacts(null)
      return
    }

    const controller = new AbortController()
    setViewerContactsLoading(true)

    getFreshContactList(currentUser.pubkey, { signal: controller.signal })
      .then((list) => {
        if (controller.signal.aborted) return
        setViewerContacts(list)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setViewerContacts(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setViewerContactsLoading(false)
        }
      })

    return () => controller.abort()
  }, [currentUser?.pubkey, pubkey])

  useEffect(() => {
    if (!pubkey) {
      setRecentProfilePosts([])
      return
    }

    const controller = new AbortController()

    queryEvents({
      authors: [pubkey],
      kinds: [...PROFILE_INSIGHT_KINDS],
      limit: 48,
    })
      .then((events) => {
        if (controller.signal.aborted) return
        const posts = events
          .sort((a, b) => b.created_at - a.created_at)
          .map((event) => event.content.trim())
          .filter((content) => content.length > 0)
          .slice(0, 24)
        setRecentProfilePosts(posts)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setRecentProfilePosts([])
      })

    return () => controller.abort()
  }, [pubkey])

  useEffect(() => {
    setProfileInsights(fallbackProfileInsights)
    setProfileInsightsSource('fallback')

    if (!pubkey || !displayProfile) {
      setProfileInsightsLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setProfileInsightsLoading(true)

      const prompt = [
        'You are generating profile insights for a social client.',
        'Write 3 informative sentences about this profile.',
        'Cover: (1) their main topics and writing style, (2) audience fit or community they belong to, (3) one actionable suggestion for engaging with them.',
        'Plain text only, no markdown, no bullet points.',
        'Each sentence must be self-contained and add distinct value.',
        `Profile label: ${JSON.stringify(profileLabel)}`,
        `Bio: ${JSON.stringify(displayProfile.about ?? '')}`,
        `Hashtags: ${JSON.stringify(profileContentHashtags.slice(0, 12))}`,
        `Recent posts: ${JSON.stringify(recentProfilePosts.slice(0, 8))}`,
      ].join('\n')

      generateAssistText(prompt, {
        signal: controller.signal,
        provider: aiAssistProvider,
      })
        .then((result) => {
          if (controller.signal.aborted) return
          const lines = result.text
            .split(/\n+/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, 3)

          if (lines.length > 0) {
            setProfileInsights(lines)
            setProfileInsightsSource(result.source)
          }

          setProfileInsightsLoading(false)
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setProfileInsights(fallbackProfileInsights)
          setProfileInsightsSource('fallback')
          setProfileInsightsLoading(false)
        })
    }, 600)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [
    displayProfile,
    fallbackProfileInsights,
    profileContentHashtags,
    profileLabel,
    pubkey,
    recentProfilePosts,
    aiAssistProvider,
  ])

  const handleSave = async () => {
    if (!pubkey) return

    setSaving(true)
    setError(null)
    setMessage(null)

    try {
      const next = await saveCurrentUserContactEntry(pubkey, {
        petname,
        relayUrl,
      })
      setViewerContacts(next)
      setMessage(currentEntry ? 'Kind-3 contact entry updated and published.' : 'Follow published to relays.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to publish kind-3 contact list.')
    } finally {
      setSaving(false)
    }
  }

  const handleUnfollow = async () => {
    if (!pubkey) return

    setSaving(true)
    setError(null)
    setMessage(null)

    try {
      const next = await unfollowCurrentUserContact(pubkey)
      setViewerContacts(next)
      setPetname('')
      setRelayUrl('')
      setMessage('Unfollow published to relays.')
    } catch (unfollowError) {
      setError(unfollowError instanceof Error ? unfollowError.message : 'Failed to publish kind-3 contact list.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))]">
      {/* Sticky navigation bar — matches NotePage / ExpandedNote pattern */}
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
        <div className="px-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-[#007AFF] active:opacity-60"
          >
            <svg width="10" height="16" viewBox="0 0 10 17" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.5 1.5L1.5 8.5L8.5 15.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-[17px]">Back</span>
          </button>
        </div>
      </div>

      {routeIdentity && routeIdentityResolving ? (
        <div className="px-4 py-6">
          <p className="text-[17px] text-[rgb(var(--color-label-secondary))]">
            Resolving profile identity…
          </p>
        </div>
      ) : !pubkey ? (
        <div className="px-4 py-6">
          <p className="text-[17px] text-[rgb(var(--color-label-secondary))]">
            {routeIdentityError ?? 'Invalid pubkey in the profile route.'}
          </p>
        </div>
      ) : isMutedProfile && !isSelf ? (
        <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[rgb(var(--color-fill)/0.08)] text-[32px]">
            🔕
          </div>
          <h2 className="text-[22px] font-semibold text-[rgb(var(--color-label))]">
            {profileLabel} is muted
          </h2>
          <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
            You have muted this account. Their posts and profile details are hidden.
          </p>
          <button
            type="button"
            onClick={() => void handleMuteToggle()}
            disabled={muting || muteListLoading}
            className="mt-6 rounded-[14px] bg-[rgb(var(--color-label))] px-6 py-3 text-[15px] font-medium text-white transition-opacity active:opacity-75 disabled:opacity-40"
          >
            {muting ? tApp('profileUpdating') : tApp('profileUnmute')}
          </button>
        </div>
      ) : (
        <div className="px-4 pb-[max(40px,_env(safe-area-inset-bottom))]">

          <div className="space-y-6 py-4">
            <div className="rounded-[24px] bg-[rgb(var(--color-bg-secondary))] p-4 card-elevated">
              <ProfileBanner
                bannerUrl={renderProfile?.banner ?? null}
                profileLabel={profileLabel}
                subtitle={profileBannerSubtitle}
                pubkey={pubkey}
                onOpen={() => setExpandedImage({
                  url: renderProfile?.banner ?? '',
                  alt: `${profileLabel} banner`,
                  title: `${profileLabel} banner`,
                })}
              />

              <AuthorRow
                pubkey={pubkey}
                profile={renderProfile}
                large
                {...(avatarUrl
                  ? {
                      onAvatarClick: () => setExpandedImage({
                        url: avatarUrl,
                        alt: `${profileLabel} avatar`,
                        title: `${profileLabel} avatar`,
                      }),
                    }
                  : {})}
              />

              <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
                {displayProfile?.nip05 && displayProfile.nip05Verified && (
                  <span className="flex items-center gap-1 rounded-full bg-[rgb(var(--color-system-green)/0.12)] px-2.5 py-1 text-[12px] text-[rgb(var(--color-system-green))]">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" strokeWidth="2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                    {formatNip05Identifier(displayProfile.nip05)}
                  </span>
                )}
                {displayProfile?.bot && (
                  <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[rgb(var(--color-label-secondary))]">
                    {tApp('profileAutomatedAccount')}
                  </span>
                )}
                {musicStatus && (
                  <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[rgb(var(--color-label-secondary))]">
                    {tApp('profileLiveMusicStatus')}
                  </span>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ProfileStatBadge
                  label={tApp('profileFollowing')}
                  value={contactList ? contactList.entries.length : (contactListLoading ? '…' : '0')}
                />
                <ProfileStatBadge
                  label={tApp('profileBadges')}
                  value={badgesLoading && badges.length === 0 ? '…' : badges.length}
                />
                <ProfileStatBadge
                  label={tApp('profileCuratedSets')}
                  value={nip51SetsLoading && totalCuratedSets === 0 ? '…' : totalCuratedSets}
                />
                <ProfileStatBadge
                  label={tApp('profileHandlers')}
                  value={handlerInfoLoading && handlerInfoEvents.length === 0 ? '…' : handlerInfoEvents.length}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {isSelf ? (
                  <>
                    <button
                      type="button"
                      onClick={() => scrollToSection('profile-metadata')}
                      className="rounded-[14px] bg-[rgb(var(--color-label))] px-4 py-2.5 text-[14px] font-medium text-white transition-opacity active:opacity-75"
                    >
                      {tApp('profileEditProfile')}
                    </button>
                    <Link
                      to="/settings"
                      className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-4 py-2.5 text-[14px] font-medium text-[rgb(var(--color-label))]"
                    >
                      {tApp('profileSettings')}
                    </Link>
                    <Link
                      to="/settings#music-status"
                      className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-4 py-2.5 text-[14px] font-medium text-[rgb(var(--color-label))]"
                    >
                      {tApp('profileMusicStatus')}
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="rounded-[14px] border border-[rgb(var(--color-system-red)/0.22)] bg-[rgb(var(--color-system-red)/0.08)] px-4 py-2.5 text-[14px] font-medium text-[rgb(var(--color-system-red))] transition-opacity active:opacity-75"
                    >
                      {tApp('profileLogout')}
                    </button>
                  </>
                ) : (
                  <>
                    {currentUser ? (
                      <button
                        type="button"
                        onClick={() => scrollToSection('profile-entry')}
                        className="rounded-[14px] bg-[rgb(var(--color-label))] px-4 py-2.5 text-[14px] font-medium text-white transition-opacity active:opacity-75"
                      >
                        {currentEntry ? tApp('profileManageFollow') : tApp('profileFollow')}
                      </button>
                    ) : (
                      <span className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-4 py-2.5 text-[14px] text-[rgb(var(--color-label-secondary))]">
                        {tApp('profileConnectSignerFollow')}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleMuteToggle()}
                      disabled={!currentUser || muting || muteListLoading}
                      className="
                        rounded-[14px] border border-[rgb(var(--color-fill)/0.2)]
                        bg-[rgb(var(--color-bg))] px-4 py-2.5
                        text-[14px] font-medium text-[rgb(var(--color-label))]
                        transition-opacity active:opacity-75 disabled:opacity-40
                      "
                    >
                      {muting ? tApp('profileUpdating') : isMutedProfile ? tApp('profileUnmute') : tApp('profileMute')}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        setMessage(null)
                        setReportSheetOpen(true)
                      }}
                      disabled={!currentUser || reported}
                      className="
                        rounded-[14px] border border-[rgb(var(--color-system-red)/0.22)]
                        bg-[rgb(var(--color-system-red)/0.08)] px-4 py-2.5
                        text-[14px] font-medium text-[rgb(var(--color-system-red))]
                        transition-opacity active:opacity-75 disabled:opacity-40
                      "
                    >
                      {reported ? tApp('profileReported') : tApp('profileReport')}
                    </button>
                  </>
                )}
              </div>

              <div className="mt-4 rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] px-3 py-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                  {tApp('profilePubkey')}
                </p>
                <p className="mt-1 break-all font-mono text-[12px] text-[rgb(var(--color-label-tertiary))]">
                  {pubkey}
                </p>
              </div>

              <div className="mt-4 rounded-[20px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-4">
                <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                  {tApp('profileBio')}
                </p>

                {profileBlockedByTagr ? (
                  <p className="mt-2 text-[13px] font-medium text-[rgb(var(--color-system-red))]">
                    Blocked by Tagr.
                  </p>
                ) : null}

                {displayProfile?.about ? (
                  <>
                    <NoteContent
                      content={displayProfile.about}
                      className="mt-2 text-[15px] leading-7"
                      allowTranslation
                      showEntityPreviews={false}
                    />
                  </>
                ) : (
                  <p className="mt-2 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                    {profileLoading || profileModerationLoading ? tApp('profileLoadingBio') : tApp('profileNoBio')}
                  </p>
                )}
              </div>

              <div className="mt-4 rounded-[20px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                    Profile Insights
                  </p>
                  <div className="flex items-center gap-2">
                    <select
                      value={aiAssistProvider}
                      onChange={(event) => {
                        const next = event.target.value as AiAssistProvider
                        setAiAssistProvider(next)
                        setAiAssistProviderState(next)
                      }}
                      className="rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-2 py-1 text-[11px] text-[rgb(var(--color-label-secondary))]"
                      aria-label="AI provider"
                    >
                      <option value="auto">Auto</option>
                      <option value="gemma">Gemma</option>
                      <option value="gemini">Gemini</option>
                    </select>
                    <span className="text-[11px] text-[rgb(var(--color-label-tertiary))]">
                      {profileInsightsLoading ? 'Analyzing…' : profileInsightsSource === 'gemma' ? 'Gemma on-device' : profileInsightsSource === 'gemini' ? 'Gemini API' : 'Fallback'}
                    </span>
                  </div>
                </div>

                <div className="mt-2 space-y-2">
                  {profileInsights.map((insight) => (
                    <p key={insight} className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                      {insight}
                    </p>
                  ))}
                </div>
              </div>

              {(renderProfile?.website || renderProfile?.lud16 || renderProfile?.lud06 || birthdayLabel) && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {renderProfile?.website && (
                    <ProfileFactCard label="Website" value={renderProfile.website} href={renderProfile.website} />
                  )}
                  {renderProfile?.lud16 && (
                    <ProfileFactCard label="LUD16" value={renderProfile.lud16} monospace />
                  )}
                  {renderProfile?.lud06 && (
                    <ProfileFactCard label="LUD06" value={renderProfile.lud06} monospace />
                  )}
                  {birthdayLabel && (
                    <ProfileFactCard label="Birthday" value={birthdayLabel} />
                  )}
                </div>
              )}

              {renderProfile?.externalIdentities && renderProfile.externalIdentities.length > 0 && (
                <div className="mt-4 rounded-[20px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-4">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                    Verified Identities
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {renderProfile.externalIdentities.map((identity, i) => {
                      const url = getIdentityUrl(identity)
                      const label = `${getPlatformDisplayName(identity.platform)}: ${identity.identity}`
                      const chipContent = (
                        <>
                          {label}
                          {identity.proof && (
                            <span className="text-[10px] text-[rgb(var(--color-label-tertiary))]">✓</span>
                          )}
                        </>
                      )
                      if (url) {
                        return (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[12px] text-[rgb(var(--color-label-secondary))]">
                            {chipContent}
                          </a>
                        )
                      }
                      return (
                        <span key={i} className="flex items-center gap-1.5 rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[12px] text-[rgb(var(--color-label-secondary))]">
                          {chipContent}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {(musicStatusLoading || musicStatus || isSelf) && (
                <div className="mt-4 rounded-[20px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                        NIP-38 Music Status
                      </p>
                      <p className="mt-1 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                        Live &quot;currently listening&quot; status for this profile.
                      </p>
                    </div>
                    {isSelf && (
                      <Link
                        to="/settings#music-status"
                        className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-3 py-1.5 text-[13px] font-medium text-[rgb(var(--color-label))]"
                      >
                        Manage
                      </Link>
                    )}
                  </div>

                  {musicStatus ? (
                    <UserStatusBody event={musicStatus.event} className="mt-4" linkedPreview={false} />
                  ) : (
                    <p className="mt-4 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                      {musicStatusLoading
                        ? 'Loading live music status…'
                        : isSelf
                          ? 'No active music status. Publish one from Settings.'
                          : 'No active music status.'}
                    </p>
                  )}
                </div>
              )}

              {(livePresenceLoading || livePresence) && (
                <div className="mt-4 rounded-[20px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                        NIP-53 Live Presence
                      </p>
                      <p className="mt-1 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                        Active live activity and meeting presence for this profile.
                      </p>
                    </div>
                  </div>

                  {livePresence ? (
                    <div className="mt-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
                        <span>{getLivePresenceKindLabel(livePresence.kind)}</span>
                        <span>{getLivePresenceStatusLabel(livePresence.status)}</span>
                        <span>{formatTimestamp(livePresence.createdAt)}</span>
                      </div>

                      {(livePresence.title || livePresence.summary) && (
                        <p className="text-[15px] leading-7 text-[rgb(var(--color-label))]">
                          {livePresence.title ?? livePresence.summary}
                        </p>
                      )}

                      {livePresence.streamingUrl && (
                        <a
                          href={livePresence.streamingUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="inline-flex items-center gap-2 rounded-full bg-[rgb(var(--color-fill)/0.09)] px-3 py-1.5 text-[13px] font-medium text-[rgb(var(--color-label))]"
                        >
                          Open stream
                        </a>
                      )}
                    </div>
                  ) : (
                    <p className="mt-4 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
                      {livePresenceLoading ? 'Checking live presence…' : 'No active live presence.'}
                    </p>
                  )}
                </div>
              )}

              {!currentUser && !isSelf && (
                <p className="mt-4 text-[13px] text-[rgb(var(--color-label-tertiary))]">
                  Connect a NIP-07 signer to publish follows or a Kind-1984 report for this profile.
                </p>
              )}

              {profileLoading && !profile && (
                <p className="mt-4 text-[14px] text-[rgb(var(--color-label-tertiary))]">
                  Loading profile metadata…
                </p>
              )}

              {profileError && (
                <p className="mt-4 text-[14px] text-[rgb(var(--color-system-red))]">
                  {profileError}
                </p>
              )}
            </div>

            <ExpandableSectionCard
              id="profile-entry"
              eyebrow="Your Entry"
              title={isSelf ? 'Following Controls' : (currentEntry ? 'Manage Your Follow' : 'Follow This Profile')}
              description={
                isSelf
                  ? 'This route is for inspecting your published profile. Kind-3 follow entries are edited from other profiles.'
                  : !currentUser
                    ? 'Connect a NIP-07 signer to publish follows as a replaceable Kind-3 contact list.'
                    : 'Saving here republishes your full Kind-3 contact list. New follows are appended to the end so order stays chronological.'
              }
              countLabel={!isSelf && currentEntry ? 'Following' : undefined}
              defaultOpen={!isSelf && Boolean(currentEntry || message || error)}
            >
              {isSelf ? (
                <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                  View another profile to create or edit your contact entry for that person.
                </p>
              ) : !currentUser ? (
                <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                  Follow and unfollow actions need a connected signer.
                </p>
              ) : (
                <>
                  <label className="block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
                    Petname
                  </label>
                  <input
                    type="text"
                    value={petname}
                    onChange={(event) => setPetname(event.target.value)}
                    placeholder="alice"
                    className="
                      mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                      bg-[rgb(var(--color-bg))] px-3 py-2.5
                      text-[15px] text-[rgb(var(--color-label))]
                      placeholder:text-[rgb(var(--color-label-tertiary))]
                      outline-none
                    "
                  />

                  <label className="mt-4 block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
                    Relay Hint
                  </label>
                  <input
                    type="url"
                    value={relayUrl}
                    onChange={(event) => setRelayUrl(event.target.value)}
                    placeholder="wss://relay.example.com"
                    className="
                      mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
                      bg-[rgb(var(--color-bg))] px-3 py-2.5
                      text-[15px] text-[rgb(var(--color-label))]
                      placeholder:text-[rgb(var(--color-label-tertiary))]
                      outline-none
                    "
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />

                  {viewerContactsLoading && (
                    <p className="mt-3 text-[13px] text-[rgb(var(--color-label-tertiary))]">
                      Refreshing your current Kind-3 list…
                    </p>
                  )}

                  {message && (
                    <p className="mt-3 text-[13px] text-[rgb(var(--color-system-green))]">
                      {message}
                    </p>
                  )}

                  {error && (
                    <p className="mt-3 text-[13px] text-[rgb(var(--color-system-red))]">
                      {error}
                    </p>
                  )}

                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saving}
                      className="
                        flex-1 rounded-[14px] bg-[rgb(var(--color-label))]
                        px-4 py-2.5 text-[14px] font-medium text-white
                        transition-opacity active:opacity-75 disabled:opacity-40
                      "
                    >
                      {saving ? 'Publishing…' : currentEntry ? 'Save Contact' : 'Follow'}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleUnfollow()}
                      disabled={saving || !currentEntry}
                      className="
                        flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.2)]
                        bg-[rgb(var(--color-bg))] px-4 py-2.5
                        text-[14px] font-medium text-[rgb(var(--color-label))]
                        transition-opacity active:opacity-75 disabled:opacity-40
                      "
                    >
                      Unfollow
                    </button>
                  </div>
                </>
              )}
            </ExpandableSectionCard>

            {isSelf && (
              <ExpandableSectionCard
                id="profile-metadata"
                eyebrow="Kind 0 Metadata"
                title="Edit Published Profile"
                description="Publishing here replaces your latest kind-0 metadata event."
                defaultOpen={false}
              >
                <ProfileMetadataEditor
                  pubkey={pubkey}
                  profile={profile}
                />
              </ExpandableSectionCard>
            )}

            <ExpandableSectionCard
              eyebrow="NIP-58"
              title="Badges"
              description="Accepted badge awards currently cached for this profile."
              countLabel={badgesLoading && badges.length === 0 ? '…' : String(badges.length)}
              defaultOpen={badges.length > 0}
            >
              {badgesLoading && badges.length === 0 ? (
                <p className="text-[14px] text-[rgb(var(--color-label-tertiary))]">
                  Loading profile badges…
                </p>
              ) : badges.length > 0 ? (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {badges.map((badge) => (
                    <ProfileBadgeTile key={badge.awardEventId} badge={badge} />
                  ))}
                </div>
              ) : (
                <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                  No accepted profile badges are cached locally for this profile yet.
                </p>
              )}
            </ExpandableSectionCard>

            <ExpandableSectionCard
              eyebrow="NIP-89"
              title="Handlers"
              description="Published handler information events for this profile."
              countLabel={handlerInfoLoading && handlerInfoEvents.length === 0 ? '…' : String(handlerInfoEvents.length)}
            >
              {handlerInfoLoading && handlerInfoEvents.length === 0 ? (
                <p className="text-[14px] text-[rgb(var(--color-label-tertiary))]">
                  Loading published handler information…
                </p>
              ) : handlerInfoEvents.length > 0 ? (
                <div className="space-y-3">
                  {handlerInfoEvents.map((handler) => (
                    <Link
                      key={handler.id}
                      to={handler.naddr ? `/a/${handler.naddr}` : `/note/${handler.id}`}
                      className="
                        block rounded-[16px] border border-[rgb(var(--color-fill)/0.12)]
                        bg-[rgb(var(--color-bg))] p-3
                        transition-opacity active:opacity-80
                      "
                    >
                      <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                        {getHandlerDisplayName(handler)}
                      </p>
                      <p className="mt-1 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                        {getHandlerSummary(handler)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {handler.supportedKinds.map((kind) => (
                          <span
                            key={`${handler.id}:${kind}`}
                            className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[12px] text-[rgb(var(--color-label-secondary))]"
                          >
                            Kind {kind}
                          </span>
                        ))}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                  No kind-31990 handler events are cached locally for this profile yet.
                </p>
              )}
            </ExpandableSectionCard>

            <ExpandableSectionCard
              eyebrow="NIP-89"
              title="Recommendations"
              description="Published kind recommendations made by this profile."
              countLabel={handlerRecommendationsLoading && handlerRecommendations.length === 0 ? '…' : String(handlerRecommendations.length)}
            >
              {handlerRecommendationsLoading && handlerRecommendations.length === 0 ? (
                <p className="text-[14px] text-[rgb(var(--color-label-tertiary))]">
                  Loading published handler recommendations…
                </p>
              ) : handlerRecommendations.length > 0 ? (
                <div className="space-y-3">
                  {handlerRecommendations.map((recommendation) => (
                    <Link
                      key={recommendation.id}
                      to={`/note/${recommendation.id}`}
                      className="
                        block rounded-[16px] border border-[rgb(var(--color-fill)/0.12)]
                        bg-[rgb(var(--color-bg))] p-3
                        transition-opacity active:opacity-80
                      "
                    >
                      <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                        Kind {recommendation.supportedKind}
                      </p>
                      <p className="mt-1 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                        {getHandlerRecommendationSummary(recommendation)}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                  No kind-31989 recommendation events are cached locally for this profile yet.
                </p>
              )}
            </ExpandableSectionCard>

            <ExpandableSectionCard
              eyebrow="Kind 3"
              title="Contact List"
              description="The latest known contact list for this profile."
              countLabel={contactList ? String(contactList.entries.length) : (contactListLoading ? '…' : '0')}
            >
              {contactListLoading && !contactList ? (
                <p className="text-[14px] text-[rgb(var(--color-label-tertiary))]">
                  Loading the latest known contact list…
                </p>
              ) : contactList ? (
                <>
                  <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                    Following {contactList.entries.length} profile{contactList.entries.length === 1 ? '' : 's'}
                  </p>
                  {contactList.updatedAt !== undefined && (
                    <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
                      Latest known list from {formatTimestamp(contactList.updatedAt)}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                  No contact list is cached locally for this profile yet.
                </p>
              )}
            </ExpandableSectionCard>

            <ExpandableSectionCard
              eyebrow="NIP-51"
              title="Sets"
              description="Follow sets, starter packs, curations, and app sets published by this profile."
              countLabel={nip51SetsLoading && totalCuratedSets === 0 ? '…' : String(totalCuratedSets)}
            >
              <div className="space-y-4">
                <Nip51SetGroup
                  title={getNip51ListLabel(Kind.FollowSet)}
                  emptyText="No kind-30000 follow sets are cached locally for this profile yet."
                  loading={nip51SetsLoading}
                  events={followSets}
                />
                <Nip51SetGroup
                  title={getNip51ListLabel(Kind.StarterPack)}
                  emptyText="No kind-39089 starter packs are cached locally for this profile yet."
                  loading={nip51SetsLoading}
                  events={starterPacks}
                />
                <Nip51SetGroup
                  title={getNip51ListLabel(Kind.MediaStarterPack)}
                  emptyText="No kind-39092 media starter packs are cached locally for this profile yet."
                  loading={nip51SetsLoading}
                  events={mediaStarterPacks}
                />
                <Nip51SetGroup
                  title={getNip51ListLabel(Kind.ArticleCurationSet)}
                  emptyText="No kind-30004 article curation sets are cached locally for this profile yet."
                  loading={nip51SetsLoading}
                  events={articleCurations}
                />
                <Nip51SetGroup
                  title={getNip51ListLabel(Kind.AppCurationSet)}
                  emptyText="No kind-30267 app curation sets are cached locally for this profile yet."
                  loading={nip51SetsLoading}
                  events={appCurations}
                />
              </div>
            </ExpandableSectionCard>
          </div>

        </div>
      )}

      <ReportSheet
        open={reportSheetOpen}
        target={{ type: 'profile', pubkey: pubkey ?? '' }}
        onClose={() => setReportSheetOpen(false)}
        onPublished={() => {
          setReported(true)
          setMessage('Kind-1984 report published to your write relays.')
          setError(null)
        }}
      />

      <ImageLightbox
        open={expandedImage !== null}
        imageUrl={expandedImage?.url ?? null}
        alt={expandedImage?.alt ?? ''}
        title={expandedImage?.title ?? 'Profile image'}
        onClose={() => setExpandedImage(null)}
      />
    </div>
  )
}

function ProfileBadgeTile({ badge }: { badge: DisplayedProfileBadge }) {
  const asset = pickBadgeAsset(badge.definition, 96)
  const title = badge.definition.name ?? badge.definition.identifier

  return (
    <Link
      to={`/note/${badge.awardEventId}`}
      className="
        rounded-[18px] border border-[rgb(var(--color-fill)/0.12)]
        bg-[rgb(var(--color-bg))] p-3
        text-center transition-opacity active:opacity-80
      "
    >
      {asset ? (
        <img
          src={asset.url}
          alt={title}
          className="mx-auto h-16 w-16 rounded-[16px] object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[16px] bg-[rgb(var(--color-fill)/0.12)] text-[22px] font-semibold text-[rgb(var(--color-label))]">
          ★
        </div>
      )}

      <p className="mt-3 line-clamp-2 text-[13px] font-medium leading-5 text-[rgb(var(--color-label))]">
        {title}
      </p>
    </Link>
  )
}

function Nip51SetGroup({
  title,
  emptyText,
  loading,
  events,
}: {
  title: string
  emptyText: string
  loading: boolean
  events: ParsedNip51ListEvent[]
}) {
  return (
    <section>
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-secondary))]">
        {title}
      </p>

      {loading && events.length === 0 ? (
        <p className="mt-3 text-[14px] text-[rgb(var(--color-label-tertiary))]">
          Loading {title.toLowerCase()}…
        </p>
      ) : events.length > 0 ? (
        <div className="mt-3 space-y-3">
          {events.map((event) => (
            <Link
              key={event.id}
              to={event.route}
              className="
                block rounded-[16px] border border-[rgb(var(--color-fill)/0.12)]
                bg-[rgb(var(--color-bg))] p-3
                transition-opacity active:opacity-80
              "
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                    {event.title ?? event.identifier ?? title}
                  </p>
                  <p className="mt-1 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
                    {getNip51SetSummary(event)}
                  </p>
                  <p className="mt-2 text-[12px] text-[rgb(var(--color-label-tertiary))]">
                    Updated {formatTimestamp(event.createdAt)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[12px] text-[rgb(var(--color-label-secondary))]">
                  Kind {event.kind}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[14px] text-[rgb(var(--color-label-secondary))]">
          {emptyText}
        </p>
      )}
    </section>
  )
}
