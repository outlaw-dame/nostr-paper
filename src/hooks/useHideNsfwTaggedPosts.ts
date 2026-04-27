import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/contexts/app-context'
import {
  getHideNsfwTaggedPostsEnabled,
  NSFW_TAG_SETTING_UPDATED_EVENT,
} from '@/lib/moderation/nsfwSettings'

export function useHideNsfwTaggedPosts(): boolean {
  const { currentUser } = useApp()
  const scopeId = useMemo(() => currentUser?.pubkey ?? 'anon', [currentUser?.pubkey])
  // Default true so the very first render is already filtered — avoids a flash
  // of NSFW content before the effect reads the persisted setting.
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    setEnabled(getHideNsfwTaggedPostsEnabled(scopeId))

    const onUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ scopeId?: string }>
      if ((customEvent.detail?.scopeId ?? 'anon') !== scopeId) return
      setEnabled(getHideNsfwTaggedPostsEnabled(scopeId))
    }

    const onStorage = (event: StorageEvent) => {
      if (!event.key) return
      if (!event.key.endsWith(`:${scopeId}`)) return
      setEnabled(getHideNsfwTaggedPostsEnabled(scopeId))
    }

    window.addEventListener(NSFW_TAG_SETTING_UPDATED_EVENT, onUpdated as EventListener)
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(NSFW_TAG_SETTING_UPDATED_EVENT, onUpdated as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [scopeId])

  return enabled
}
