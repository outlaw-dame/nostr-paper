const SHOW_TRENDING_REASONS_KEY = 'nostr-paper:explore:show-trending-reasons'
export const TRENDING_REASONS_UPDATED_EVENT = 'nostr-paper:explore-trending-reasons-updated'

export function getShowTrendingReasons(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SHOW_TRENDING_REASONS_KEY) === '1'
}

export function setShowTrendingReasons(value: boolean): void {
  if (typeof window === 'undefined') return
  if (value) {
    window.localStorage.setItem(SHOW_TRENDING_REASONS_KEY, '1')
  } else {
    window.localStorage.removeItem(SHOW_TRENDING_REASONS_KEY)
  }
  window.dispatchEvent(new Event(TRENDING_REASONS_UPDATED_EVENT))
}