import { useEffect } from 'react'

import { refreshRuntimeFeatureFlags } from '@/lib/runtime/featureFlags'

const SYNC_INTERVAL_MS = 60_000

export function RuntimeFeatureFlagSync() {
  useEffect(() => {
    void refreshRuntimeFeatureFlags(true)

    const intervalId = window.setInterval(() => {
      void refreshRuntimeFeatureFlags()
    }, SYNC_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void refreshRuntimeFeatureFlags(true)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return null
}
