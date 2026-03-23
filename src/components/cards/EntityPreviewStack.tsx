import React from 'react'
import { Link } from 'react-router-dom'
import { EventPreviewCard } from '@/components/nostr/EventPreviewCard'
import { Nip21Mention } from '@/components/nostr/Nip21Mention'
import { LinkPreviewCard } from '@/components/links/LinkPreviewCard'
import { SyndicationPreviewCard } from '@/components/links/SyndicationPreviewCard'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { useAddressableEvent } from '@/hooks/useAddressableEvent'
import { useEvent } from '@/hooks/useEvent'
import { useLinkPreview } from '@/hooks/useLinkPreview'
import { useProfile } from '@/hooks/useProfile'
import { getNip21Route } from '@/lib/nostr/nip21'
import { looksLikeFeedUrl } from '@/lib/syndication/parse'
import { useSyndicationPreview } from '@/hooks/useSyndicationPreview'
import {
  rankPrimaryCandidates,
  shouldShowSourceRail,
  type EntityCandidate,
} from '@/lib/text/entityPreview'

interface EntityPreviewStackProps {
  candidates: EntityCandidate[]
  className?: string
}

function stopPropagation(event: React.MouseEvent<HTMLElement>) {
  event.stopPropagation()
}

function EntityCardSkeleton({ className = '' }: { className?: string | undefined }) {
  return (
    <div
      className={`mt-3 overflow-hidden rounded-ios-xl border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg-secondary))] ${className}`}
    >
      <div className="skeleton h-28 w-full" />
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="skeleton h-14 w-14 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2 pt-1">
          <div className="skeleton h-4 w-1/3 rounded" />
          <div className="skeleton h-4 w-2/3 rounded" />
        </div>
      </div>
    </div>
  )
}

