import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthorRow } from '@/components/profile/AuthorRow'
import { useKeywordFilters } from '@/hooks/useKeywordFilters'
import { useMuteList } from '@/hooks/useMuteList'
import { useProfile } from '@/hooks/useProfile'
import { useHideNsfwTaggedPosts } from '@/hooks/useHideNsfwTaggedPosts'
import { tApp } from '@/lib/i18n/app'
import { setHideNsfwTaggedPostsEnabled } from '@/lib/moderation/nsfwSettings'
import type { FilterAction, FilterScope, KeywordFilter } from '@/lib/filters/types'

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
  const { filters, loading: filtersLoading } = useKeywordFilters()
  const { mutedPubkeys, loading: muteListLoading, unmute } = useMuteList()
  const hideNsfwTaggedPosts = useHideNsfwTaggedPosts()
  const [busyPubkeys, setBusyPubkeys] = useState<Set<string>>(new Set())

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
            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {tApp('moderationAutomaticSummary')}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
