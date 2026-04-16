import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/contexts/app-context'
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

const KIND_LABELS: Record<SavedSyndicationFeedKind, string> = {
  auto: 'Auto-detect',
  rss: 'RSS',
  atom: 'Atom',
  rdf: 'RDF',
  json: 'JSON Feed',
  podcast: 'Podcasting 2.0',
}

const SOURCE_TYPE_LABELS: Record<SavedSyndicationSourceType, string> = {
  feed: 'Feed Source',
  link: 'Link Source',
}

const LINK_KIND_LABELS: Record<SavedSyndicationLinkKind, string> = {
  website: 'Website',
  newsletter: 'Newsletter',
  video: 'Video Channel',
  social: 'Social Profile',
  'podcast-home': 'Podcast Homepage',
  other: 'Other',
}

const FEED_VERIFY_ERROR_MESSAGE: Record<SyndicationVerifyErrorCode, string> = {
  'invalid-url': 'Invalid URL. Use a valid HTTPS URL.',
  'private-host-blocked': 'Private and localhost feed URLs are blocked outside local development.',
  'network-error': 'Network error while fetching the feed. Please retry.',
  'rate-limited': 'Feed host rate limited this request. Retry in a moment.',
  'server-error': 'Feed host returned a temporary server error. Please retry.',
  'http-error': 'Feed host rejected this URL.',
  'payload-too-large': 'Feed is too large to process safely.',
  'invalid-payload': 'Feed response payload was invalid.',
  'parse-failed': 'Could not parse this URL as RSS, Atom, RDF, or JSON Feed.',
}

