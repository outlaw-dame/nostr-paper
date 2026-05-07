import { useEffect, useState } from 'react'
import {
  getCachedPlatformCapabilities,
  refreshPlatformCapabilities,
  type PlatformCapabilities,
} from '@/lib/runtime/platformCapabilities'

export function usePlatformCapabilities(): PlatformCapabilities {
  const [capabilities, setCapabilities] = useState<PlatformCapabilities>(() => getCachedPlatformCapabilities())

  useEffect(() => {
    const update = () => setCapabilities(refreshPlatformCapabilities())
    const standaloneQuery = window.matchMedia('(display-mode: standalone)')
    const fullscreenQuery = window.matchMedia('(display-mode: fullscreen)')
    const minimalUiQuery = window.matchMedia('(display-mode: minimal-ui)')

    update()
    standaloneQuery.addEventListener('change', update)
    fullscreenQuery.addEventListener('change', update)
    minimalUiQuery.addEventListener('change', update)
    window.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)

    return () => {
      standaloneQuery.removeEventListener('change', update)
      fullscreenQuery.removeEventListener('change', update)
      minimalUiQuery.removeEventListener('change', update)
      window.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
    }
  }, [])

  return capabilities
}
