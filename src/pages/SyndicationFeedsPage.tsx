import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'
import { tApp } from '@/lib/i18n/app'
import {
  discoverSyndicationFeedCandidates,
  verifySyndicationFeed,
  type SyndicationDiscoveredFeedCandidate,
  type SyndicationVerifyErrorCode,
} from '@/lib/syndication/client'
import {
  SYNDICATION_FEED_LINKS_UPDATED_EVENT,
  listSavedSyndicationFeedLinks,
  removeSyndicationFeedLink,
  saveSyndicationFeedLink,
  type SavedSyndicationFeedKind,
  type SavedSyndicationLinkKind,
  type SavedSyndicationFeedLink,
  type SavedSyndicationSourceType,
} from '@/lib/syndication/feedLinks'
import {
  getShowSyndicationRankingReasons,
  setShowSyndicationRankingReasons,
} from '@/lib/syndication/settings'

type VerificationState = {
  loading: boolean
  message: string
  tone: 'neutral' | 'ok' | 'warn'
}

function getKindLabel(kind: SavedSyndicationFeedKind): string {
  switch (kind) {
    case 'auto':
      return tApp('syndicationAutoDetect')
    case 'rss':
      return tApp('syndicationKindRss')
    case 'atom':
      return tApp('syndicationKindAtom')
    case 'rdf':
      return tApp('syndicationKindRdf')
    case 'json':
      return tApp('syndicationKindJsonFeed')
    case 'podcast':
      return tApp('syndicationKindPodcast')
  }
}

function getSourceTypeLabel(sourceType: SavedSyndicationSourceType): string {
  switch (sourceType) {
    case 'feed':
      return tApp('syndicationFeedSource')
    case 'link':
      return tApp('syndicationLinkSource')
  }
}

function getLinkKindLabel(kind: SavedSyndicationLinkKind): string {
  switch (kind) {
    case 'website':
      return tApp('syndicationWebsite')
    case 'newsletter':
      return tApp('syndicationNewsletter')
    case 'video':
      return tApp('syndicationVideoChannel')
    case 'social':
      return tApp('syndicationSocialProfile')
    case 'podcast-home':
      return tApp('syndicationPodcastHomepage')
    case 'other':
      return tApp('syndicationOther')
  }
}

function getFeedVerifyErrorMessage(errorCode: SyndicationVerifyErrorCode): string {
  switch (errorCode) {
    case 'invalid-url':
      return tApp('syndicationErrorInvalidUrl')
    case 'private-host-blocked':
      return tApp('syndicationErrorPrivateHost')
    case 'network-error':
      return tApp('syndicationErrorNetwork')
    case 'rate-limited':
      return tApp('syndicationErrorRateLimited')
    case 'server-error':
      return tApp('syndicationErrorServer')
    case 'http-error':
      return tApp('syndicationErrorHttp')
    case 'payload-too-large':
      return tApp('syndicationErrorPayloadTooLarge')
    case 'invalid-payload':
      return tApp('syndicationErrorInvalidPayload')
    case 'parse-failed':
      return tApp('syndicationErrorParseFailed')
  }
}

function getDiscoverySourceLabel(source: SyndicationDiscoveredFeedCandidate['via']): string {
  switch (source) {
    case 'direct':
      return tApp('syndicationDirectUrl')
    case 'linked':
      return tApp('syndicationPageLink')
    case 'common':
      return tApp('syndicationCommonPath')
    case 'feedsearch':
      return tApp('syndicationFeedsearch')
  }
}

function getItemWord(count: number): string {
  return tApp(count === 1 ? 'syndicationItemSingular' : 'syndicationItemPlural')
}

function getScopeId(pubkey: string | undefined): string {
  return pubkey?.trim() || 'anon'
}

