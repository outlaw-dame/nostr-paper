import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  loadDiscoveryControls,
  resetDiscoveryControls,
  saveDiscoveryControls,
  type DiscoveryControls,
} from '@/lib/explore/discoveryControls'
import {
  getShowSyndicationRankingReasons,
  setShowSyndicationRankingReasons,
} from '@/lib/syndication/settings'
import { tApp } from '@/lib/i18n/app'

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function WeightSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (next: number) => void
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-[12px] text-[rgb(var(--color-label-secondary))]">
        <span>{label}</span>
        <span className="font-semibold text-[rgb(var(--color-label))]">{pct(value)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className="w-full accent-[rgb(var(--color-accent))]"
      />
    </label>
  )
}

function BoostSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (next: number) => void
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-[12px] text-[rgb(var(--color-label-secondary))]">
        <span>{label}</span>
        <span className="font-semibold text-[rgb(var(--color-label))]">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={6}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[rgb(var(--color-accent))]"
      />
    </label>
  )
}

export default function FeedControlsPage() {
  const navigate = useNavigate()
  const [controls, setControls] = useState<DiscoveryControls>(() => loadDiscoveryControls())
  const [showSyndicationRankingReasons, setShowSyndicationRankingReasonsState] = useState(() => getShowSyndicationRankingReasons())

  const updateControls = (updater: (current: DiscoveryControls) => DiscoveryControls) => {
    setControls((current) => saveDiscoveryControls(updater(current)))
  }

  const trendingFormula = useMemo(() => {
    const w = controls.trending
    return `score = popularity * ${w.popularity.toFixed(2)}
      + diversity * ${w.diversity.toFixed(2)}
      + freshness * ${w.freshness.toFixed(2)}
      + momentum * ${w.momentum.toFixed(2)}

momentum = sqrt(popularity * freshness) * 0.60
         + authorBreadth * 0.40`
  }, [controls.trending])

  const suggestedFormula = useMemo(() => {
    const w = controls.suggested
    return `socialScore = (mutualCount / maxMutual) * 0.70
            + (followerCount / maxFollowers) * 0.30

semanticScore = keywordOverlap * ${w.keyword.toFixed(2)}
              + hashtagOverlap * ${w.hashtag.toFixed(2)}
              + bioOverlap * ${w.bio.toFixed(2)}
              + languageOrScriptMatch * ${w.language.toFixed(2)}

finalScore = socialScore * ${w.social.toFixed(2)}
           + semanticScore * ${w.semantic.toFixed(2)}`
  }, [controls.suggested])

  const followPackFormula = useMemo(() => {
    return `baseScore = min(missingProfiles, 12) * 2.4
          + min(overlapProfiles, 5) * 0.7
          + authorFollowedBoost
          + mediaPackBoost
          + freshnessBoost
          + metadataBoost
          + sizeBoost

finalScore = baseScore + semanticAffinity * ${controls.followPacks.semanticBoost.toFixed(2)}`
  }, [controls.followPacks.semanticBoost])

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
            aria-label={tApp('feedControlsGoBack')}
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
              {tApp('feedControlsTitle')}
            </h1>
            <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
              {tApp('feedControlsSubtitle')}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 pb-10 pt-2">
        <section>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <p className="text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {tApp('feedControlsImmediateApply')}
            </p>
            <label className="flex items-start gap-3 rounded-[12px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-3">
              <div className="mt-0.5 flex-1">
                <p className="text-[13px] font-medium text-[rgb(var(--color-label))]">
                  {tApp('feedControlsSyndicationReasons')}
                </p>
                <p className="mt-1 text-[12px] text-[rgb(var(--color-label-secondary))]">
                  {tApp('feedControlsSyndicationReasonsHint')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showSyndicationRankingReasons}
                onClick={() => {
                  const next = !showSyndicationRankingReasons
                  setShowSyndicationRankingReasonsState(next)
                  setShowSyndicationRankingReasons(next)
                }}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${showSyndicationRankingReasons
                  ? 'border-[rgb(var(--color-system-green)/0.5)] bg-[rgb(var(--color-system-green)/0.28)]'
                  : 'border-[rgb(var(--color-fill)/0.24)] bg-[rgb(var(--color-fill)/0.14)]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${showSyndicationRankingReasons ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
            </label>
            <button
              type="button"
              onClick={() => setControls(resetDiscoveryControls())}
              className="rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--color-label))] active:opacity-80"
            >
              {tApp('feedControlsResetDefaults')}
            </button>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('feedControlsTrendingTopics')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {tApp('feedControlsTrendingHint')}
            </p>
            <WeightSlider
              label={tApp('feedControlsPopularity')}
              value={controls.trending.popularity}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                trending: { ...previous.trending, popularity: value },
              }))}
            />
            <WeightSlider
              label={tApp('feedControlsDiversity')}
              value={controls.trending.diversity}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                trending: { ...previous.trending, diversity: value },
              }))}
            />
            <WeightSlider
              label={tApp('feedControlsFreshness')}
              value={controls.trending.freshness}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                trending: { ...previous.trending, freshness: value },
              }))}
            />
            <WeightSlider
              label={tApp('feedControlsMomentum')}
              value={controls.trending.momentum}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                trending: { ...previous.trending, momentum: value },
              }))}
            />
            <pre className="overflow-x-auto rounded-[12px] bg-[rgb(var(--color-bg-secondary))] px-3 py-3 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
{trendingFormula}
            </pre>
            <p className="text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
              {tApp('feedControlsTrendingFootnote')}
            </p>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('feedControlsSuggestedAccounts')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {tApp('feedControlsSuggestedHint')}
            </p>
            <WeightSlider
              label={tApp('feedControlsSocialWeight')}
              value={controls.suggested.social}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                suggested: { ...previous.suggested, social: value },
              }))}
            />
            <WeightSlider
              label={tApp('feedControlsSemanticWeight')}
              value={controls.suggested.semantic}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                suggested: { ...previous.suggested, semantic: value },
              }))}
            />
            <WeightSlider
              label={tApp('feedControlsSemanticKeyword')}
              value={controls.suggested.keyword}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                suggested: { ...previous.suggested, keyword: value },
              }))}
            />
            <WeightSlider
              label={tApp('feedControlsSemanticHashtag')}
              value={controls.suggested.hashtag}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                suggested: { ...previous.suggested, hashtag: value },
              }))}
            />
            <WeightSlider
              label={tApp('feedControlsSemanticBio')}
              value={controls.suggested.bio}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                suggested: { ...previous.suggested, bio: value },
              }))}
            />
            <WeightSlider
              label={tApp('feedControlsSemanticLanguage')}
              value={controls.suggested.language}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                suggested: { ...previous.suggested, language: value },
              }))}
            />
            <pre className="overflow-x-auto rounded-[12px] bg-[rgb(var(--color-bg-secondary))] px-3 py-3 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
{suggestedFormula}
            </pre>
            <p className="text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
              {tApp('feedControlsSuggestedFootnote')}
            </p>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">{tApp('feedControlsFollowPacks')}</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              {tApp('feedControlsFollowPacksHint')}
            </p>
            <BoostSlider
              label={tApp('feedControlsSemanticBoost')}
              value={controls.followPacks.semanticBoost}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                followPacks: {
                  ...previous.followPacks,
                  semanticBoost: value,
                },
              }))}
            />
            <pre className="overflow-x-auto rounded-[12px] bg-[rgb(var(--color-bg-secondary))] px-3 py-3 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
{followPackFormula}
            </pre>
            <p className="text-[12px] leading-5 text-[rgb(var(--color-label-tertiary))]">
              {tApp('feedControlsFollowPacksFootnote')}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
