import { useEffect, useState } from 'react'

import {
  SOURCE_EXPOSURE_UPDATED_EVENT,
  summarizeSourceExposure,
  type SourceExposureSummary,
} from '@/lib/media/sourceExposure'

export function useSourceExposureSummary(days = 14): SourceExposureSummary {
  const [summary, setSummary] = useState<SourceExposureSummary>(() => summarizeSourceExposure(days))

  useEffect(() => {
    const refresh = () => setSummary(summarizeSourceExposure(days))
    const onVisibilityChange = () => {
      if (!document.hidden) refresh()
    }

    window.addEventListener(SOURCE_EXPOSURE_UPDATED_EVENT, refresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
    refresh()

    return () => {
      window.removeEventListener(SOURCE_EXPOSURE_UPDATED_EVENT, refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [days])

  return summary
}
