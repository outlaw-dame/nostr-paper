import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePlatformCapabilities } from '@/hooks/usePlatformCapabilities'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export interface PwaInstallPromptState {
  canPromptInstall: boolean
  isStandalone: boolean
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
}

export function usePwaInstallPrompt(): PwaInstallPromptState {
  const capabilities = usePlatformCapabilities()
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }

    const handleAppInstalled = () => {
      setInstallEvent(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!installEvent) return 'unavailable'
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    setInstallEvent(null)
    return choice.outcome
  }, [installEvent])

  const canPromptInstall = useMemo(
    () => !capabilities.isStandalone && installEvent !== null,
    [capabilities.isStandalone, installEvent],
  )

  return {
    canPromptInstall,
    isStandalone: capabilities.isStandalone,
    promptInstall,
  }
}
