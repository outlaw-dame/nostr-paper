const SHOW_RANKING_REASONS_KEY = 'nostr-paper:syndication:show-ranking-reasons'

export function getShowSyndicationRankingReasons(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SHOW_RANKING_REASONS_KEY) === '1'
}

export function setShowSyndicationRankingReasons(value: boolean): void {
  if (typeof window === 'undefined') return
  if (value) {
    window.localStorage.setItem(SHOW_RANKING_REASONS_KEY, '1')
  } else {
    window.localStorage.removeItem(SHOW_RANKING_REASONS_KEY)
  }
}