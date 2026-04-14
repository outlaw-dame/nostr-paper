import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { TwemojiText } from '@/components/ui/TwemojiText'
import {
  inspectConfiguredTranslation,
  TranslationServiceError,
  getProviderDisplayName,
  translateConfiguredText,
  type TranslationPreflight,
  type TranslationResult,
} from '@/lib/translation/client'
import { hasMeaningfulTranslationText } from '@/lib/translation/text'
import {
  loadTranslationDevQueueMetricsEnabled,
  TRANSLATION_SETTINGS_UPDATED_EVENT,
} from '@/lib/translation/storage'

interface TranslateTextPanelProps {
  text: string
  className?: string
  autoStart?: boolean
}

const MAX_AUTO_TRANSLATE_CHARS = 2_800
const AUTO_RETRY_COOLDOWN_MS = 30_000
const MAX_CONCURRENT_AUTO_TRANSLATIONS = 4

let activeAutoTranslationJobs = 0
const queuedAutoTranslationStarters: Array<() => void> = []
const autoQueueMetricListeners = new Set<(snapshot: { active: number; queued: number }) => void>()

function publishAutoQueueMetrics(): void {
  const snapshot = {
    active: activeAutoTranslationJobs,
    queued: queuedAutoTranslationStarters.length,
  }
  autoQueueMetricListeners.forEach(listener => listener(snapshot))
}

function scheduleNextAutoTranslation(): void {
  if (activeAutoTranslationJobs >= MAX_CONCURRENT_AUTO_TRANSLATIONS) return
  const next = queuedAutoTranslationStarters.shift()
  if (next) next()
}

function runAutoTranslationJob<T>(
  execute: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }

      activeAutoTranslationJobs += 1
      publishAutoQueueMetrics()
      void execute()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeAutoTranslationJobs = Math.max(0, activeAutoTranslationJobs - 1)
          publishAutoQueueMetrics()
          scheduleNextAutoTranslation()
        })
    }

    if (activeAutoTranslationJobs < MAX_CONCURRENT_AUTO_TRANSLATIONS) {
      start()
      return
    }

    const onAbort = () => {
      const index = queuedAutoTranslationStarters.indexOf(start)
      if (index !== -1) {
        queuedAutoTranslationStarters.splice(index, 1)
        publishAutoQueueMetrics()
      }
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    queuedAutoTranslationStarters.push(() => {
      signal.removeEventListener('abort', onAbort)
      start()
    })
    publishAutoQueueMetrics()
  })
}

