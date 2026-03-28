import { useNavigate } from 'react-router-dom'
import { TranslationSettingsCard } from '@/components/translation/TranslationSettingsCard'

export default function TranslationsPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh bg-[rgb(var(--color-bg))] px-4 pb-safe">
      <div className="sticky top-0 z-10 bg-[rgb(var(--color-bg)/0.88)] py-4 pt-safe backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="
              app-panel-muted
              h-10 w-10 rounded-full
              text-[rgb(var(--color-label))]
              flex items-center justify-center
              active:opacity-80
            "
            aria-label="Go back"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M9.5 3.25L4.75 8l4.75 4.75"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h1 className="text-[20px] font-semibold text-[rgb(var(--color-label))]">
            Translations
          </h1>
        </div>
      </div>

      <div className="space-y-4 pb-10 pt-2">
        <p className="px-1 text-[13px] leading-5 text-[rgb(var(--color-label-secondary))]">
          Configure translation providers and language preferences for inline post translations.
        </p>

        <TranslationSettingsCard />
      </div>
    </div>
  )
}