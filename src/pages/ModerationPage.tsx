import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { useApp } from '@/contexts/app-context'
import { useKeywordFilters } from '@/hooks/useKeywordFilters'
import { useMuteList } from '@/hooks/useMuteList'
import { useProfile } from '@/hooks/useProfile'
import { useHideNsfwTaggedPosts } from '@/hooks/useHideNsfwTaggedPosts'
import { tApp } from '@/lib/i18n/app'
import {
  dismissMonthlyReportReviewReminder,
  generateMonthlyModerationReport,
  getLatestGeneratedMonthlyReport,
  getMonthlyStarterPackStats,
  shouldShowMonthlyReportReviewReminder,
} from '@/lib/moderation/monthlyReport'
import { setHideNsfwTaggedPostsEnabled } from '@/lib/moderation/nsfwSettings'
import {
  MODERATION_WARNING_SOURCES_UPDATED_EVENT,
  getModerationWarningSourceSettings,
  setModerationWarningSourceSettings,
} from '@/lib/moderation/warningSourceSettings'
import type { FilterAction, FilterScope, KeywordFilter } from '@/lib/filters/types'

interface StarterPackReportSummary {
  evaluatedPackCount: number
  blockedPackAuthorCount: number
  blockedProfileCount: number
  lastComputedAt: number | null
}

interface ModerationMonthlyReportState {
  monthKey: string
  generatedAt: number | null
  reportText: string | null
  starterPack: StarterPackReportSummary
}

function getActionLabel(action: FilterAction): string {
  switch (action) {
    case 'hide':
      return tApp('moderationActionHide')
    case 'warn':
      return tApp('moderationActionWarn')
    case 'block':
      return tApp('moderationActionBlock')
  }
}

function getScopeLabel(scope: FilterScope): string {
  switch (scope) {
    case 'any':
      return tApp('moderationScopeEverywhere')
    case 'content':
      return tApp('moderationScopeContentOnly')
    case 'author':
      return tApp('moderationScopeAuthorOnly')
    case 'hashtag':
      return tApp('moderationScopeHashtagsOnly')
  }
}

function formatExpiry(ts: number): string {
  const diff = ts - Date.now()
  if (diff <= 0) return tApp('moderationExpired')
  const days = Math.floor(diff / (24 * 60 * 60 * 1_000))
  if (days > 0) return tApp('moderationDaysLeft', { count: days })
  const hrs = Math.floor(diff / (60 * 60 * 1_000))
  if (hrs > 0) return tApp('moderationHoursLeft', { count: hrs })
  return tApp('moderationExpiringSoon')
}

function toStarterPackSummary(input: {
  evaluatedPackCount: number
  blockedPackAuthorCount: number
  blockedProfileCount: number
  lastComputedAt: number | null
}): StarterPackReportSummary {
  return {
    evaluatedPackCount: input.evaluatedPackCount,
    blockedPackAuthorCount: input.blockedPackAuthorCount,
    blockedProfileCount: input.blockedProfileCount,
    lastComputedAt: input.lastComputedAt,
  }
}

