import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { getProfile } from '@/lib/db/nostr'
import { publishProfileMetadata } from '@/lib/nostr/metadata'
import type { Nip39ExternalIdentity, Profile, ProfileMetadata } from '@/types'

interface ProfileMetadataEditorProps {
  pubkey: string
  profile: Profile | null
  onSaved?: (profile: Profile | null) => void
}

interface ExternalIdentityEntry {
  platform: string
  identity: string
  proof: string
}

interface ProfileFormState {
  name: string
  display_name: string
  about: string
  picture: string
  banner: string
  website: string
  nip05: string
  lud06: string
  lud16: string
  bot: boolean
  birthdayYear: string
  birthdayMonth: string
  birthdayDay: string
  externalIdentities: ExternalIdentityEntry[]
}

function formStateFromProfile(profile: Profile | null): ProfileFormState {
  return {
    name: profile?.name ?? '',
    display_name: profile?.display_name ?? '',
    about: profile?.about ?? '',
    picture: profile?.picture ?? '',
    banner: profile?.banner ?? '',
    website: profile?.website ?? '',
    nip05: profile?.nip05 ?? '',
    lud06: profile?.lud06 ?? '',
    lud16: profile?.lud16 ?? '',
    bot: profile?.bot === true,
    birthdayYear: profile?.birthday?.year !== undefined ? String(profile.birthday.year) : '',
    birthdayMonth: profile?.birthday?.month !== undefined ? String(profile.birthday.month) : '',
    birthdayDay: profile?.birthday?.day !== undefined ? String(profile.birthday.day) : '',
    externalIdentities: profile?.externalIdentities?.map(id => ({
      platform: id.platform,
      identity: id.identity,
      proof: id.proof ?? '',
    })) ?? [],
  }
}

function formStateToMetadata(form: ProfileFormState): ProfileMetadata {
  const birthdayYear = Number(form.birthdayYear)
  const birthdayMonth = Number(form.birthdayMonth)
  const birthdayDay = Number(form.birthdayDay)

  return {
    ...(form.name.trim() ? { name: form.name } : {}),
    ...(form.display_name.trim() ? { display_name: form.display_name } : {}),
    ...(form.about.trim() ? { about: form.about } : {}),
    ...(form.picture.trim() ? { picture: form.picture.trim() } : {}),
    ...(form.banner.trim() ? { banner: form.banner.trim() } : {}),
    ...(form.website.trim() ? { website: form.website.trim() } : {}),
    ...(form.nip05.trim() ? { nip05: form.nip05.trim() } : {}),
    ...(form.lud06.trim() ? { lud06: form.lud06.trim() } : {}),
    ...(form.lud16.trim() ? { lud16: form.lud16.trim() } : {}),
    ...(form.bot ? { bot: true } : {}),
    ...(
      form.birthdayYear.trim() || form.birthdayMonth.trim() || form.birthdayDay.trim()
        ? {
          birthday: {
            ...(Number.isSafeInteger(birthdayYear) && birthdayYear > 0 ? { year: birthdayYear } : {}),
            ...(Number.isSafeInteger(birthdayMonth) && birthdayMonth > 0 ? { month: birthdayMonth } : {}),
            ...(Number.isSafeInteger(birthdayDay) && birthdayDay > 0 ? { day: birthdayDay } : {}),
          },
        }
        : {}
    ),
  }
}

