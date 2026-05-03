import { useEffect, useState } from 'react'

import {
  getRuntimeFeatureFlags,
  refreshRuntimeFeatureFlags,
  subscribeRuntimeFeatureFlags,
  type RuntimeFeatureFlags,
} from '@/lib/runtime/featureFlags'

export function useRuntimeFeatureFlags(): RuntimeFeatureFlags {
  const [flags, setFlags] = useState<RuntimeFeatureFlags>(() => getRuntimeFeatureFlags())

  useEffect(() => {
    const unsubscribe = subscribeRuntimeFeatureFlags(setFlags)
    void refreshRuntimeFeatureFlags()
    return unsubscribe
  }, [])

  return flags
}
