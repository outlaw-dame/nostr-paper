/**
 * HeroCard
 *
 * The primary Paper interaction:
 * - Full-bleed media fill (55svh)
 * - Glass bottom sheet with author + content preview
 * - Drag-up gesture (velocity or threshold) → full-screen expand
 * - Pull-down dismiss from expanded state
 * - Tilt panorama on images
 *
 * Layout ID ties this to ExpandedNote for shared layout morph.
 */

import { useState, useCallback } from 'react'
import {
  motion,
  useMotionValue,
  useTransform,
  AnimatePresence,
} from 'motion/react'
import { useProfile } from '@/hooks/useProfile'
import { useFollowStatus } from '@/hooks/useFollowStatus'
import { useStoryCardPreview } from '@/hooks/useStoryCardPreview'
import { SensitiveImage } from '@/components/media/SensitiveImage'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { TwemojiText } from '@/components/ui/TwemojiText'
import { ExpandedNote } from './ExpandedNote'
import { NoteContent } from './NoteContent'
import { getQuotePostBody, getRepostPreviewText, parseQuoteTags } from '@/lib/nostr/repost'
import { sanitizeText } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'

interface HeroCardProps {
  event: NostrEvent
  index?: number  // For stagger animation
}

// Physics constants matching Paper's feel
const SPRING_CONFIG  = { type: 'spring', stiffness: 320, damping: 32 } as const
const EXPAND_OFFSET  = -90   // px drag up to trigger expand
const EXPAND_VEL     = -550  // px/s velocity to trigger expand
const HERO_HEIGHT = 'clamp(320px, 44svh, 460px)'

