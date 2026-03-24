import { useCallback, useEffect, useState } from 'react'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { BlossomUpload } from '@/components/blossom/BlossomUpload'
import { useApp } from '@/contexts/app-context'
import { getNDK } from '@/lib/nostr/ndk'
import { withRetry } from '@/lib/retry'
import {
  isSafeMediaURL,
  isSafeURL,
  isValidNip05Format,
  sanitizeAbout,
  sanitizeName,
} from '@/lib/security/sanitize'
import type { Profile } from '@/types'

interface ProfileMetadataEditorProps {
  pubkey: string
  profile: Profile | null
}

export function ProfileMetadataEditor({ pubkey, profile }: ProfileMetadataEditorProps) {
  const { currentUser } = useApp()
  const [name, setName] = useState(profile?.name ?? '')
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [about, setAbout] = useState(profile?.about ?? '')
  const [website, setWebsite] = useState(profile?.website ?? '')
  const [picture, setPicture] = useState(profile?.picture ?? '')
  const [banner, setBanner] = useState(profile?.banner ?? '')
  const [nip05, setNip05] = useState(profile?.nip05 ?? '')
  const [lud16, setLud16] = useState(profile?.lud16 ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Sync state with profile when it loads, if the user hasn't started editing
  useEffect(() => {
    if (profile) {
      setName((prev) => (prev === '' ? profile.name ?? '' : prev))
      setDisplayName((prev) => (prev === '' ? profile.display_name ?? '' : prev))
      setAbout((prev) => (prev === '' ? profile.about ?? '' : prev))
      setWebsite((prev) => (prev === '' ? profile.website ?? '' : prev))
      setPicture((prev) => (prev === '' ? profile.picture ?? '' : prev))
      setBanner((prev) => (prev === '' ? profile.banner ?? '' : prev))
      setNip05((prev) => (prev === '' ? profile.nip05 ?? '' : prev))
      setLud16((prev) => (prev === '' ? profile.lud16 ?? '' : prev))
    }
  }, [profile])

  const handleSave = useCallback(async () => {
    if (!currentUser || currentUser.pubkey !== pubkey) {
      setError('You can only edit your own profile.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const sanitizedName = sanitizeName(name)
      const sanitizedDisplayName = sanitizeName(displayName)
      const sanitizedAbout = sanitizeAbout(about)
      
      // Validation
      if (picture && !isSafeMediaURL(picture)) throw new Error('Invalid picture URL (must be HTTPS and an image type).')
      if (banner && !isSafeMediaURL(banner)) throw new Error('Invalid banner URL (must be HTTPS and an image type).')
      if (website && !isSafeURL(website)) throw new Error('Invalid website URL (must start with https://).')
      if (nip05 && !isValidNip05Format(nip05)) throw new Error('Invalid NIP-05 identifier format.')

      const content = {
        name: sanitizedName,
        display_name: sanitizedDisplayName,
        about: sanitizedAbout,
        website: website.trim(),
        picture: picture.trim(),
        banner: banner.trim(),
        nip05: nip05.trim(),
        lud16: lud16.trim(),
      }

      const ndk = getNDK()
      const event = new NDKEvent(ndk)
      event.kind = 0
      event.content = JSON.stringify(content)
      
      await withRetry(() => event.publish(), {
        maxAttempts: 3,
        baseDelayMs: 1000,
      })

      setSuccess(true)
    } catch (err) {
      console.error('Failed to publish profile metadata', err)
      setError(err instanceof Error ? err.message : 'Failed to publish profile updates.')
    } finally {
      setSaving(false)
    }
  }, [currentUser, pubkey, name, displayName, about, website, picture, banner, nip05, lud16])

  const inputClass = "mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[15px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none transition-colors focus:border-[rgb(var(--color-accent))]"
  const labelClass = "block text-[13px] font-medium text-[rgb(var(--color-label-secondary))]"

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="username"
          />
        </div>
        <div>
          <label className={labelClass}>Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
            placeholder="Display Name"
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Bio (About)</label>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          className={`${inputClass} min-h-[100px] resize-y`}
          placeholder="Tell the world about yourself..."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Picture URL</label>
          <input
            type="url"
            value={picture}
            onChange={(e) => setPicture(e.target.value)}
            className={inputClass}
            placeholder="https://example.com/avatar.jpg"
          />
          <div className="mt-3 overflow-hidden rounded-[14px] border border-[rgb(var(--color-fill)/0.12)]">
            <BlossomUpload
              accept="image/*"
              onUploaded={(blob) => setPicture(blob.url)}
              disabled={saving}
              className="border-none bg-[rgb(var(--color-bg-secondary))]"
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>Banner URL</label>
          <input
            type="url"
            value={banner}
            onChange={(e) => setBanner(e.target.value)}
            className={inputClass}
            placeholder="https://example.com/banner.jpg"
          />
          <div className="mt-3 overflow-hidden rounded-[14px] border border-[rgb(var(--color-fill)/0.12)]">
            <BlossomUpload
              accept="image/*"
              onUploaded={(blob) => setBanner(blob.url)}
              disabled={saving}
              className="border-none bg-[rgb(var(--color-bg-secondary))]"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>NIP-05 Identifier</label>
          <input
            type="text"
            value={nip05}
            onChange={(e) => setNip05(e.target.value)}
            className={inputClass}
            placeholder="user@domain.com"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
        <div>
          <label className={labelClass}>Lightning Address (LUD16)</label>
          <input
            type="text"
            value={lud16}
            onChange={(e) => setLud16(e.target.value)}
            className={inputClass}
            placeholder="user@wallet.com"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Website</label>
        <input
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className={inputClass}
          placeholder="https://example.com"
        />
      </div>

      {error && (
        <p className="text-[13px] text-[rgb(var(--color-system-red))]">{error}</p>
      )}
      
      {success && (
        <p className="text-[13px] text-[rgb(var(--color-system-green))]">Profile updated successfully. It may take a moment to propagate.</p>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving}
        className="w-full rounded-[14px] bg-[rgb(var(--color-label))] px-4 py-3 text-[15px] font-medium text-white transition-opacity active:opacity-75 disabled:opacity-40"
      >
        {saving ? 'Publishing...' : 'Save Profile'}
      </button>
    </div>
  )
}