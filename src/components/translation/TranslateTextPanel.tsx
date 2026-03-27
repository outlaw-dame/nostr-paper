import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TwemojiText } from '@/components/ui/TwemojiText'
import {
  inspectConfiguredTranslation,
  TranslationServiceError,
  getProviderDisplayName,
  translateConfiguredText,
  type TranslationPreflight,
  type TranslationResult,
} from '@/lib/translation/client'
import { TRANSLATION_SETTINGS_UPDATED_EVENT } from '@/lib/translation/storage'

interface TranslateTextPanelProps {
  text: string
  className?: string
  autoStart?: boolean
}

const MAX_AUTO_TRANSLATE_CHARS = 2_800
const AUTO_RETRY_COOLDOWN_MS = 30_000

export function TranslateTextPanel({
  text,
  className = '',
  autoStart = false,
}: TranslateTextPanelProps) {
  const [result, setResult] = useState<TranslationResult | null>(null)
  const [hidden, setHidden] = useState(false)
  const [requested, setRequested] = useState(false)
  const [requestVersion, setRequestVersion] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<TranslationServiceError['code'] | null>(null)
  const [settingsVersion, setSettingsVersion] = useState(0)
  const [autoAttempted, setAutoAttempted] = useState(false)
  const [autoBlockedUntil, setAutoBlockedUntil] = useState(0)
  const [preflight, setPreflight] = useState<TranslationPreflight | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const trimmedText = text.trim()
  const now = Date.now()

  useEffect(() => {
    setResult(null)
    setHidden(false)
    setRequested(false)
    setError(null)
    setErrorCode(null)
    setLoading(false)
    setAutoAttempted(false)
    setAutoBlockedUntil(0)
    setPreflight(null)
    abortRef.current?.abort()
  }, [text])

  useEffect(() => {
    const browserWindow = typeof globalThis.window === 'undefined' ? null : globalThis.window
    if (!browserWindow) return

    const handleSettingsChanged = () => {
      abortRef.current?.abort()
      setResult(null)
      setHidden(false)
      setRequested(false)
      setError(null)
      setErrorCode(null)
      setLoading(false)
      setAutoAttempted(false)
      setAutoBlockedUntil(0)
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
    if (!trimmedText) {
      setPreflight(null)
      return
    }

    let cancelled = false
    setPreflight(null)

    inspectConfiguredTranslation(trimmedText)
      .then((next) => {
        if (!cancelled) setPreflight(next)
      })
      .catch(() => {
        if (!cancelled) {
          setPreflight({
            targetLanguage: 'en',
            likelySourceLanguage: null,
            sameLanguage: false,
            canAutoTranslate: autoStart,
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [autoStart, settingsVersion, trimmedText])

  useEffect(() => {
    if (!trimmedText || !requested) return

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    setErrorCode(null)

    void (async () => {
      try {
        const translated = await translateConfiguredText(trimmedText, controller.signal)
        if (controller.signal.aborted) return
        setResult(translated)
      } catch (translationError) {
        if (controller.signal.aborted) return

        const code = translationError instanceof TranslationServiceError
          ? translationError.code
          : null
        if (code === 'same-language') {
          setResult(null)
          setError(null)
          setErrorCode(code)
          setRequested(false)
          return
        }
        const message = translationError instanceof TranslationServiceError
          ? (translationError.code === 'config' || translationError.code === 'unavailable'
            ? 'Translation is not available with current settings.'
            : translationError.message)
          : translationError instanceof Error
            ? translationError.message
            : 'Translation failed.'
        setResult(null)
        setError(message)
        setErrorCode(code)
        setRequested(false)

        if (autoStart && !autoAttempted && (code === 'network' || code === 'provider')) {
          setAutoBlockedUntil(Date.now() + AUTO_RETRY_COOLDOWN_MS)
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    })()

    return () => controller.abort()
  }, [autoAttempted, autoStart, requestVersion, requested, settingsVersion, trimmedText])

  useEffect(() => {
    if (!autoStart) return
    if (!trimmedText) return
    if (!preflight) return
    if (trimmedText.length > MAX_AUTO_TRANSLATE_CHARS) return
    if (!preflight.canAutoTranslate) return
    if (requested || loading || result || error) return
    if (autoAttempted) return
    if (autoBlockedUntil > Date.now()) return

    setAutoAttempted(true)
    setRequested(true)
    setRequestVersion(version => version + 1)
  }, [
    autoAttempted,
    autoBlockedUntil,
    autoStart,
    error,
    loading,
    preflight,
    requested,
    result,
    trimmedText,
  ])

  const providerLabel = result ? getProviderDisplayName(result.provider) : null
  const detectedLanguage = result?.detectedSourceLanguage
  const sourceLabel = detectedLanguage || (result?.sourceLanguage !== 'auto' ? result?.sourceLanguage : null)

  const sameLanguageResult = useMemo(() => {
    if (!result) return false
    const source = (detectedLanguage ?? result.sourceLanguage).split('-')[0]?.toLowerCase()
    const target = result.targetLanguage.split('-')[0]?.toLowerCase()
    return Boolean(source && target && source === target)
  }, [detectedLanguage, result])
  const sameLanguage = preflight?.sameLanguage ?? false

  if (!trimmedText) return null
  if (sameLanguage || sameLanguageResult || errorCode === 'same-language') return null

  const requestTranslation = () => {
    setRequested(true)
    setAutoAttempted(true)
    setAutoBlockedUntil(0)
    setError(null)
    setErrorCode(null)
    setRequestVersion(version => version + 1)
  }

  const autoBlocked = autoBlockedUntil > now
  const autoLongText = trimmedText.length > MAX_AUTO_TRANSLATE_CHARS

  return (
    <div className={`mt-3 ${className}`} onClick={e => e.stopPropagation()}>
      {!requested && !loading && !result && !error && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {preflight && (
            <button
              type="button"
              onClick={requestTranslation}
              className="text-[12px] font-semibold tracking-[0.01em] text-[#007AFF]"
            >
              🌐 Translate
            </button>
          )}
          {autoLongText && (
            <span className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
              Long post: tap to translate on demand.
            </span>
          )}
          {autoBlocked && (
            <span className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
              Retry available in a few seconds.
            </span>
          )}
        </div>
      )}

      {loading && (
        <p className="text-[13px] italic text-[rgb(var(--color-label-tertiary))]">
          Translating…
        </p>
      )}

      {error && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[12px] text-[rgb(var(--color-system-red))]" title={error}>
            {errorCode === 'config' || errorCode === 'unavailable'
              ? 'Translation unavailable'
              : 'Translation failed'}
          </span>
          <button
            type="button"
            onClick={requestTranslation}
            className="text-[12px] font-medium text-[rgb(var(--color-system-red))] underline underline-offset-2"
          >
            Retry
          </button>
          {(errorCode === 'config' || errorCode === 'unavailable') && (
            <span className="text-[12px] text-[rgb(var(--color-label-tertiary))]">
              Configure provider in Settings.
            </span>
          )}
        </div>
      )}

      {result && (
        <>
          <hr className="border-t border-[rgb(var(--color-fill)/0.10)]" />

          {!hidden && (
            <div className="mt-3 rounded-[12px] bg-[rgb(var(--color-system-blue)/0.07)] p-3">
              <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.6] text-[rgb(var(--color-label))]">
                <TwemojiText text={result.translatedText} />
              </p>
            </div>
          )}

          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[rgb(var(--color-label-tertiary))]">
            <span>{sourceLabel ? `Translated from ${sourceLabel}` : 'Translated'}</span>
            <span>·</span>
            <span>{providerLabel}</span>
            <span>·</span>
            <button
              type="button"
              onClick={() => setHidden(prev => !prev)}
              className="font-medium text-[#007AFF]"
            >
              {hidden ? 'Show translation' : 'Hide translation'}
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={requestTranslation}
              className="font-medium text-[#007AFF]"
            >
              Re-translate
            </button>
          </p>
        </>
      )}
    </div>
  )
}