export function TranslateTextPanel({
  text,
  className = '',
  autoStart = true,
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
  const [toastVisible, setToastVisible] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [showQueueMetrics, setShowQueueMetrics] = useState(() => (
    import.meta.env.DEV ? loadTranslationDevQueueMetricsEnabled() : false
  ))
  const [autoQueueSnapshot, setAutoQueueSnapshot] = useState({ active: 0, queued: 0 })
  const toastTimerRef = useRef<number | null>(null)
  const pendingRequestIsAutoRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const trimmedText = text.trim()
  const hasMeaningfulText = useMemo(() => hasMeaningfulTranslationText(trimmedText), [trimmedText])
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
      pendingRequestIsAutoRef.current = false
      if (import.meta.env.DEV) {
        setShowQueueMetrics(loadTranslationDevQueueMetricsEnabled())
      }
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
    if (!import.meta.env.DEV || !showQueueMetrics) return

    const handleQueueUpdate = (snapshot: { active: number; queued: number }) => {
      setAutoQueueSnapshot(snapshot)
    }

    autoQueueMetricListeners.add(handleQueueUpdate)
    publishAutoQueueMetrics()
    return () => {
      autoQueueMetricListeners.delete(handleQueueUpdate)
    }
  }, [showQueueMetrics])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current)
        toastTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!trimmedText || !hasMeaningfulText) {
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
  }, [autoStart, hasMeaningfulText, settingsVersion, trimmedText])

  useEffect(() => {
    if (!trimmedText || !requested) return

    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setError(null)
    setErrorCode(null)

    const requestIsAuto = pendingRequestIsAutoRef.current
    pendingRequestIsAutoRef.current = false

    void (async () => {
      try {
        const translated = requestIsAuto
          ? await runAutoTranslationJob(async () => {
            if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
            setLoading(true)
            return translateConfiguredText(trimmedText, controller.signal)
          }, controller.signal)
          : await (async () => {
            setLoading(true)
            return translateConfiguredText(trimmedText, controller.signal)
          })()
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
        if (requestIsAuto) {
          setResult(null)
          setError(null)
          setErrorCode(null)
          setRequested(false)

          if (code === 'network' || code === 'provider' || code === 'config' || code === 'unavailable') {
            setAutoBlockedUntil(Date.now() + AUTO_RETRY_COOLDOWN_MS)
          }
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

        const shouldShowToast = code === 'config' || code === 'unavailable' || code === 'network' || code === 'provider'
        if (shouldShowToast) {
          setToastMessage(code === 'config' || code === 'unavailable'
            ? 'Translation needs setup. Open Translation Settings.'
            : 'Translation failed. You can retry or adjust Translation Settings.')
          setToastVisible(true)
          if (toastTimerRef.current !== null) {
            window.clearTimeout(toastTimerRef.current)
          }
          toastTimerRef.current = window.setTimeout(() => {
            setToastVisible(false)
            toastTimerRef.current = null
          }, 4800)
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

    pendingRequestIsAutoRef.current = true
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

  if (!trimmedText || !hasMeaningfulText) return null
  if (sameLanguage || sameLanguageResult || errorCode === 'same-language') return null

  const requestTranslation = () => {
    pendingRequestIsAutoRef.current = false
    setRequested(true)
    setAutoAttempted(true)
    setAutoBlockedUntil(0)
    setError(null)
    setErrorCode(null)
    setRequestVersion(version => version + 1)
  }

  const autoBlocked = autoBlockedUntil > now
  const autoLongText = trimmedText.length > MAX_AUTO_TRANSLATE_CHARS

  const stopPropagation = (event: React.SyntheticEvent) => {
    event.stopPropagation()
  }

  return (
    <div
      className={`mt-3 ${className}`}
      onClick={stopPropagation}
      onPointerDownCapture={stopPropagation}
      onPointerUpCapture={stopPropagation}
    >
      {!requested && !loading && !result && !error && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {preflight && (
            <button
              type="button"
              onClick={requestTranslation}
              onPointerDownCapture={stopPropagation}
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

      {import.meta.env.DEV && showQueueMetrics && (autoQueueSnapshot.active > 0 || autoQueueSnapshot.queued > 0) && (
        <p className="text-[11px] text-[rgb(var(--color-label-tertiary))]">
          Auto-translate queue: {autoQueueSnapshot.active} active, {autoQueueSnapshot.queued} waiting
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
            onPointerDownCapture={stopPropagation}
            className="text-[12px] font-medium text-[rgb(var(--color-system-red))] underline underline-offset-2"
          >
            Retry
          </button>
          {(errorCode === 'config' || errorCode === 'unavailable') && (
            <Link
              to="/settings/translations"
              onClick={stopPropagation}
              onPointerDownCapture={stopPropagation}
              className="text-[12px] text-[#007AFF] underline underline-offset-2"
            >
              Open Translation Settings
            </Link>
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
              onPointerDownCapture={stopPropagation}
              className="font-medium text-[#007AFF]"
            >
              {hidden ? 'Show translation' : 'Hide translation'}
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={requestTranslation}
              onPointerDownCapture={stopPropagation}
              className="font-medium text-[#007AFF]"
            >
              Re-translate
            </button>
          </p>
        </>
      )}

      {toastVisible && (
        <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+14px)] z-50 flex justify-center pointer-events-none">
          <div className="pointer-events-auto max-w-md rounded-[14px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg-secondary))] px-3 py-2 shadow-lg">
            <p className="text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
              {toastMessage}{' '}
              <Link
                to="/settings/translations"
                onClick={stopPropagation}
                onPointerDownCapture={stopPropagation}
                className="font-medium text-[#007AFF] underline underline-offset-2"
              >
                Open Translation Settings
              </Link>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
