import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TwemojiText } from '@/components/ui/TwemojiText'
import {
  TranslationServiceError,
  getProviderDisplayName,
  translateConfiguredText,
  type TranslationResult,
} from '@/lib/translation/client'
import { TRANSLATION_SETTINGS_UPDATED_EVENT } from '@/lib/translation/storage'

interface TranslateTextPanelProps {
  text: string
  className?: string
}

export function TranslateTextPanel({
  text,
  className = '',
}: TranslateTextPanelProps) {
  const [result, setResult] = useState<TranslationResult | null>(null)
  const [hidden, setHidden] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsVersion, setSettingsVersion] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const trimmedText = text.trim()

  useEffect(() => {
    setResult(null)
    setHidden(false)
    setError(null)
    abortRef.current?.abort()
  }, [text])

  useEffect(() => {
    const browserWindow = typeof globalThis.window === 'undefined' ? null : globalThis.window
    if (!browserWindow) return

    const handleSettingsChanged = () => {
      abortRef.current?.abort()
      setResult(null)
      setHidden(false)
      setError(null)
      setSettingsVersion(version => version + 1)
    }

    browserWindow.addEventListener(TRANSLATION_SETTINGS_UPDATED_EVENT, handleSettingsChanged)
    return () => {
      browserWindow.removeEventListener(TRANSLATION_SETTINGS_UPDATED_EVENT, handleSettingsChanged)
    }
  }, [])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!trimmedText) return

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const translated = await translateConfiguredText(trimmedText, controller.signal)
        if (controller.signal.aborted) return
        setResult(translated)
      } catch (translationError) {
        if (controller.signal.aborted) return

        if (
          translationError instanceof TranslationServiceError &&
          (translationError.code === 'config' || translationError.code === 'unavailable')
        ) {
          setResult(null)
          setError(null)
          return
        }

        const message = translationError instanceof TranslationServiceError
          ? translationError.message
          : translationError instanceof Error
            ? translationError.message
            : 'Translation failed.'
        setError(message)
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    })()

    return () => controller.abort()
  }, [trimmedText, settingsVersion])

  const providerLabel = result ? getProviderDisplayName(result.provider) : null
  const detectedLanguage = result?.detectedSourceLanguage
  const sourceLabel = detectedLanguage || (result?.sourceLanguage !== 'auto' ? result?.sourceLanguage : null)

  const sameLanguage = useMemo(() => {
    if (!result) return false
    const source = (detectedLanguage ?? result.sourceLanguage).split('-')[0]?.toLowerCase()
    const target = result.targetLanguage.split('-')[0]?.toLowerCase()
    return Boolean(source && target && source === target)
  }, [detectedLanguage, result])

  if (!trimmedText) return null
  if (sameLanguage) return null

  return (
    <div className={`mt-3 ${className}`} onClick={e => e.stopPropagation()}>
      {/* Loading — subtle inline indicator */}
      {loading && !result && (
        <p className="text-[13px] italic text-[rgb(var(--color-label-tertiary))]">
          Translating…
        </p>
      )}

      {/* Error — minimal inline */}
      {error && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[12px] text-[rgb(var(--color-system-red))]">
            Translation failed
          </span>
          <button
            type="button"
            onClick={() => setSettingsVersion(version => version + 1)}
            className="text-[12px] font-medium text-[rgb(var(--color-system-red))] underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Result — phanpy-style inline */}
      {result && (
        <>
          <hr className="border-t border-[rgb(var(--color-fill)/0.10)]" />

          {!hidden && (
            <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-[1.6] text-[rgb(var(--color-label))]">
              <TwemojiText text={result.translatedText} />
            </p>
          )}

          <p className="mt-2 text-[12px] text-[rgb(var(--color-label-tertiary))]">
            {sourceLabel ? `Translated from ${sourceLabel}` : 'Translated'}
            {' · '}
            {providerLabel}
            {' · '}
            <button
              type="button"
              onClick={() => setHidden(prev => !prev)}
              className="font-medium text-[#007AFF]"
            >
              {hidden ? 'Show translation' : 'Hide'}
            </button>
          </p>
        </>
      )}
    </div>
  )
}