function FilterItem({ filter }: { filter: KeywordFilter }) {
  const expired = filter.expiresAt !== null && filter.expiresAt < Date.now()
  return (
    <div className={`rounded-[14px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] px-3 py-2.5 ${expired ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <p className="truncate text-[14px] font-medium text-[rgb(var(--color-label))]">
          {filter.term}
        </p>
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${filter.action === 'hide' ? 'bg-[rgb(var(--color-system-red)/0.12)] text-[rgb(var(--color-system-red))]' : 'bg-[rgb(var(--color-system-yellow)/0.16)] text-[rgb(160_120_0)]'}`}>
          {getActionLabel(filter.action)}
        </span>
        {!filter.enabled && (
          <span className="shrink-0 rounded-full bg-[rgb(var(--color-fill)/0.12)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[rgb(var(--color-label-secondary))]">
            {tApp('moderationOff')}
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-[rgb(var(--color-label-tertiary))]">
        {getScopeLabel(filter.scope)}
        {filter.semantic ? ` · ${tApp('moderationSemanticShort')}` : ''}
        {filter.wholeWord ? ` · ${tApp('moderationWholeWordShort')}` : ''}
        {filter.expiresAt !== null ? ` · ${formatExpiry(filter.expiresAt)}` : ''}
      </p>
    </div>
  )
}

function MutedUserRow({
  pubkey,
  onUnmute,
  busy,
}: {
  pubkey: string
  onUnmute: (pubkey: string) => Promise<void>
  busy: boolean
}) {
  const { profile } = useProfile(pubkey)
  return (
    <div className="rounded-[14px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <AuthorRow pubkey={pubkey} profile={profile} actions />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onUnmute(pubkey)}
          className="shrink-0 rounded-full border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg-secondary))] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-label))] disabled:opacity-50"
        >
          {tApp('moderationUnmute')}
        </button>
      </div>
    </div>
  )
}

export default function ModerationPage() {
  const navigate = useNavigate()
  const { currentUser } = useApp()
  const { filters, loading: filtersLoading } = useKeywordFilters()
  const { mutedPubkeys, loading: muteListLoading, unmute } = useMuteList()
  const hideNsfwTaggedPosts = useHideNsfwTaggedPosts()
  const [warningSources, setWarningSources] = useState(() => getModerationWarningSourceSettings())
  const [busyPubkeys, setBusyPubkeys] = useState<Set<string>>(new Set())
  const [reportCopied, setReportCopied] = useState(false)
  const [autoReportNotice, setAutoReportNotice] = useState<string | null>(null)
  const [reportState, setReportState] = useState<ModerationMonthlyReportState>(() => {
    const scopeId = currentUser?.pubkey ?? 'anon'
    const latest = getLatestGeneratedMonthlyReport(scopeId)
    const starterPack = getMonthlyStarterPackStats(scopeId)
    return {
      monthKey: latest.monthKey,
      generatedAt: latest.generatedAt,
      reportText: latest.reportText,
      starterPack: toStarterPackSummary(starterPack),
    }
  })

  useEffect(() => {
    const refresh = () => setWarningSources(getModerationWarningSourceSettings())
    const handleUpdated = () => refresh()
    window.addEventListener(MODERATION_WARNING_SOURCES_UPDATED_EVENT, handleUpdated)
    return () => window.removeEventListener(MODERATION_WARNING_SOURCES_UPDATED_EVENT, handleUpdated)
  }, [])

  useEffect(() => {
    const scopeId = currentUser?.pubkey ?? 'anon'
    const latest = getLatestGeneratedMonthlyReport(scopeId)
    const starterPack = getMonthlyStarterPackStats(scopeId)
    setReportState({
      monthKey: latest.monthKey,
      generatedAt: latest.generatedAt,
      reportText: latest.reportText,
      starterPack: toStarterPackSummary(starterPack),
    })

    if (shouldShowMonthlyReportReviewReminder(scopeId, latest.monthKey)) {
      setAutoReportNotice('AI generated your first monthly moderation report. Please check it below.')
    } else {
      setAutoReportNotice(null)
    }
  }, [currentUser?.pubkey])

  const mutedList = useMemo(() => Array.from(mutedPubkeys), [mutedPubkeys])

  const sortedFilters = useMemo(() => {
    return [...filters].sort((a, b) => {
      const aExpired = a.expiresAt !== null && a.expiresAt < Date.now()
      const bExpired = b.expiresAt !== null && b.expiresAt < Date.now()
      if (aExpired !== bExpired) return aExpired ? 1 : -1
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return a.createdAt - b.createdAt
    })
  }, [filters])

  const activeFilterCount = useMemo(
    () => filters.filter((f) => f.enabled && (f.expiresAt === null || f.expiresAt > Date.now())).length,
    [filters],
  )

  useEffect(() => {
    if (filtersLoading || muteListLoading) return

    const scopeId = currentUser?.pubkey ?? 'anon'
    const latest = getLatestGeneratedMonthlyReport(scopeId)
    if (latest.generatedAt !== null && latest.reportText) {
      if (shouldShowMonthlyReportReviewReminder(scopeId, latest.monthKey)) {
        setAutoReportNotice('AI generated your first monthly moderation report. Please check it below.')
      }
      return
    }

    const generated = generateMonthlyModerationReport({
      scopeId,
      activeFilterCount,
      totalFilterCount: sortedFilters.length,
      mutedUsersCount: mutedList.length,
      hideNsfwTaggedPostsEnabled: hideNsfwTaggedPosts,
      warningSources,
    })

    setReportCopied(false)
    setReportState({
      monthKey: generated.monthKey,
      generatedAt: generated.generatedAt,
      reportText: generated.reportText,
      starterPack: toStarterPackSummary(generated.starterPack),
    })
    setAutoReportNotice('AI generated your first monthly moderation report. Please check it below.')
  }, [
    activeFilterCount,
    currentUser?.pubkey,
    filtersLoading,
    hideNsfwTaggedPosts,
    warningSources,
    muteListLoading,
    mutedList.length,
    sortedFilters.length,
  ])

  async function handleUnmute(pubkey: string): Promise<void> {
    setBusyPubkeys((prev) => new Set(prev).add(pubkey))
    try {
      await unmute(pubkey)
    } catch (error) {
      console.error(tApp('moderationUnmuteFailedLog'), error)
      alert(tApp('moderationUnmuteFailedAlert'))
    } finally {
      setBusyPubkeys((prev) => {
        const next = new Set(prev)
        next.delete(pubkey)
        return next
      })
    }
  }

  function handleGenerateMonthlyReport(): void {
    const scopeId = currentUser?.pubkey ?? 'anon'
    const generated = generateMonthlyModerationReport({
      scopeId,
      activeFilterCount,
      totalFilterCount: sortedFilters.length,
      mutedUsersCount: mutedList.length,
      hideNsfwTaggedPostsEnabled: hideNsfwTaggedPosts,
      warningSources,
    })

    setReportCopied(false)
    setReportState({
      monthKey: generated.monthKey,
      generatedAt: generated.generatedAt,
      reportText: generated.reportText,
      starterPack: toStarterPackSummary(generated.starterPack),
    })

    if (shouldShowMonthlyReportReviewReminder(scopeId, generated.monthKey)) {
      setAutoReportNotice('AI generated your first monthly moderation report. Please check it below.')
    }
  }

  function handleDismissMonthlyReportNotice(): void {
    const scopeId = currentUser?.pubkey ?? 'anon'
    dismissMonthlyReportReviewReminder(scopeId, reportState.monthKey)
    setAutoReportNotice(null)
  }

  async function handleCopyMonthlyReport(): Promise<void> {
    if (!reportState.reportText) return

    try {
      await navigator.clipboard.writeText(reportState.reportText)
      setReportCopied(true)
      window.setTimeout(() => setReportCopied(false), 2_000)
    } catch {
      setReportCopied(false)
    }
  }

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="
              app-panel-muted
              h-10 w-10 rounded-full
              text-[rgb(var(--color-label))]
              flex items-center justify-center
              active:opacity-80
            "
            aria-label={tApp('moderationGoBack')}
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
              {tApp('moderationBreadcrumb')}
            </p>
            <h1 className="text-[20px] font-semibold text-[rgb(var(--color-label))]">
              {tApp('moderationTitle')}
            </h1>
          </div>
        </div>
      </div>

      <div className="space-y-8 pb-10 pt-2">
        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('moderationFiltersSection')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            {filtersLoading ? (
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">{tApp('moderationLoadingFilters')}</p>
            ) : sortedFilters.length === 0 ? (
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
                {tApp('moderationNoFilters')}
              </p>
            ) : (
              <>
                <p className="text-[13px] text-[rgb(var(--color-label-secondary))]">
                  {tApp('moderationActiveFiltersSummary', {
                    active: activeFilterCount,
                    total: sortedFilters.length,
                  })}
                </p>
                <div className="space-y-2">
                  {sortedFilters.map((filter) => (
                    <FilterItem key={filter.id} filter={filter} />
                  ))}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => navigate('/settings/moderation/filters')}
              className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-4 py-3 text-[15px] font-medium text-[rgb(var(--color-label))] transition-opacity active:opacity-75"
            >
              {tApp('moderationManageFilters')}
            </button>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('moderationMutedUsersSection')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated">
            {muteListLoading ? (
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">{tApp('moderationLoadingMutedUsers')}</p>
            ) : mutedList.length === 0 ? (
              <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">{tApp('moderationNoMutedUsers')}</p>
            ) : (
              <div className="space-y-3">
                {mutedList.map((pubkey) => (
                  <MutedUserRow
                    key={pubkey}
                    pubkey={pubkey}
                    onUnmute={handleUnmute}
                    busy={busyPubkeys.has(pubkey)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('moderationAutomaticSection')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-5">
            <label className="flex items-start gap-3">
              <div className="mt-0.5 flex-1">
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  {tApp('moderationHideExplicit')}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                  {tApp('moderationHideExplicitHint')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={hideNsfwTaggedPosts}
                onClick={() => setHideNsfwTaggedPostsEnabled(!hideNsfwTaggedPosts)}
                className="
                  shrink-0 mt-0.5 w-11 h-6 rounded-full
                  transition-colors duration-200
                "
                style={{
                  backgroundColor: hideNsfwTaggedPosts
                    ? 'rgb(var(--color-system-green))'
                    : 'rgb(var(--color-fill-secondary) / 0.3)',
                }}
              >
                <span
                  className="block w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{ transform: `translateX(${hideNsfwTaggedPosts ? 22 : 2}px)` }}
                />
              </button>
            </label>

            <label className="flex items-start gap-3">
              <div className="mt-0.5 flex-1">
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  {tApp('moderationAiWarnings')}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                  {tApp('moderationAiWarningsHint')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={warningSources.aiLabelsEnabled}
                onClick={() => setModerationWarningSourceSettings({ aiLabelsEnabled: !warningSources.aiLabelsEnabled })}
                className="
                  shrink-0 mt-0.5 w-11 h-6 rounded-full
                  transition-colors duration-200
                "
                style={{
                  backgroundColor: warningSources.aiLabelsEnabled
                    ? 'rgb(var(--color-system-green))'
                    : 'rgb(var(--color-fill-secondary) / 0.3)',
                }}
              >
                <span
                  className="block w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{ transform: `translateX(${warningSources.aiLabelsEnabled ? 22 : 2}px)` }}
                />
              </button>
            </label>

            <label className="flex items-start gap-3">
              <div className="mt-0.5 flex-1">
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  {tApp('moderationNetworkReportWarnings')}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                  {tApp('moderationNetworkReportWarningsHint')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={warningSources.networkReportWarningsEnabled}
                onClick={() => setModerationWarningSourceSettings({ networkReportWarningsEnabled: !warningSources.networkReportWarningsEnabled })}
                className="
                  shrink-0 mt-0.5 w-11 h-6 rounded-full
                  transition-colors duration-200
                "
                style={{
                  backgroundColor: warningSources.networkReportWarningsEnabled
                    ? 'rgb(var(--color-system-green))'
                    : 'rgb(var(--color-fill-secondary) / 0.3)',
                }}
              >
                <span
                  className="block w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{ transform: `translateX(${warningSources.networkReportWarningsEnabled ? 22 : 2}px)` }}
                />
              </button>
            </label>

            <label className="flex items-start gap-3">
              <div className="mt-0.5 flex-1">
                <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
                  {tApp('moderationNetworkLabelWarnings')}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
                  {tApp('moderationNetworkLabelWarningsHint')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={warningSources.networkLabelWarningsEnabled}
                onClick={() => setModerationWarningSourceSettings({ networkLabelWarningsEnabled: !warningSources.networkLabelWarningsEnabled })}
                className="
                  shrink-0 mt-0.5 w-11 h-6 rounded-full
                  transition-colors duration-200
                "
                style={{
                  backgroundColor: warningSources.networkLabelWarningsEnabled
                    ? 'rgb(var(--color-system-green))'
                    : 'rgb(var(--color-fill-secondary) / 0.3)',
                }}
              >
                <span
                  className="block w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                  style={{ transform: `translateX(${warningSources.networkLabelWarningsEnabled ? 22 : 2}px)` }}
                />
              </button>
            </label>

            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {tApp('moderationAutomaticSummary')}
            </p>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">Monthly moderation report</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-4">
            {autoReportNotice && (
              <div className="flex items-start justify-between gap-3 rounded-[14px] border border-[rgb(var(--color-system-yellow)/0.45)] bg-[rgb(var(--color-system-yellow)/0.12)] px-3 py-2.5">
                <p className="text-[13px] leading-5 text-[rgb(var(--color-label))]">{autoReportNotice}</p>
                <button
                  type="button"
                  onClick={handleDismissMonthlyReportNotice}
                  className="shrink-0 rounded-full border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-2.5 py-1 text-[12px] font-medium text-[rgb(var(--color-label-secondary))] transition-opacity active:opacity-75"
                >
                  Dismiss
                </button>
              </div>
            )}

            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              Generate a comprehensive monthly report from your current moderation settings and starter pack filtering impact.
            </p>

            <div className="rounded-[14px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[13px] text-[rgb(var(--color-label-secondary))] space-y-1">
              <p>Month: {reportState.monthKey}</p>
              <p>
                Last generated:{' '}
                {reportState.generatedAt ? new Date(reportState.generatedAt).toLocaleString() : 'Not generated yet'}
              </p>
              <p>Starter packs evaluated: {reportState.starterPack.evaluatedPackCount}</p>
              <p>Pack authors filtered: {reportState.starterPack.blockedPackAuthorCount}</p>
              <p>Pack member accounts filtered: {reportState.starterPack.blockedProfileCount}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleGenerateMonthlyReport}
                className="rounded-[14px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-4 py-2 text-[14px] font-medium text-[rgb(var(--color-label))] transition-opacity active:opacity-75"
              >
                Generate monthly report
              </button>

              <button
                type="button"
                disabled={!reportState.reportText}
                onClick={() => void handleCopyMonthlyReport()}
                className="rounded-[14px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg-secondary))] px-4 py-2 text-[14px] font-medium text-[rgb(var(--color-label))] transition-opacity active:opacity-75 disabled:opacity-50"
              >
                {reportCopied ? 'Copied' : 'Copy report'}
              </button>
            </div>

            {reportState.reportText && (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-[14px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[12px] leading-6 text-[rgb(var(--color-label-secondary))]">
                {reportState.reportText}
              </pre>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
