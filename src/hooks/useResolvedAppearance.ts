import { useEffect, useState } from 'react'
import {
  applyTheme,
  getAppliedTheme,
  loadTheme,
  resolveThemePreference,
  THEME_CHANGED_EVENT,
  type ResolvedTheme,
  type Theme,
} from '@/lib/theme'

function getThemeFromEvent(event: Event): Theme | null {
  const detail = (event as CustomEvent<{ theme?: Theme }>).detail
  return detail?.theme ?? null
}

export function useResolvedAppearance(): ResolvedTheme {
  const [appearance, setAppearance] = useState<ResolvedTheme>(() => getAppliedTheme())

  useEffect(() => {
    let mounted = true

    const applyPreference = (theme: Theme) => {
      const resolved = resolveThemePreference(theme)
      applyTheme(theme)
      if (mounted) setAppearance(resolved)
    }

    loadTheme()
      .then(applyPreference)
      .catch(() => applyPreference('system'))

    const handleThemeChanged = (event: Event) => {
      const theme = getThemeFromEvent(event)
      if (theme) applyPreference(theme)
    }

    const handleSystemThemeChanged = () => {
      loadTheme()
        .then((theme) => {
          if (theme === 'system') applyPreference('system')
        })
        .catch(() => applyPreference('system'))
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    window.addEventListener(THEME_CHANGED_EVENT, handleThemeChanged)
    mediaQuery.addEventListener('change', handleSystemThemeChanged)

    return () => {
      mounted = false
      window.removeEventListener(THEME_CHANGED_EVENT, handleThemeChanged)
      mediaQuery.removeEventListener('change', handleSystemThemeChanged)
    }
  }, [])

  return appearance
}
