import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { NoteContent } from '@/components/cards/NoteContent'
import { SensitiveImage } from '@/components/media/SensitiveImage'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { useStoriesRail } from '@/hooks/useStoriesRail'
import { useProfile } from '@/hooks/useProfile'
import type { StoryGroup } from '@/lib/nostr/stories'

interface StoryRailProps {
  onComposeStory: () => void
}

export function StoryRail({ onComposeStory }: StoryRailProps) {
  const { groups, loading, error } = useStoriesRail(true)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  const openViewer = useCallback((index: number) => {
    setViewerIndex(index)
  }, [])

  return (
    <>
      <section className="app-panel rounded-ios-xl px-4 py-3">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="section-kicker">Stories</p>
            <p className="mt-1 text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              Ephemeral media from people you follow. Stories expire after 24 hours.
            </p>
          </div>

          {groups.length > 0 && (
            <span className="rounded-full bg-[rgb(var(--color-fill)/0.08)] px-2.5 py-1 text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
              {groups.length}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-start gap-3 overflow-x-auto pb-1 scrollbar-none">
          <AddStoryBubble onClick={onComposeStory} />

          {loading && groups.length === 0 ? (
            Array.from({ length: 4 }, (_, index) => (
              <StorySkeleton key={index} />
            ))
          ) : (
            groups.map((group, index) => (
              <StoryBubble
                key={group.pubkey}
                group={group}
                onClick={() => openViewer(index)}
              />
            ))
          )}
        </div>

        {error && (
          <p className="mt-3 text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
            {error}
          </p>
        )}
      </section>

      <AnimatePresence>
        {viewerIndex !== null && groups[viewerIndex] && (
          <StoryViewer
            groups={groups}
            startIndex={viewerIndex}
            onClose={() => setViewerIndex(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function AddStoryBubble({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-[78px] shrink-0 flex-col items-center gap-2 text-center tap-none"
      aria-label="Add a story"
    >
      <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-[rgb(var(--color-divider)/0.08)] bg-[rgb(var(--color-surface-elevated)/0.96)] shadow-[0_10px_24px_rgba(15,20,30,0.08)]">
        <div className="flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[rgb(var(--color-fill)/0.08)] text-[rgb(var(--color-label))]">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <path d="M9 3.5v11M3.5 9h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-[rgb(var(--color-label))]">
          Add story
        </p>
        <p className="mt-0.5 text-[11px] text-[rgb(var(--color-label-tertiary))]">
          24h
        </p>
      </div>
    </button>
  )
}

function StorySkeleton() {
  return (
    <div className="flex w-[78px] shrink-0 flex-col items-center gap-2">
      <div className="h-[72px] w-[72px] rounded-full skeleton" />
      <div className="h-3 w-14 rounded-full skeleton" />
    </div>
  )
}

function StoryBubble({
  group,
  onClick,
}: {
  group: StoryGroup
  onClick: () => void
}) {
  const { profile } = useProfile(group.pubkey, { background: false })
  const displayName = profile?.display_name ?? profile?.name ?? `${group.pubkey.slice(0, 8)}…`

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-[78px] shrink-0 flex-col items-center gap-2 text-center tap-none"
      aria-label={`Open stories by ${displayName}`}
    >
      <div
        className="flex h-[72px] w-[72px] items-center justify-center rounded-full p-[2px] shadow-[0_10px_24px_rgba(15,20,30,0.10)]"
        style={{
          background: 'linear-gradient(145deg, rgba(188, 126, 57, 0.92), rgba(230, 188, 121, 0.9), rgba(143, 93, 55, 0.92))',
        }}
      >
        <div className="flex h-full w-full items-center justify-center rounded-full bg-[rgb(var(--color-bg))] p-[3px]">
          <StoryAvatar
            src={profile?.picture ?? null}
            name={displayName}
            pubkey={group.pubkey}
          />
        </div>
      </div>

      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-[rgb(var(--color-label))]">
          <TwemojiText text={displayName} />
        </p>
        <p className="mt-0.5 text-[11px] text-[rgb(var(--color-label-tertiary))]">
          {group.items.length} {group.items.length === 1 ? 'story' : 'stories'}
        </p>
      </div>
    </button>
  )
}

function StoryAvatar({
  src,
  name,
  pubkey,
}: {
  src: string | null
  name: string
  pubkey: string
}) {
  const initial = (name[0] ?? '?').toUpperCase()
  const background = useMemo(() => {
    const hue = parseInt(pubkey.slice(0, 6), 16) % 360
    const saturation = 52 + (parseInt(pubkey.slice(6, 8), 16) % 18)
    return `hsl(${hue} ${saturation}% 42%)`
  }, [pubkey])

  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="h-full w-full rounded-full object-cover"
      />
    )
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center rounded-full text-[15px] font-semibold text-white"
      style={{ background }}
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}

interface StoryViewerProps {
  groups: StoryGroup[]
  startIndex: number
  onClose: () => void
}

function StoryViewer({ groups, startIndex, onClose }: StoryViewerProps) {
  const navigate = useNavigate()
  const [groupIndex, setGroupIndex] = useState(startIndex)
  const [storyIndex, setStoryIndex] = useState(0)

  const group = groups[groupIndex] ?? groups[0]
  const story = group?.items[storyIndex]
  const { profile } = useProfile(group?.pubkey ?? '', { background: false })
  const previewImage = story?.media.kind === 'image'
    ? story.media.src
    : story?.media.poster

  const goNext = useCallback(() => {
    if (!group) return

    if (storyIndex < group.items.length - 1) {
      setStoryIndex(storyIndex + 1)
      return
    }

    if (groupIndex < groups.length - 1) {
      setGroupIndex(groupIndex + 1)
      setStoryIndex(0)
      return
    }

    onClose()
  }, [group, groupIndex, groups.length, onClose, storyIndex])

  const goPrevious = useCallback(() => {
    if (storyIndex > 0) {
      setStoryIndex(storyIndex - 1)
      return
    }

    if (groupIndex === 0) return

    const previousGroupIndex = groupIndex - 1
    const previousGroup = groups[previousGroupIndex]
    setGroupIndex(previousGroupIndex)
    setStoryIndex(Math.max(0, (previousGroup?.items.length ?? 1) - 1))
  }, [groupIndex, groups, storyIndex])

  useEffect(() => {
    if (!story || story.isSensitive || story.media.kind !== 'image') return undefined

    const timer = window.setTimeout(() => {
      goNext()
    }, 5_000)

    return () => window.clearTimeout(timer)
  }, [goNext, story])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key === 'ArrowRight') {
        goNext()
        return
      }
      if (event.key === 'ArrowLeft') {
        goPrevious()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goNext, goPrevious, onClose])

  useEffect(() => {
    if (groups[groupIndex] || groups.length === 0) return
    setGroupIndex(0)
    setStoryIndex(0)
  }, [groupIndex, groups])

  useEffect(() => {
    if (!group || storyIndex < group.items.length) return
    setStoryIndex(0)
  }, [group, storyIndex])

  if (!group || !story) return null

  const openStoryEvent = () => {
    onClose()
    navigate(story.route)
  }

  const timeRemaining = formatStoryRemaining(story.expiresAt)
  const label = story.title ?? story.caption ?? 'Story'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-[rgba(8,10,14,0.96)]"
    >
      <div className="absolute inset-0">
        {story.media.kind === 'video' && !story.isSensitive ? (
          <video
            key={story.id}
            className="h-full w-full object-cover"
            poster={story.media.poster}
            muted
            autoPlay
            playsInline
            preload="metadata"
            onEnded={goNext}
          >
            {story.media.sources.map((source) => (
              <source
                key={`${story.id}:${source.url}`}
                src={source.url}
                {...(source.type ? { type: source.type } : {})}
              />
            ))}
          </video>
        ) : previewImage ? (
          <SensitiveImage
            src={previewImage}
            className="h-full w-full"
            disableTilt
            isSensitive={story.isSensitive}
            reason={story.sensitiveReason}
            isUnfollowed={false}
          />
        ) : (
          <div
            className="h-full w-full"
            style={{
              background: 'linear-gradient(145deg, rgba(30, 38, 52, 0.96), rgba(12, 16, 24, 0.98))',
            }}
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-b from-black/72 via-black/18 to-black/70" />
      </div>

      <button
        type="button"
        onClick={goPrevious}
        className="absolute inset-y-0 left-0 w-1/2 tap-none"
        aria-label="Previous story"
      />
      <button
        type="button"
        onClick={goNext}
        className="absolute inset-y-0 right-0 w-1/2 tap-none"
        aria-label="Next story"
      />

      <div className="relative z-10 flex h-full flex-col">
        <div className="px-4 pb-3 pt-safe">
          <div className="flex gap-1.5">
            {group.items.map((item, index) => (
              <div
                key={item.id}
                className="h-1 flex-1 overflow-hidden rounded-full bg-white/20"
              >
                <div
                  className="h-full rounded-full bg-white/90 transition-all duration-200"
                  style={{
                    width: index < storyIndex ? '100%' : index === storyIndex ? '38%' : '0%',
                  }}
                />
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <AuthorRow
                pubkey={group.pubkey}
                profile={profile}
                timestamp={story.createdAt}
                light
              />
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-md"
              aria-label="Close stories"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mt-auto px-4 pb-safe">
          <div className="max-w-[34rem] rounded-ios-2xl bg-black/22 p-4 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center rounded-full bg-white/14 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/84">
                Story
              </span>
              <span className="text-[12px] font-medium text-white/64">
                {timeRemaining}
              </span>
            </div>

            {story.title && (
              <h3 className="mt-3 text-[24px] font-semibold leading-[1.04] tracking-[-0.035em] text-white">
                <TwemojiText text={story.title} />
              </h3>
            )}

            {story.caption && (
              <NoteContent
                content={story.caption}
                compact
                className="mt-2 text-white/86"
              />
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={openStoryEvent}
                className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-[rgb(var(--color-label))] transition-opacity active:opacity-80"
              >
                Open note
              </button>
              <div className="min-w-0 self-center text-[12px] text-white/58">
                <TwemojiText text={label} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function formatStoryRemaining(expiresAt: number): string {
  const remainingSeconds = Math.max(0, expiresAt - Math.floor(Date.now() / 1000))
  if (remainingSeconds < 60) return 'Expires soon'
  if (remainingSeconds < 3_600) return `${Math.ceil(remainingSeconds / 60)}m left`
  if (remainingSeconds < 86_400) return `${Math.ceil(remainingSeconds / 3_600)}h left`
  return `${Math.ceil(remainingSeconds / 86_400)}d left`
}
