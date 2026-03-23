import { createStore, get, set } from 'idb-keyval'

export type Theme = 'light' | 'dark' | 'dim' | 'system'

const THEME_DB_NAME = 'nostr-paper-ui'
const THEME_STORE = createStore(THEME_DB_NAME, 'settings')
const THEME_KEY = 'ui-theme'

export const THEME_CHANGED_EVENT = 'nostr-paper:theme-changed'

function getSystemTheme(): Exclude<Theme, 'system'> {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return

  const effectiveTheme = theme === 'system' ? getSystemTheme() : theme
  document.documentElement.dataset.theme = effectiveTheme

  // Update meta theme-color for PWA chrome to match the new background.
  // We need to wait a tick for CSS variables to apply.
  setTimeout(() => {
    const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()
    if (themeColor) {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', `rgb(${themeColor})`)
    }
  }, 1)
}

export async function loadTheme(): Promise<Theme> {
  if (typeof indexedDB === 'undefined') return 'system'
  try {
    const storedTheme = await get<Theme>(THEME_KEY, THEME_STORE)
    return storedTheme ?? 'system'
  } catch {
    return 'system'
  }
}

export async function saveTheme(theme: Theme): Promise<void> {
  if (typeof indexedDB !== 'undefined') {
    try {
      await set(THEME_KEY, theme, THEME_STORE)
    } catch {
      // Fallback to session-only
    }
  }
  applyTheme(theme)
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: { theme } }))
}

let mediaQueryListener: ((this: MediaQueryList, ev: MediaQueryListEvent) => any) | null = null

export function initTheme(): void {
  if (typeof window === 'undefined') return

  loadTheme().then(theme => {
    applyTheme(theme)

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    if (mediaQueryListener) mediaQuery.removeEventListener('change', mediaQueryListener)
    mediaQueryListener = () => loadTheme().then(t => t === 'system' && applyTheme('system'))
    mediaQuery.addEventListener('change', mediaQueryListener)
  }).catch(() => applyTheme('system'))
}