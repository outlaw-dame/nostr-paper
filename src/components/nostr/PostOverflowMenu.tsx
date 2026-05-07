import { useEffect, useRef, useState } from 'react'
import { ReportSheet } from '@/components/nostr/ReportSheet'
import { useApp } from '@/contexts/app-context'
import { useMuteList } from '@/hooks/useMuteList'
import type { NostrEvent, Profile } from '@/types'

interface PostOverflowMenuProps {
  event: NostrEvent
  profile: Profile | null
  tone?: 'default' | 'inverse'
  className?: string
}

export function PostOverflowMenu({
  event,
  profile,
  tone = 'default',
  className = '',
}: PostOverflowMenuProps) {
  const { currentUser } = useApp()
  const { isMuted, mute, unmute } = useMuteList()
  const [menuOpen, setMenuOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reported, setReported] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const isSelf = currentUser?.pubkey === event.pubkey
  const muted = isMuted(event.pubkey)
  const displayName = profile?.display_name ?? profile?.name ?? `${event.pubkey.slice(0, 8)}...`
  const canMute = Boolean(currentUser && !isSelf)
  const inverseTone = tone === 'inverse'

  useEffect(() => {
    if (!menuOpen) return

    const handleOutsidePointerDown = (pointerEvent: PointerEvent) => {
      if (!menuRef.current?.contains(pointerEvent.target as Node)) {
        setMenuOpen(false)
      }
    }

    const handleEscape = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handleOutsidePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [menuOpen])

  const handleMuteToggle = async () => {
    if (!canMute) return
    if (muted) {
      await unmute(event.pubkey)
    } else if (window.confirm(`Mute ${displayName}?`)) {
      await mute(event.pubkey)
    }
    setMenuOpen(false)
  }

  const buttonToneClasses = inverseTone
    ? 'border-white/24 bg-white/12 text-white/90 hover:bg-white/20 hover:text-white'
    : 'border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-fill)/0.04)] text-[rgb(var(--color-label-secondary))] hover:bg-[rgb(var(--color-fill)/0.1)] hover:text-[rgb(var(--color-label))]'

  return (
    <>
      <div
        ref={menuRef}
        className={`relative shrink-0 ${className}`}
        onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Post actions"
          aria-expanded={menuOpen}
          onClick={(clickEvent) => {
            clickEvent.preventDefault()
            clickEvent.stopPropagation()
            setMenuOpen((open) => !open)
          }}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${buttonToneClasses}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>

        {menuOpen && (
          <div
            className="absolute right-0 top-9 z-20 min-w-[172px] rounded-[14px] border border-[rgb(var(--color-fill)/0.14)] bg-[rgb(var(--color-bg-secondary))] p-1.5 shadow-lg"
            role="menu"
          >
            {canMute && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center rounded-[10px] px-3 py-2 text-left text-[13px] font-medium text-[rgb(var(--color-label))] transition-colors hover:bg-[rgb(var(--color-fill)/0.08)]"
                onClick={(clickEvent) => {
                  clickEvent.preventDefault()
                  clickEvent.stopPropagation()
                  void handleMuteToggle()
                }}
              >
                {muted ? 'Unmute author' : 'Mute author'}
              </button>
            )}

            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-[10px] px-3 py-2 text-left text-[13px] font-medium text-[rgb(var(--color-system-red))] transition-colors hover:bg-[rgb(var(--color-system-red)/0.08)] disabled:cursor-not-allowed disabled:opacity-45"
              disabled={reported}
              onClick={(clickEvent) => {
                clickEvent.preventDefault()
                clickEvent.stopPropagation()
                setMenuOpen(false)
                setReportOpen(true)
              }}
            >
              {reported ? 'Reported' : 'Report post'}
            </button>
          </div>
        )}
      </div>

      <ReportSheet
        open={reportOpen}
        target={{ type: 'event', event }}
        onClose={() => setReportOpen(false)}
        onPublished={() => {
          setReported(true)
          setReportOpen(false)
        }}
      />
    </>
  )
}