const DISCOVERY_SOURCE_LABELS: Record<SyndicationDiscoveredFeedCandidate['via'], string> = {
  direct: 'Direct URL',
  linked: 'Page link',
  common: 'Common path',
  feedsearch: 'Feedsearch',
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
      setError('Enter a valid HTTPS source URL.')
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
      setDiscoveryError('Enter a URL first.')
      return
    }

    setDiscovering(true)
    try {
      const result = await discoverSyndicationFeedCandidates(rawUrl)
      if (result.candidates.length === 0) {
        const errorCode = result.errorCode ?? 'parse-failed'
        setDiscoveryError(FEED_VERIFY_ERROR_MESSAGE[errorCode])
        return
      }

      setDiscoveredCandidates(result.candidates)
      setUsedFeedsearchFallback(result.usedFeedsearchFallback)
    } catch {
      setDiscoveryError('Feed discovery failed due to a temporary network error.')
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
      setDiscoveryError('Could not add this discovered feed URL.')
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
          message: 'Verification is only available for feed sources.',
          tone: 'warn',
        },
      }))
      return
    }

    setVerification((previous) => ({
      ...previous,
      [entry.id]: {
        loading: true,
        message: 'Verifying feed…',
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
            message: FEED_VERIFY_ERROR_MESSAGE[result.errorCode ?? 'parse-failed'],
            tone: 'warn',
          },
        }))
        return
      }

      const itemCount = parsed.items.length
      const podcastDetected = Boolean(parsed.podcast) || parsed.items.some((item) => Boolean(item.podcast))
      const kindMismatch = entry.kind !== 'auto' && entry.kind !== 'podcast' && entry.kind !== parsed.format
      const podcastMismatch = entry.kind === 'podcast' && !podcastDetected

      let message = `${parsed.format.toUpperCase()} feed detected with ${itemCount} item${itemCount === 1 ? '' : 's'}${podcastDetected ? ' (Podcast metadata found)' : ''}.`
      let tone: VerificationState['tone'] = 'ok'

      if (kindMismatch) {
        message = `${message} Saved type is ${KIND_LABELS[entry.kind]}, but detected ${parsed.format.toUpperCase()}.`
        tone = 'warn'
      } else if (podcastMismatch) {
        message = `${message} Saved type is Podcasting 2.0, but no podcast namespace metadata was found.`
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
          message: 'Feed verification failed due to a temporary network error.',
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
      setEditError('Enter a valid HTTPS source URL.')
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
            aria-label="Go back"
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
              Syndication Feeds
            </h1>
            <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
              Save RSS, Atom, RDF, JSON Feed, podcast feeds, and supporting source links for quick reuse.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 pb-10 pt-2">
        <section>
          <h2 className="section-kicker px-1 mb-3">Add Source</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Source Type</span>
              <select
                value={sourceTypeDraft}
                onChange={(event) => setSourceTypeDraft(event.target.value as SavedSyndicationSourceType)}
                className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
              >
                {Object.entries(SOURCE_TYPE_LABELS).map(([sourceType, label]) => (
                  <option key={sourceType} value={sourceType}>{label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">
                {sourceTypeDraft === 'feed' ? 'Feed URL' : 'Source URL'}
              </span>
              <input
                type="url"
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                placeholder={sourceTypeDraft === 'feed' ? 'https://example.com/feed.xml' : 'https://example.com'}
                className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
              />
            </label>
            <p className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
              Save direct feed URLs or related source links. Feed verification can parse RSS, Atom, RDF, JSON Feed, and Podcasting 2.0 metadata.
            </p>

            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Label (optional)</span>
              <input
                type="text"
                value={labelDraft}
                onChange={(event) => setLabelDraft(event.target.value)}
                placeholder="My podcast feed"
                className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
              />
            </label>

            {sourceTypeDraft === 'feed' ? (
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Feed Type</span>
                <select
                  value={kindDraft}
                  onChange={(event) => setKindDraft(event.target.value as SavedSyndicationFeedKind)}
                  className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                >
                  {Object.entries(KIND_LABELS).map(([kind, label]) => (
                    <option key={kind} value={kind}>{label}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Link Type</span>
                <select
                  value={linkKindDraft}
                  onChange={(event) => setLinkKindDraft(event.target.value as SavedSyndicationLinkKind)}
                  className="w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                >
                  {Object.entries(LINK_KIND_LABELS).map(([kind, label]) => (
                    <option key={kind} value={kind}>{label}</option>
                  ))}
                </select>
              </label>
            )}

            {sourceTypeDraft === 'feed' && (
              <label className="flex items-start gap-3 rounded-[12px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-3">
                <div className="mt-0.5 flex-1">
                  <p className="text-[13px] font-medium text-[rgb(var(--color-label))]">
                    Show ranking reasons
                  </p>
                  <p className="mt-1 text-[12px] text-[rgb(var(--color-label-secondary))]">
                    Opt-in to show why each discovered feed ranked where it did.
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
                {discovering ? 'Discovering…' : 'Discover Feeds'}
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
                  Discovered feeds (ranked)
                </p>
                {usedFeedsearchFallback && (
                  <p className="text-[11px] text-[rgb(var(--color-label-tertiary))]">
                    Fallback provider:{' '}
                    <a
                      href="https://feedsearch.dev"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      powered by feedsearch.dev
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
                            {candidate.itemCount} items
                          </span>
                          <span className="rounded-full bg-[rgb(var(--color-fill)/0.1)] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--color-label-secondary))]">
                            {DISCOVERY_SOURCE_LABELS[candidate.via]}
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
                        Add
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
              Add Source
            </button>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">Saved Sources</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            {feedLinks.length === 0 ? (
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                No saved sources yet.
              </p>
            ) : (
              feedLinks.map((entry) => {
                const status = verification[entry.id]
                const isEditing = editingId === entry.id
                const sourceTypeLabel = SOURCE_TYPE_LABELS[entry.sourceType]
                const sourceKindLabel = entry.sourceType === 'feed' ? KIND_LABELS[entry.kind] : LINK_KIND_LABELS[entry.linkKind]
                return (
                  <div
                    key={entry.id}
                    className="rounded-[14px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg))] p-3"
                  >
                    {isEditing ? (
                      <div className="space-y-3">
                        <p className="text-[13px] font-semibold text-[rgb(var(--color-label))]">Edit Source</p>

                        <label className="block">
                          <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Source Type</span>
                          <select
                            value={editSourceType}
                            onChange={(event) => setEditSourceType(event.target.value as SavedSyndicationSourceType)}
                            className="w-full rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                          >
                            {Object.entries(SOURCE_TYPE_LABELS).map(([st, label]) => (
                              <option key={st} value={st}>{label}</option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">URL</span>
                          <input
                            type="url"
                            value={editUrl}
                            onChange={(event) => setEditUrl(event.target.value)}
                            className="w-full rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Label</span>
                          <input
                            type="text"
                            value={editLabel}
                            onChange={(event) => setEditLabel(event.target.value)}
                            className="w-full rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                          />
                        </label>

                        {editSourceType === 'feed' ? (
                          <label className="block">
                            <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Feed Type</span>
                            <select
                              value={editKind}
                              onChange={(event) => setEditKind(event.target.value as SavedSyndicationFeedKind)}
                              className="w-full rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                            >
                              {Object.entries(KIND_LABELS).map(([k, label]) => (
                                <option key={k} value={k}>{label}</option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <label className="block">
                            <span className="mb-1 block text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Link Type</span>
                            <select
                              value={editLinkKind}
                              onChange={(event) => setEditLinkKind(event.target.value as SavedSyndicationLinkKind)}
                              className="w-full rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2 text-[13px] text-[rgb(var(--color-label))] outline-none focus:ring-2 focus:ring-[rgb(var(--color-accent)/0.4)]"
                            >
                              {Object.entries(LINK_KIND_LABELS).map(([k, label]) => (
                                <option key={k} value={k}>{label}</option>
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
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            className="rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))] active:opacity-80"
                          >
                            Cancel
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
                                {status?.loading ? 'Checking…' : 'Verify'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleStartEdit(entry)}
                              className="rounded-[10px] border border-[rgb(var(--color-fill)/0.18)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))] active:opacity-80"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteFeed(entry.id)}
                              className="rounded-[10px] border border-[rgb(var(--color-system-red)/0.25)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-system-red))] active:opacity-80"
                            >
                              Remove
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