export default function SyndicationFeedsPage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()
  const scopeId = useMemo(() => getScopeId(currentUser?.pubkey), [currentUser?.pubkey])

  const [feedLinks, setFeedLinks] = useState<SavedSyndicationFeedLink[]>(() => listSavedSyndicationFeedLinks(scopeId))
  const [urlDraft, setUrlDraft] = useState('')
  const [labelDraft, setLabelDraft] = useState('')
  const [sourceTypeDraft, setSourceTypeDraft] = useState<SavedSyndicationSourceType>('feed')
  const [kindDraft, setKindDraft] = useState<SavedSyndicationFeedKind>('auto')
  const [linkKindDraft, setLinkKindDraft] = useState<SavedSyndicationLinkKind>('other')
  const [error, setError] = useState<string | null>(null)

  // Inline-edit state: maps entry id → draft fields
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editUrl, setEditUrl] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const [editSourceType, setEditSourceType] = useState<SavedSyndicationSourceType>('feed')
  const [editKind, setEditKind] = useState<SavedSyndicationFeedKind>('auto')
  const [editLinkKind, setEditLinkKind] = useState<SavedSyndicationLinkKind>('other')
  const [editError, setEditError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const [usedFeedsearchFallback, setUsedFeedsearchFallback] = useState(false)
  const [showRankingReasons, setShowRankingReasons] = useState(() => getShowSyndicationRankingReasons())
  const [discoveredCandidates, setDiscoveredCandidates] = useState<SyndicationDiscoveredFeedCandidate[]>([])
  const [verification, setVerification] = useState<Record<string, VerificationState>>({})

  useEffect(() => {
    setFeedLinks(listSavedSyndicationFeedLinks(scopeId))
  }, [scopeId])

  useEffect(() => {
    const refresh = () => {
      setFeedLinks(listSavedSyndicationFeedLinks(scopeId))
    }

    window.addEventListener(SYNDICATION_FEED_LINKS_UPDATED_EVENT, refresh)
    window.addEventListener('storage', refresh)

    return () => {
      window.removeEventListener(SYNDICATION_FEED_LINKS_UPDATED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [scopeId])

  const handleAddFeed = () => {
    setError(null)
    const saved = saveSyndicationFeedLink({
      url: urlDraft,
      label: labelDraft,
      sourceType: sourceTypeDraft,
      kind: kindDraft,
      linkKind: linkKindDraft,
    }, scopeId)

    if (!saved) {
      setError(tApp('syndicationEnterValidHttps'))
      return
    }

    setUrlDraft('')
    setLabelDraft('')
    setSourceTypeDraft('feed')
    setKindDraft('auto')
    setLinkKindDraft('other')
    setDiscoveredCandidates([])
    setDiscoveryError(null)
    setFeedLinks(listSavedSyndicationFeedLinks(scopeId))
  }

  const handleDiscoverFeeds = async () => {
    setError(null)
    setDiscoveryError(null)
    setDiscoveredCandidates([])
    setUsedFeedsearchFallback(false)

    const rawUrl = urlDraft.trim()
    if (!rawUrl) {
      setDiscoveryError(tApp('syndicationEnterUrlFirst'))
      return
    }

    setDiscovering(true)
    try {
      const result = await discoverSyndicationFeedCandidates(rawUrl)
      if (result.candidates.length === 0) {
        const errorCode = result.errorCode ?? 'parse-failed'
        setDiscoveryError(getFeedVerifyErrorMessage(errorCode))
        return
      }

      setDiscoveredCandidates(result.candidates)
      setUsedFeedsearchFallback(result.usedFeedsearchFallback)
    } catch {
      setDiscoveryError(tApp('syndicationDiscoveryTemporaryError'))
    } finally {
      setDiscovering(false)
    }
  }

  const handleAddDiscoveredFeed = (candidate: SyndicationDiscoveredFeedCandidate) => {
    const saved = saveSyndicationFeedLink({
      url: candidate.url,
      label: candidate.title,
      sourceType: 'feed',
      kind: candidate.format,
    }, scopeId)

    if (!saved) {
      setDiscoveryError(tApp('syndicationAddDiscoveredFailed'))
      return
    }

    setFeedLinks(listSavedSyndicationFeedLinks(scopeId))
    setUrlDraft('')
    setLabelDraft('')
    setSourceTypeDraft('feed')
    setKindDraft('auto')
    setDiscoveredCandidates([])
    setDiscoveryError(null)
    setUsedFeedsearchFallback(false)
  }

  const handleDeleteFeed = (id: string) => {
    removeSyndicationFeedLink(id, scopeId)
    setFeedLinks(listSavedSyndicationFeedLinks(scopeId))
    setVerification((previous) => {
      const next = { ...previous }
      delete next[id]
      return next
    })
  }

  const handleVerifyFeed = async (entry: SavedSyndicationFeedLink) => {
    if (entry.sourceType !== 'feed') {
      setVerification((previous) => ({
        ...previous,
        [entry.id]: {
          loading: false,
          message: tApp('syndicationVerificationFeedOnly'),
          tone: 'warn',
        },
      }))
      return
    }

    setVerification((previous) => ({
      ...previous,
      [entry.id]: {
        loading: true,
        message: tApp('syndicationVerifying'),
        tone: 'neutral',
      },
    }))

    try {
      const result = await verifySyndicationFeed(entry.url)
      const parsed = result.feed
      if (!parsed) {
        setVerification((previous) => ({
          ...previous,
          [entry.id]: {
            loading: false,
            message: getFeedVerifyErrorMessage(result.errorCode ?? 'parse-failed'),
            tone: 'warn',
          },
        }))
        return
      }

      const itemCount = parsed.items.length
      const podcastDetected = Boolean(parsed.podcast) || parsed.items.some((item) => Boolean(item.podcast))
      const kindMismatch = entry.kind !== 'auto' && entry.kind !== 'podcast' && entry.kind !== parsed.format
      const podcastMismatch = entry.kind === 'podcast' && !podcastDetected

      let message = tApp('syndicationDetectedWithItems', {
        format: parsed.format.toUpperCase(),
        count: itemCount,
        itemWord: getItemWord(itemCount),
        podcastSuffix: podcastDetected ? tApp('syndicationPodcastMetadataSuffix') : '',
      })
      let tone: VerificationState['tone'] = 'ok'

      if (kindMismatch) {
        message = `${message}${tApp('syndicationSavedTypeMismatch', {
          savedType: getKindLabel(entry.kind),
          detectedType: parsed.format.toUpperCase(),
        })}`
        tone = 'warn'
      } else if (podcastMismatch) {
        message = `${message}${tApp('syndicationSavedPodcastMismatch')}`
        tone = 'warn'
      }

      setVerification((previous) => ({
        ...previous,
        [entry.id]: {
          loading: false,
          message,
          tone,
        },
      }))
    } catch {
      setVerification((previous) => ({
        ...previous,
        [entry.id]: {
          loading: false,
          message: tApp('syndicationVerifyNetworkError'),
          tone: 'warn',
        },
      }))
    }
  }

  const handleStartEdit = (entry: SavedSyndicationFeedLink) => {
    setEditingId(entry.id)
    setEditUrl(entry.url)
    setEditLabel(entry.label)
    setEditSourceType(entry.sourceType)
    setEditKind(entry.kind)
    setEditLinkKind(entry.linkKind)
    setEditError(null)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditError(null)
  }

  const handleSaveEdit = (entry: SavedSyndicationFeedLink) => {
    setEditError(null)
    const saved = saveSyndicationFeedLink({
      id: entry.id,
      url: editUrl,
      label: editLabel,
      sourceType: editSourceType,
      kind: editKind,
      linkKind: editLinkKind,
    }, scopeId)

    if (!saved) {
      setEditError(tApp('syndicationEnterValidHttps'))
      return
    }

    setEditingId(null)
    setFeedLinks(listSavedSyndicationFeedLinks(scopeId))
  }

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
            aria-label={tApp('syndicationGoBack')}
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
            <h1 className="text-[20px] font-semibold text-[rgb(var(--color-label))]">
              {tApp('syndicationTitle')}
            </h1>
            <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
              {tApp('syndicationSubtitle')}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 pb-10 pt-2">
        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('syndicationAddSourceSection')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">{tApp('syndicationSourceType')}</span>
              <select
                value={sourceTypeDraft}
                onChange={(event) => setSourceTypeDraft(event.target.value as SavedSyndicationSourceType)}
                className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
              >
                {(['feed', 'link'] as const).map((sourceType) => (
                  <option key={sourceType} value={sourceType}>{getSourceTypeLabel(sourceType)}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
                {sourceTypeDraft === 'feed' ? tApp('syndicationFeedUrlLabel') : tApp('syndicationSourceUrlLabel')}
              </span>
              <input
                type="url"
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                placeholder={sourceTypeDraft === 'feed' ? tApp('syndicationFeedPlaceholder') : tApp('syndicationSourcePlaceholder')}
                className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
              />
            </label>
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
              {tApp('syndicationSourceHint')}
            </p>

            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">{tApp('syndicationLabelOptional')}</span>
              <input
                type="text"
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                placeholder={tApp('syndicationLabelPlaceholder')}
                className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
              />
            </label>

            {sourceTypeDraft === 'feed' ? (
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">{tApp('syndicationFeedType')}</span>
                <select
                  value={kindDraft}
                  onChange={(event) => setKindDraft(event.target.value as SavedSyndicationFeedKind)}
                  className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                >
                  {(['auto', 'rss', 'atom', 'rdf', 'json', 'podcast'] as const).map((kind) => (
                    <option key={kind} value={kind}>{getKindLabel(kind)}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">{tApp('syndicationLinkType')}</span>
                <select
                  value={linkKindDraft}
                  onChange={(event) => setLinkKindDraft(event.target.value as SavedSyndicationLinkKind)}
                  className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                >
                  {(['website', 'newsletter', 'video', 'social', 'podcast-home', 'other'] as const).map((kind) => (
                    <option key={kind} value={kind}>{getLinkKindLabel(kind)}</option>
                  ))}
                </select>
              </label>
            )}

            {sourceTypeDraft === 'feed' && (
              <label className="flex items-start gap-3 rounded-[12px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-3">
                <div className="mt-0.5 flex-1">
                  <p className="text-[13px] font-medium text-[rgb(var(--color-label))]">
                    {tApp('syndicationShowRankingReasons')}
                  </p>
                  <p className="mt-1 text-[12px] text-[rgb(var(--color-label-secondary))]">
                    {tApp('syndicationShowRankingReasonsHint')}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showRankingReasons}
                  onClick={() => {
                    const next = !showRankingReasons
                    setShowRankingReasons(next)
                    setShowSyndicationRankingReasons(next)
                  }}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${showRankingReasons
                    ? 'border-[rgb(var(--color-system-green)/0.5)] bg-[rgb(var(--color-system-green)/0.28)]'
                    : 'border-[rgb(var(--color-fill)/0.24)] bg-[rgb(var(--color-fill)/0.14)]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${showRankingReasons ? 'translate-x-6' : 'translate-x-1'}`}
                  />
                </button>
              </label>
            )}

            {sourceTypeDraft === 'feed' && (
              <button
                type="button"
                onClick={() => { void handleDiscoverFeeds() }}
                disabled={discovering}
                className="rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-4 py-2.5 text-[14px] font-medium text-[rgb(var(--color-label))] active:opacity-80 disabled:opacity-50"
              >
                {discovering ? tApp('syndicationDiscovering') : tApp('syndicationDiscoverFeeds')}
              </button>
            )}

            {error && (
              <p className="text-[13px] text-[rgb(var(--color-system-red))]">{error}</p>
            )}

            {discoveryError && (
              <p className="text-[13px] text-[rgb(var(--color-system-red))]">{discoveryError}</p>
            )}

            {discoveredCandidates.length > 0 && (
              <div className="space-y-2 rounded-[12px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-3">
                <p className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
                  {tApp('syndicationDiscoveredFeedsRanked')}
                </p>
                {usedFeedsearchFallback && (
                  <p className="text-[11px] text-[rgb(var(--color-label-tertiary))]">
                    {tApp('syndicationFallbackProvider')}{' '}
                    <a
                      href="https://feedsearch.dev"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {tApp('syndicationPoweredByFeedsearch')}
                    </a>
                  </p>
                )}
                {discoveredCandidates.map((candidate, index) => (
                  <div key={`${candidate.url}:${index}`} className="rounded-[10px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg))] p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-[rgb(var(--color-label))]">{candidate.title}</p>
                        <p className="truncate text-[11px] text-[rgb(var(--color-label-tertiary))]">{candidate.url}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-[rgb(var(--color-fill)/0.1)] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--color-label-secondary))]">
                            {candidate.format.toUpperCase()}
                          </span>
                          <span className="rounded-full bg-[rgb(var(--color-fill)/0.1)] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--color-label-secondary))]">
                            {tApp('syndicationItemsCount', {
                              count: candidate.itemCount,
                              itemWord: getItemWord(candidate.itemCount),
                            })}
                          </span>
                          <span className="rounded-full bg-[rgb(var(--color-fill)/0.1)] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--color-label-secondary))]">
                            {getDiscoverySourceLabel(candidate.via)}
                          </span>
                          {showRankingReasons && candidate.rankingReasons.slice(0, 3).map((reason) => (
                            <span
                              key={`${candidate.url}:${reason}`}
                              className="rounded-full bg-[rgb(var(--color-system-blue)/0.12)] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--color-system-blue))]"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddDiscoveredFeed(candidate)}
                        className="shrink-0 rounded-[9px] border border-[rgb(var(--color-fill)/0.18)] px-2.5 py-1 text-[11px] font-medium text-[rgb(var(--color-label))] active:opacity-80"
                      >
                        {tApp('syndicationAddButton')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleAddFeed}
              className="rounded-[14px] bg-[rgb(var(--color-label))] px-4 py-2.5 text-[14px] font-medium text-[rgb(var(--color-bg))] active:opacity-80"
            >
              {tApp('syndicationAddSourceButton')}
            </button>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('syndicationSavedSources')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            {feedLinks.length === 0 ? (
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                {tApp('syndicationNoSavedSources')}
              </p>
            ) : (
              feedLinks.map((entry) => {
                const status = verification[entry.id]
                const isEditing = editingId === entry.id
                const sourceTypeLabel = getSourceTypeLabel(entry.sourceType)
                const sourceKindLabel = entry.sourceType === 'feed' ? getKindLabel(entry.kind) : getLinkKindLabel(entry.linkKind)
                return (
                  <div
                    key={entry.id}
                    className="rounded-[14px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg))] p-3"
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <p className="text-[13px] font-semibold text-[rgb(var(--color-label))]">{tApp('syndicationEditSource')}</p>

                        <label className="block">
                          <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">{tApp('syndicationSourceType')}</span>
                          <select
                            value={editSourceType}
                            onChange={(event) => setEditSourceType(event.target.value as SavedSyndicationSourceType)}
                            className="w-full rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                          >
                            {(['feed', 'link'] as const).map((sourceType) => (
                              <option key={sourceType} value={sourceType}>{getSourceTypeLabel(sourceType)}</option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">{tApp('syndicationUrl')}</span>
                          <input
                            type="url"
                            value={editUrl}
                            onChange={(event) => setEditUrl(event.target.value)}
                            className="w-full rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">{tApp('syndicationLabelOptional')}</span>
                          <input
                            type="text"
                            value={editLabel}
                            onChange={(event) => setEditLabel(event.target.value)}
                            className="w-full rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                          />
                        </label>

                        {editSourceType === 'feed' ? (
                          <label className="block">
                            <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">{tApp('syndicationFeedType')}</span>
                            <select
                              value={editKind}
                              onChange={(event) => setEditKind(event.target.value as SavedSyndicationFeedKind)}
                              className="w-full rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                            >
                              {(['auto', 'rss', 'atom', 'rdf', 'json', 'podcast'] as const).map((kind) => (
                                <option key={kind} value={kind}>{getKindLabel(kind)}</option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <label className="block">
                            <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">{tApp('syndicationLinkType')}</span>
                            <select
                              value={editLinkKind}
                              onChange={(event) => setEditLinkKind(event.target.value as SavedSyndicationLinkKind)}
                              className="w-full rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                            >
                              {(['website', 'newsletter', 'video', 'social', 'podcast-home', 'other'] as const).map((kind) => (
                                <option key={kind} value={kind}>{getLinkKindLabel(kind)}</option>
                              ))}
                            </select>
                          </label>
                        )}

                        {editError && (
                          <p className="text-[12px] text-[rgb(var(--color-system-red))]">{editError}</p>
                        )}

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(entry)}
                            className="rounded-[10px] bg-[rgb(var(--color-label))] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-bg))] active:opacity-80"
                          >
                            {tApp('syndicationSave')}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            className="rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))] active:opacity-80"
                          >
                            {tApp('syndicationCancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-medium text-[rgb(var(--color-label))]">{entry.label}</p>
                            <p className="truncate text-[12px] text-[rgb(var(--color-label-tertiary))]">{entry.url}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <span className="inline-flex rounded-full bg-[rgb(var(--color-fill)/0.1)] px-2.5 py-1 text-[11px] font-medium text-[rgb(var(--color-label-secondary))]">
                                {sourceTypeLabel}
                              </span>
                              <span className="inline-flex rounded-full bg-[rgb(var(--color-fill)/0.1)] px-2.5 py-1 text-[11px] font-medium text-[rgb(var(--color-label-secondary))]">
                                {sourceKindLabel}
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {entry.sourceType === 'feed' && (
                              <button
                                type="button"
                                onClick={() => { void handleVerifyFeed(entry) }}
                                disabled={status?.loading}
                                className="rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))] active:opacity-80 disabled:opacity-50"
                              >
                                {status?.loading ? tApp('syndicationChecking') : tApp('syndicationVerify')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleStartEdit(entry)}
                              className="rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))] active:opacity-80"
                            >
                              {tApp('syndicationEdit')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteFeed(entry.id)}
                              className="rounded-[10px] border border-[rgb(var(--color-system-red)/0.25)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-system-red))] active:opacity-80"
                            >
                              {tApp('syndicationRemove')}
                            </button>
                          </div>
                        </div>

                        {status?.message && (
                          <p className={`mt-2 text-[12px] ${status.tone === 'ok' ? 'text-[rgb(var(--color-system-green))]' : status.tone === 'warn' ? 'text-[rgb(var(--color-system-red))]' : 'text-[rgb(var(--color-label-secondary))]'}`}>
                            {status.message}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