export function HeroCard({ event, index = 0 }: HeroCardProps) {
  const { profile } = useProfile(event.pubkey, { background: false })
  const followStatus = useFollowStatus(event.pubkey)
  const [expanded, setExpanded] = useState(false)
  const {
    article,
    poll,
    video,
    repost,
    thread,
    attachments,
    contentWarning,
    quoteBody,
    isArticleStory,
    isVideoStory,
    storyAuthor,
    storySiteName,
    storyTitle,
    storySummary,
    primaryMedia,
    videoPoster,
    videoPlaybackPlan,
  } = useStoryCardPreview(event, { ogEnabled: true })

  const quoteCount = parseQuoteTags(event).length
  const heroLabel = isArticleStory
    ? 'Feature'
    : isVideoStory
      ? (video?.isShort ? 'Short video' : 'Video')
      : thread
        ? 'Thread'
        : poll
          ? 'Poll'
          : repost
            ? 'Repost'
            : (storySiteName ?? 'Note')

  const rawPreview = ((article?.summary ?? video?.summary ?? thread?.content) ?? (repost
    ? getRepostPreviewText(event)
    : (sanitizeText(quoteBody).trim() || (quoteCount > 0 ? 'Quoted an event' : sanitizeText(event.content)))))
    .replace(/https?:\/\/\S+/g, '')  // Strip URLs from preview
    .trim()

  const previewText = (storySummary || rawPreview).slice(0, 180)
  const displayTitle = storyTitle

  const videoAutoplaySources = videoPlaybackPlan?.sources ?? []
  const canAutoplayVideo = Boolean(video && videoAutoplaySources.length > 0 && !contentWarning && followStatus !== false)
  const heroPoster = videoPoster ?? primaryMedia

  const dragY        = useMotionValue(0)
  // Subtle scale lift as user drags up — haptic-like feedback
  const scale        = useTransform(dragY, [-120, 0, 80], [1.015, 1, 0.995])
  // Glass overlay opacity shifts with drag
  const glassOpacity = useTransform(dragY, [-60, 0], [0.95, 0.78])
  // Content shifts up slightly to follow gesture
  const contentY     = useTransform(dragY, [-120, 0], [-8, 0])
  // Pull-up pill nudge — declared here not inline in JSX (hooks rules)
  const pillY        = useTransform(dragY, [-60, 0], [-2, 0])

  const handleDragEnd = useCallback(
    (_: unknown, info: { velocity: { y: number }; offset: { y: number } }) => {
      if (info.offset.y < EXPAND_OFFSET || info.velocity.y < EXPAND_VEL) {
        setExpanded(true)
      }
    },
    []
  )

  return (
    <>
      <motion.article
        layoutId={`card-${event.id}`}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...SPRING_CONFIG, delay: index * 0.06 }}
        className="
          relative w-full overflow-hidden rounded-ios-2xl
          bg-[rgb(var(--color-bg-secondary))]
          card-elevated tap-none cursor-pointer
          select-none
        "
        style={{
          height: HERO_HEIGHT,
          scale,
        }}
        drag="y"
        dragConstraints={{ top: -200, bottom: 90 }}
        dragElastic={{ top: 0.28, bottom: 0.18 }}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        onClick={() => setExpanded(true)}
        role="button"
        tabIndex={0}
        aria-label={`Open ${article ? 'article' : video ? (video.isShort ? 'short video' : 'video') : thread ? 'thread' : poll ? 'poll' : repost ? 'repost' : 'note'} by ${profile?.display_name ?? profile?.name ?? 'unknown'}`}
        onDragStart={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setExpanded(true)
        }}
      >
        {/* Full-bleed media */}
        {canAutoplayVideo ? (
          <video
            poster={heroPoster}
            muted
            playsInline
            autoPlay
            loop
            preload="metadata"
            className="absolute inset-0 w-full h-full object-cover"
            aria-label={heroLabel}
          >
            {videoAutoplaySources.map((source) => (
              <source
                key={`${source.url}:${source.type ?? 'unknown'}`}
                src={source.url}
                {...(source.type ? { type: source.type } : {})}
              />
            ))}
          </video>
        ) : primaryMedia ? (
          <SensitiveImage
            src={primaryMedia}
            className="absolute inset-0 w-full h-full"
            isSensitive={contentWarning !== null}
            reason={contentWarning?.reason}
            isUnfollowed={followStatus === false}
          />
        ) : (
          // Text-only note: gradient background keyed to pubkey color
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(145deg, ${pubkeyToGradient(event.pubkey)})`,
            }}
          />
        )}

        {/* Scrim — ensures text legibility regardless of image */}
        <div className="
          absolute inset-0
          bg-gradient-to-t from-black/72 via-black/18 to-black/4
        " />

        {/* Glass bottom content panel */}
        <motion.div
          className="
            absolute bottom-0 left-0 right-0
            px-4 pb-4 pt-8
          "
          style={{ opacity: glassOpacity, y: contentY }}
        >
          <motion.div style={{ y: pillY }}>
            <span className="
              inline-flex items-center rounded-full
              bg-white/14 px-3 py-1
              text-[11px] font-semibold uppercase tracking-[0.14em] text-white/82
              backdrop-blur-md
            ">
              {heroLabel}
            </span>
          </motion.div>

          <AuthorRow
            pubkey={event.pubkey}
            profile={profile}
            timestamp={event.created_at}
            light
          />

          {(storyAuthor || storySiteName) && (
            <p className="mt-1 text-[13px] leading-5 text-white/82">
              {storyAuthor && storySiteName
                ? `By ${storyAuthor} • ${storySiteName}`
                : storyAuthor
                  ? `By ${storyAuthor}`
                  : storySiteName}
            </p>
          )}

          {displayTitle && (
            <h2 className="
              mt-2.5 text-white text-[24px] leading-[1.04]
              font-semibold tracking-[-0.035em] line-clamp-3
              [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]
            ">
              <TwemojiText text={displayTitle} />
            </h2>
          )}

          {previewText.length > 0 && (
            <NoteContent
              content={previewText}
              compact
              className="
                mt-2 text-white/88 line-clamp-3
                [text-shadow:0_1px_4px_rgba(0,0,0,0.6)]
              "
            />
          )}
        </motion.div>
      </motion.article>

      {/* Expanded full-screen note — Portal-like z-layer */}
      <AnimatePresence>
        {expanded && (
          <ExpandedNote
            event={event}
            profile={profile}
            onClose={() => setExpanded(false)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Deterministic gradient from a pubkey for text-only hero fallbacks.
 *
 * We keep the palette slightly muted and offset the second hue so cards
 * remain readable under the bottom scrim while still feeling varied.
 */
function pubkeyToGradient(pubkey: string): string {
  let hash = 0
  for (let index = 0; index < pubkey.length; index += 1) {
    hash = ((hash << 5) - hash + pubkey.charCodeAt(index)) | 0
  }

  const baseHue = Math.abs(hash) % 360
  const accentHue = (baseHue + 32 + (Math.abs(hash >> 8) % 54)) % 360
  const lightnessA = 48 + (Math.abs(hash >> 16) % 10)
  const lightnessB = 30 + (Math.abs(hash >> 24) % 12)

  return [
    `hsl(${baseHue} 74% ${lightnessA}%)`,
    `hsl(${accentHue} 68% ${lightnessB}%)`,
  ].join(', ')
}
