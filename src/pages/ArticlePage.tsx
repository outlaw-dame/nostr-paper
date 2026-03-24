import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArticleBody } from '@/components/article/ArticleBody'
import { useEventModeration } from '@/hooks/useModeration'
import { useMuteList } from '@/hooks/useMuteList'
import { usePageHead } from '@/hooks/usePageHead'
import { useProfile } from '@/hooks/useProfile'
import { getLongFormEvent } from '@/lib/db/nostr'
import {
  decodeLongFormAddress,
  normalizeLongFormIdentifier,
  parseLongFormEvent,
} from '@/lib/nostr/longForm'
import { buildArticleMetaTags, buildArticleTitle } from '@/lib/nostr/meta'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import { isValidHex32 } from '@/lib/security/sanitize'
import type { NostrEvent } from '@/types'
import { Kind } from '@/types'

interface ArticleAddress {
  pubkey: string
  identifier: string
}

function resolveRouteAddress(
  pubkeyParam: string | undefined,
  identifierParam: string | undefined,
  naddrParam: string | undefined,
): ArticleAddress | null {
  if (naddrParam) {
    return decodeLongFormAddress(naddrParam)
  }

  if (!pubkeyParam || !identifierParam || !isValidHex32(pubkeyParam)) return null
  const identifier = normalizeLongFormIdentifier(identifierParam)
  if (!identifier) return null

  return {
    pubkey: pubkeyParam,
    identifier,
  }
}

export default function ArticlePage() {
  const navigate = useNavigate()
  const params = useParams<{ pubkey?: string; identifier?: string; naddr?: string }>()
  const address = useMemo(
    () => resolveRouteAddress(params.pubkey, params.identifier, params.naddr),
    [params.pubkey, params.identifier, params.naddr],
  )

  const [event, setEvent] = useState<NostrEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [override, setOverride] = useState(false)
  const { profile } = useProfile(event?.pubkey)
  const { blocked: eventBlocked, loading: moderationLoading } = useEventModeration(event)
  const { isMuted, loading: muteListLoading } = useMuteList()
  const isMutedAuthor = event ? isMuted(event.pubkey) : false
  const isBlocked = eventBlocked || isMutedAuthor

  // Inject <head> meta tags for article attribution and social sharing.
  // Computed once the article event is available; cleared on unmount.
  const article = useMemo(
    () => (event ? parseLongFormEvent(event) : null),
    [event],
  )
  usePageHead(
    article && !moderationLoading && (!isBlocked || override)
      ? {
          title: buildArticleTitle(article),
          tags: buildArticleMetaTags({ article, profile }),
        }
      : {},
  )

  useEffect(() => {
    if (!address) {
      setEvent(null)
      setLoading(false)
      setError('Invalid article address.')
      return
    }

    const controller = new AbortController()
    const { signal } = controller
    const routeAddress = address

    async function loadLocalLatest(): Promise<NostrEvent | null> {
      return getLongFormEvent(routeAddress.pubkey, routeAddress.identifier)
    }

    async function fetchFromRelays(): Promise<void> {
      let ndk
      try {
        ndk = getNDK()
      } catch {
        return
      }

      await withRetry(
        async () => {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

          await ndk.fetchEvents({
            authors: [routeAddress.pubkey],
            kinds: [Kind.LongFormContent],
            '#d': [routeAddress.identifier],
            limit: 10,
          })
        },
        {
          maxAttempts: 2,
          baseDelayMs: 1_500,
          signal,
        },
      )
    }

    setLoading(true)
    setError(null)
    setEvent(null)

    loadLocalLatest()
      .then(async (cached) => {
        if (signal.aborted) return

        if (cached) {
          setEvent(cached)
          setLoading(false)
        }

        await fetchFromRelays()
        if (signal.aborted) return

        const refreshed = await loadLocalLatest()
        if (signal.aborted) return

        setEvent(refreshed)
        setLoading(false)
        if (!refreshed) {
          setError('Article not found.')
        }
      })
      .catch((loadError: unknown) => {
        if (signal.aborted) return
        setLoading(false)
        setError(loadError instanceof Error ? loadError.message : 'Article load failed.')
      })

    return () => controller.abort()
  }, [address])

  if (loading || (event !== null && moderationLoading) || muteListLoading) {
    return (
      <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pt-safe pb-safe">
        <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-4 py-2 text-[15px] text-[rgb(var(--color-label))]"
          >
            Back
          </button>
        </div>
        <div className="pt-6 text-[rgb(var(--color-label-secondary))]">
          Loading article…
        </div>
      </div>
    )
  }

  if (!event || !article || (isBlocked && !override)) {
    return (
      <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pt-safe pb-safe">
        <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-4 py-2 text-[15px] text-[rgb(var(--color-label))]"
          >
            Back
          </button>
        </div>
        <div className="pt-6">
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-[rgb(var(--color-label))]">
            {isBlocked ? 'Content hidden' : 'Article unavailable'}
          </h1>
          {isBlocked ? (
            <>
              <p className="mt-3 text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
                This article was hidden by your content filters or mute list.
              </p>
              <button
                type="button"
                onClick={() => setOverride(true)}
                className="mt-4 rounded-full bg-[rgb(var(--color-fill)/0.12)] px-4 py-2 text-[15px] font-medium text-[rgb(var(--color-label))]"
              >
                Show Anyway
              </button>
            </>
          ) : error ? (
            <p className="mt-3 text-[16px] leading-7 text-[rgb(var(--color-label-secondary))]">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-full bg-[rgb(var(--color-fill)/0.09)] px-4 py-2 text-[15px] text-[rgb(var(--color-label))]"
        >
          Back
        </button>
      </div>

      <div className="pb-10 pt-4">
        <ArticleBody event={event} profile={profile} />
      </div>
    </div>
  )
}