function ProfileEntityCard({
  reference,
  pubkey,
  profile,
}: {
  reference: string
  pubkey: string
  profile: NonNullable<ReturnType<typeof useProfile>['profile']>
}) {
  const route = getNip21Route(reference) ?? `/profile/${encodeURIComponent(reference)}`
  const displayName = profile.display_name ?? profile.name ?? 'Unknown profile'
  const subtitle = profile.nip05 ?? profile.name ?? pubkey.slice(0, 16)
  const summary = profile.about?.trim()
  const banner = profile.banner
  const picture = profile.picture

  return (
    <Link
      to={route}
      onClick={stopPropagation}
      className="mt-3 block overflow-hidden rounded-ios-xl border border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-bg-secondary))] transition-opacity active:opacity-70"
    >
      {banner ? (
        <div className="h-28 w-full overflow-hidden bg-[rgb(var(--color-fill)/0.06)]">
          <img
            src={banner}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover object-center"
          />
        </div>
      ) : (
        <div className="h-28 w-full bg-[radial-gradient(circle_at_top_left,_rgb(var(--color-tint)/0.24),_transparent_55%),linear-gradient(180deg,_rgb(var(--color-fill)/0.12),_rgb(var(--color-fill)/0.04))]" />
      )}

      <div className="flex items-start gap-3 px-4 py-4">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-[rgb(var(--color-fill)/0.10)]">
          {picture ? (
            <img
              src={picture}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[22px] font-semibold text-[rgb(var(--color-label-tertiary))]">
              {displayName.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">
            Nostr Profile
          </p>
          <h3 className="mt-1 text-[18px] font-semibold leading-tight text-[rgb(var(--color-label))]">
            <TwemojiText text={displayName} />
          </h3>
          <p className="mt-1 text-[13px] leading-snug text-[rgb(var(--color-label-secondary))]">
            <TwemojiText text={subtitle} />
          </p>
          {summary && (
            <p className="mt-2 line-clamp-3 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              <TwemojiText text={summary} />
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}

function PrimaryEntitySlot({
  candidates,
}: {
  candidates: EntityCandidate[]
}) {
  const candidate = candidates[0]
  const remainingCandidates = candidates.slice(1)

  if (!candidate) return null

  switch (candidate.type) {
    case 'url':
      return <PrimaryUrlSlot candidate={candidate} remainingCandidates={remainingCandidates} />
    case 'event':
      return <PrimaryEventSlot candidate={candidate} remainingCandidates={remainingCandidates} />
    case 'address':
      return <PrimaryAddressSlot candidate={candidate} remainingCandidates={remainingCandidates} />
    case 'profile':
      return <PrimaryProfileSlot candidate={candidate} remainingCandidates={remainingCandidates} />
  }
}

function PrimaryUrlSlot({
  candidate,
  remainingCandidates,
}: {
  candidate: Extract<EntityCandidate, { type: 'url' }>
  remainingCandidates: EntityCandidate[]
}) {
  const feedLike = React.useMemo(() => looksLikeFeedUrl(candidate.url), [candidate.url])
  const { data, loading } = useLinkPreview(candidate.url, { enabled: !feedLike })
  const shouldTryFeed = feedLike || (!loading && !data)
  const { feed, loading: syndicationLoading } = useSyndicationPreview(candidate.url, { enabled: shouldTryFeed })

  if (loading || syndicationLoading) return <EntityCardSkeleton />
  if (feed) {
    return (
      <SyndicationPreviewCard
        feed={feed}
        sourceUrl={candidate.url}
      />
    )
  }
  if (!data) return <PrimaryEntitySlot candidates={remainingCandidates} />

  return (
    <LinkPreviewCard
      url={candidate.url}
      previewData={data}
      previewLoading={loading}
    />
  )
}

function PrimaryEventSlot({
  candidate,
  remainingCandidates,
}: {
  candidate: Extract<EntityCandidate, { type: 'event' }>
  remainingCandidates: EntityCandidate[]
}) {
  const { event, loading } = useEvent(candidate.eventId)

  if (loading) return <EntityCardSkeleton />
  if (!event) return <PrimaryEntitySlot candidates={remainingCandidates} />

  return <EventPreviewCard event={event} linked={false} className="mt-3" />
}

function PrimaryAddressSlot({
  candidate,
  remainingCandidates,
}: {
  candidate: Extract<EntityCandidate, { type: 'address' }>
  remainingCandidates: EntityCandidate[]
}) {
  const { event, loading } = useAddressableEvent({
    pubkey: candidate.pubkey,
    kind: candidate.kind,
    identifier: candidate.identifier,
  })

  if (loading) return <EntityCardSkeleton />
  if (!event) return <PrimaryEntitySlot candidates={remainingCandidates} />

  return <EventPreviewCard event={event} linked={false} className="mt-3" />
}

function PrimaryProfileSlot({
  candidate,
  remainingCandidates,
}: {
  candidate: Extract<EntityCandidate, { type: 'profile' }>
  remainingCandidates: EntityCandidate[]
}) {
  const { profile, loading } = useProfile(candidate.pubkey, { background: true })
  const hasConfidence = Boolean(
    profile && (
      profile.display_name ||
      profile.name ||
      profile.picture ||
      profile.banner ||
      profile.about ||
      profile.nip05
    ),
  )

  if (loading) return <EntityCardSkeleton />
  if (!hasConfidence) return <PrimaryEntitySlot candidates={remainingCandidates} />
  if (!profile) return <PrimaryEntitySlot candidates={remainingCandidates} />

  return (
    <ProfileEntityCard
      reference={candidate.reference}
      pubkey={candidate.pubkey}
      profile={profile}
    />
  )
}

function SourceChip({
  candidate,
}: {
  candidate: EntityCandidate
}) {
  const chipClass = 'border-[rgb(var(--color-fill)/0.10)] bg-[rgb(var(--color-fill)/0.06)] text-[rgb(var(--color-label-secondary))]'

  if (candidate.type === 'url') {
    return (
      <a
        href={candidate.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={stopPropagation}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[12px] font-medium transition-opacity active:opacity-70 ${chipClass}`}
      >
        <span className="h-2 w-2 rounded-full bg-[rgb(var(--color-system-blue))]" />
        {candidate.label}
      </a>
    )
  }

  return (
    <Nip21Mention
      value={candidate.reference}
      className={`border ${chipClass}`}
    />
  )
}

function SupportingSourceRail({
  candidates,
}: {
  candidates: EntityCandidate[]
}) {
  if (!shouldShowSourceRail(candidates)) return null

  return (
    <section className="mt-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[rgb(var(--color-label-tertiary))]">
          {candidates.length > 1 ? 'Sources' : 'Source'}
        </p>
      </div>
      <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
        {candidates.map((candidate) => (
          <SourceChip
            key={candidate.key}
            candidate={candidate}
          />
        ))}
      </div>
    </section>
  )
}

export function EntityPreviewStack({
  candidates,
  className = '',
}: EntityPreviewStackProps) {
  const rankedCandidates = React.useMemo(
    () => rankPrimaryCandidates(candidates),
    [candidates],
  )
  if (rankedCandidates.length === 0) return null

  return (
    <div className={className}>
      <PrimaryEntitySlot
        candidates={rankedCandidates}
      />
      <SupportingSourceRail
        candidates={candidates}
      />
    </div>
  )
}
