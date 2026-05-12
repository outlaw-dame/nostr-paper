import { useMemo } from 'react'
import { resolvePlatformUX } from '@/design/platform/resolvePlatformUX'
import { usePlatformCapabilities } from '@/hooks/usePlatformCapabilities'
import type { PlatformUX } from '@/design/platform/platformTypes'

export function usePlatformUX(): PlatformUX {
  const capabilities = usePlatformCapabilities()
  return useMemo(() => resolvePlatformUX(capabilities), [capabilities])
}
