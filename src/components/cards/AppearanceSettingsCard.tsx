import React, { useEffect, useState } from 'react'
import { saveTheme, loadTheme, type Theme } from '@/lib/theme'

export function AppearanceSettingsCard() {
  const [theme, setTheme] = useState<Theme>('system')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    loadTheme().then(t => {
      setTheme(t)
      setLoaded(true)
    })
  }, [])

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme)
    void saveTheme(newTheme)
  }

  if (!loaded) {
    return (
      <div className="rounded-[20px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] p-4">
        <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
          Loading appearance settings…
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-[20px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] p-4">
      <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
        Appearance
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
        Choose how Nostr Paper looks to you. Select a single theme, or sync with your system.
      </p>

      <div className="mt-4">
        <label className="text-[13px] font-medium text-[rgb(var(--color-label))]">
          Theme
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ThemeButton label="Light" value="light" current={theme} onClick={handleThemeChange} />
          <ThemeButton label="Dim" value="dim" current={theme} onClick={handleThemeChange} />
          <ThemeButton label="Dark" value="dark" current={theme} onClick={handleThemeChange} />
          <ThemeButton label="System" value="system" current={theme} onClick={handleThemeChange} />
        </div>
      </div>
    </div>
  )
}

function ThemeButton({
  label,
  value,
  current,
  onClick,
}: {
  label: string
  value: Theme
  current: Theme
  onClick: (theme: Theme) => void
}) {
  const isSelected = value === current
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`
        rounded-xl border-2 p-3 text-center transition-colors
        ${isSelected
          ? 'border-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10'
          : 'border-transparent bg-[rgb(var(--color-bg))] hover:bg-[rgb(var(--color-fill)/0.05)]'
        }
      `}
    >
      <span className={`
        text-[14px] font-semibold
        ${isSelected ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-label))]'}
      `}>
        {label}
      </span>
    </button>
  )
}