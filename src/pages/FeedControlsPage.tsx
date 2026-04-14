import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  loadDiscoveryControls,
  resetDiscoveryControls,
  saveDiscoveryControls,
  type DiscoveryControls,
} from '@/lib/explore/discoveryControls'

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
              Feed Controls
            </h1>
            <p className="mt-1 text-[13px] text-[rgb(var(--color-label-secondary))]">
              Tune Explore ranking formulas for trends, suggestions, and follow packs.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 pb-10 pt-2">
        <section>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <p className="text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
              Changes apply immediately to Explore and are saved on this device.
            </p>
            <button
              type="button"
              onClick={() => setControls(resetDiscoveryControls())}
              className="rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] px-3 py-2 text-[13px] font-semibold text-[rgb(var(--color-label))] active:opacity-80"
            >
              Reset Defaults
            </button>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">Trending Topics</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              Trending blends popularity, author diversity, freshness, and momentum to better capture what is currently rising.
            </p>
            <WeightSlider
              label="Popularity"
              value={controls.trending.popularity}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                trending: { ...previous.trending, popularity: value },
              }))}
            />
            <WeightSlider
              label="Diversity"
              value={controls.trending.diversity}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                trending: { ...previous.trending, diversity: value },
              }))}
            />
            <WeightSlider
              label="Freshness"
              value={controls.trending.freshness}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                trending: { ...previous.trending, freshness: value },
              }))}
            />
            <WeightSlider
              label="Momentum"
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
              Dominant long-running topics are intentionally preserved; freshness is a soft influence, not a hard suppression.
            </p>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">Suggested Accounts</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              Suggestions blend social graph strength with semantic affinity from posts, hashtags, and bios.
            </p>
            <WeightSlider
              label="Social Weight"
              value={controls.suggested.social}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                suggested: { ...previous.suggested, social: value },
              }))}
            />
            <WeightSlider
              label="Semantic Weight"
              value={controls.suggested.semantic}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                suggested: { ...previous.suggested, semantic: value },
              }))}
            />
            <WeightSlider
              label="Semantic: Keyword"
              value={controls.suggested.keyword}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                suggested: { ...previous.suggested, keyword: value },
              }))}
            />
            <WeightSlider
              label="Semantic: Hashtag"
              value={controls.suggested.hashtag}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                suggested: { ...previous.suggested, hashtag: value },
              }))}
            />
            <WeightSlider
              label="Semantic: Bio"
              value={controls.suggested.bio}
              onChange={(value) => updateControls((previous) => ({
                ...previous,
                suggested: { ...previous.suggested, bio: value },
              }))}
            />
            <WeightSlider
              label="Semantic: Language"
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
              Suggestions do not require a minimum post count. If local posts are sparse, profile metadata still contributes to semantic matching.
            </p>
          </div>
        </section>

        <section>
          <h2 className="section-kicker px-1 mb-3">Follow Packs</h2>
          <div className="app-panel rounded-ios-xl p-4 card-elevated space-y-3">
            <p className="text-[14px] leading-6 text-[rgb(var(--color-label-secondary))]">
              Follow Packs are ranked with social overlap, freshness, metadata quality, and semantic affinity.
            </p>
            <BoostSlider
              label="Semantic Boost"
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
              Semantic affinity compares your recent interests and profile signals with pack author/preview profile content. It has no hard minimum-post requirement.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