export function ProfileMetadataEditor({
  pubkey,
  profile,
  onSaved,
}: ProfileMetadataEditorProps) {
  const [form, setForm] = useState<ProfileFormState>(() => formStateFromProfile(profile))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (dirty || saving) return
    setForm(formStateFromProfile(profile))
  }, [profile, dirty, saving])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const updateField = <K extends keyof ProfileFormState>(field: K, value: ProfileFormState[K]) => {
    setDirty(true)
    setMessage(null)
    setError(null)
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleReset = () => {
    if (saving) return
    setForm(formStateFromProfile(profile))
    setDirty(false)
    setMessage(null)
    setError(null)
  }

  const handlePublish = async () => {
    if (saving) return

    const controller = new AbortController()
    abortRef.current = controller
    setSaving(true)
    setMessage(null)
    setError(null)

    try {
      const externalIdentities: Nip39ExternalIdentity[] = form.externalIdentities
        .filter(id => id.platform.trim() && id.identity.trim())
        .map(id => ({
          platform: id.platform.trim(),
          identity: id.identity.trim(),
          ...(id.proof.trim() ? { proof: id.proof.trim() } : {}),
        }))
      await publishProfileMetadata(formStateToMetadata(form), { signal: controller.signal, externalIdentities })
      const fresh = await getProfile(pubkey)
      setForm(formStateFromProfile(fresh))
      setDirty(false)
      setMessage('Kind-0 profile metadata published to your write relays.')
      onSaved?.(fresh)
    } catch (publishError) {
      if (publishError instanceof DOMException && publishError.name === 'AbortError') return
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish kind-0 profile metadata.')
    } finally {
      setSaving(false)
      abortRef.current = null
    }
  }

  return (
    <div className="rounded-[20px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] p-4">
      <p className="text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
        Publishing here replaces your latest kind-0 metadata event. `display_name` is optional, but `name`
        should still be set, so the publisher will fall back to `display_name` when needed.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field
          label="Name"
          value={form.name}
          onChange={(value) => updateField('name', value)}
          placeholder="alice"
        />
        <Field
          label="Display Name"
          value={form.display_name}
          onChange={(value) => updateField('display_name', value)}
          placeholder="Alice Wonderland"
        />
      </div>

      <Field
        label="About"
        value={form.about}
        onChange={(value) => updateField('about', value)}
        placeholder="Short biography"
        multiline
        className="mt-4"
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field
          label="Avatar URL"
          value={form.picture}
          onChange={(value) => updateField('picture', value)}
          placeholder="https://example.com/avatar.jpg"
          type="url"
        />
        <Field
          label="Banner URL"
          value={form.banner}
          onChange={(value) => updateField('banner', value)}
          placeholder="https://example.com/banner.jpg"
          type="url"
        />
        <Field
          label="Website"
          value={form.website}
          onChange={(value) => updateField('website', value)}
          placeholder="https://example.com"
          type="url"
        />
        <Field
          label="NIP-05"
          value={form.nip05}
          onChange={(value) => updateField('nip05', value)}
          placeholder="alice@example.com"
        />
        <Field
          label="LUD16"
          value={form.lud16}
          onChange={(value) => updateField('lud16', value)}
          placeholder="alice@getalby.com"
        />
        <Field
          label="LUD06"
          value={form.lud06}
          onChange={(value) => updateField('lud06', value)}
          placeholder="lnurl1..."
        />
      </div>

      <div className="mt-4 rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={form.bot}
            onChange={(event) => updateField('bot', event.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-[14px] text-[rgb(var(--color-label))]">
            Mark this profile as automated (`bot: true`)
          </span>
        </label>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Field
            label="Birth Year"
            value={form.birthdayYear}
            onChange={(value) => updateField('birthdayYear', value)}
            placeholder="1990"
            inputMode="numeric"
          />
          <Field
            label="Birth Month"
            value={form.birthdayMonth}
            onChange={(value) => updateField('birthdayMonth', value)}
            placeholder="7"
            inputMode="numeric"
          />
          <Field
            label="Birth Day"
            value={form.birthdayDay}
            onChange={(value) => updateField('birthdayDay', value)}
            placeholder="14"
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="mt-4 rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3">
        <p className="text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
          External Identities (NIP-39)
        </p>

        {form.externalIdentities.map((entry, i) => (
          <div key={i} className="mt-3 flex flex-col gap-2 rounded-[12px] border border-[rgb(var(--color-fill)/0.12)] p-2">
            <div className="flex gap-2">
              <label className="flex-1 block">
                <span className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Platform</span>
                <select
                  value={entry.platform}
                  onChange={(event) => {
                    setDirty(true)
                    setMessage(null)
                    setError(null)
                    setForm((current) => {
                      const updated = [...current.externalIdentities]
                      const previous = updated[i]
                      if (!previous) return current
                      updated[i] = {
                        platform: event.target.value,
                        identity: previous.identity,
                        proof: previous.proof,
                      }
                      return { ...current, externalIdentities: updated }
                    })
                  }}
                  className="mt-1 w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] outline-none"
                >
                  <option value="github">GitHub</option>
                  <option value="twitter">Twitter</option>
                  <option value="mastodon">Mastodon</option>
                  <option value="telegram">Telegram</option>
                  {!['github', 'twitter', 'mastodon', 'telegram'].includes(entry.platform) && (
                    <option value={entry.platform}>{entry.platform}</option>
                  )}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setDirty(true)
                  setForm((current) => ({
                    ...current,
                    externalIdentities: current.externalIdentities.filter((_, idx) => idx !== i),
                  }))
                }}
                className="mt-5 self-start rounded-[10px] bg-[rgb(var(--color-system-red)/0.1)] px-3 py-2 text-[13px] text-[rgb(var(--color-system-red))]"
              >
                Remove
              </button>
            </div>
            <label className="block">
              <span className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Handle / Identity</span>
              <input
                type="text"
                value={entry.identity}
                onChange={(event) => {
                  setDirty(true)
                  setMessage(null)
                  setError(null)
                  setForm((current) => {
                    const updated = [...current.externalIdentities]
                    const previous = updated[i]
                    if (!previous) return current
                    updated[i] = {
                      platform: previous.platform,
                      identity: event.target.value,
                      proof: previous.proof,
                    }
                    return { ...current, externalIdentities: updated }
                  })
                }}
                placeholder="your_handle"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="mt-1 w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium text-[rgb(var(--color-label-secondary))]">Proof URL (optional)</span>
              <input
                type="url"
                value={entry.proof}
                onChange={(event) => {
                  setDirty(true)
                  setMessage(null)
                  setError(null)
                  setForm((current) => {
                    const updated = [...current.externalIdentities]
                    const previous = updated[i]
                    if (!previous) return current
                    updated[i] = {
                      platform: previous.platform,
                      identity: previous.identity,
                      proof: event.target.value,
                    }
                    return { ...current, externalIdentities: updated }
                  })
                }}
                placeholder="https://..."
                spellCheck={false}
                className="mt-1 w-full rounded-[12px] border border-[rgb(var(--color-fill)/0.18)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2 text-[14px] text-[rgb(var(--color-label))] placeholder:text-[rgb(var(--color-label-tertiary))] outline-none"
              />
            </label>
          </div>
        ))}

        {form.externalIdentities.length < 10 && (
          <button
            type="button"
            onClick={() => {
              setDirty(true)
              setForm((current) => ({
                ...current,
                externalIdentities: [
                  ...current.externalIdentities,
                  { platform: 'github', identity: '', proof: '' },
                ],
              }))
            }}
            className="mt-3 rounded-[12px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg-secondary))] px-4 py-2 text-[13px] font-medium text-[rgb(var(--color-label))]"
          >
            Add Identity
          </button>
        )}
      </div>

      {message && (
        <p className="mt-3 text-[13px] text-[rgb(var(--color-system-green))]">
          {message}
        </p>
      )}

      {error && (
        <p className="mt-3 text-[13px] text-[rgb(var(--color-system-red))]">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={handleReset}
          disabled={saving || !dirty}
          className="
            flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.2)]
            bg-[rgb(var(--color-bg))] px-4 py-2.5
            text-[14px] font-medium text-[rgb(var(--color-label))]
            transition-opacity active:opacity-75 disabled:opacity-40
          "
        >
          Reset
        </button>

        <button
          type="button"
          onClick={() => void handlePublish()}
          disabled={saving}
          className="
            flex-1 rounded-[14px] bg-[rgb(var(--color-label))]
            px-4 py-2.5 text-[14px] font-medium text-white
            transition-opacity active:opacity-75 disabled:opacity-40
          "
        >
          {saving ? 'Publishing…' : 'Publish Kind 0'}
        </button>
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  className?: string
  multiline?: boolean
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  className = '',
  multiline = false,
  inputMode,
}: FieldProps) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[13px] font-medium text-[rgb(var(--color-label-secondary))]">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={4}
          className="
            mt-2 w-full resize-none rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
            bg-[rgb(var(--color-bg))] px-3 py-2.5
            text-[15px] text-[rgb(var(--color-label))]
            placeholder:text-[rgb(var(--color-label-tertiary))]
            outline-none
          "
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          className="
            mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.18)]
            bg-[rgb(var(--color-bg))] px-3 py-2.5
            text-[15px] text-[rgb(var(--color-label))]
            placeholder:text-[rgb(var(--color-label-tertiary))]
            outline-none
          "
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      )}
    </label>
  )
}
