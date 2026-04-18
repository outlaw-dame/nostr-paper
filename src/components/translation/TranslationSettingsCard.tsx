import React, { useEffect, useMemo, useState } from 'react'
import {
  getDeepLTransportSummary,
  getGemmaTransportSummary,
  getLibreTransportSummary,
  getSmall100TransportSummary,
  getOpusMtTransportSummary,
  getProviderDisplayName,
  getTranslangTransportSummary,
  getLingvaTransportSummary,
  listProviderLanguages,
  type TranslationLanguage,
} from '@/lib/translation/client'
import {
  clearTranslationSecrets,
  getTranslationStorageMode,
  loadTranslationDevQueueMetricsEnabled,
  loadTranslationConfiguration,
  normalizeTranslationPreferences,
  saveTranslationDevQueueMetricsEnabled,
  saveTranslationPreferences,
  saveTranslationSecrets,
  type TranslationConfiguration,
  type TranslationProvider,
} from '@/lib/translation/storage'
import { getBrowserLanguage } from '@/lib/translation/detect'
import { tTranslationUi } from '@/lib/translation/i18n'

function sortLanguages(languages: TranslationLanguage[]): TranslationLanguage[] {
  return [...languages].sort((left, right) => left.name.localeCompare(right.name))
}

function dedupeLanguages(languages: TranslationLanguage[]): TranslationLanguage[] {
  const seen = new Set<string>()
  const output: TranslationLanguage[] = []

  for (const language of languages) {
    if (!language.code || seen.has(language.code)) continue
    seen.add(language.code)
    output.push(language)
  }

  return output
}

function buildDraftConfiguration(input: {
  provider: TranslationProvider
  deeplPlan: 'free' | 'pro'
  deeplTargetLanguage: string
  deeplSourceLanguage: string
  libreBaseUrl: string
  libreTargetLanguage: string
  libreSourceLanguage: string
  translangBaseUrl: string
  translangTargetLanguage: string
  translangSourceLanguage: string
  lingvaBaseUrl: string
  lingvaTargetLanguage: string
  lingvaSourceLanguage: string
  deeplAuthKey: string
  libreApiKey: string
  small100BaseUrl: string
  small100TargetLanguage: string
  small100SourceLanguage: string
  opusMtTargetLanguage: string
  opusMtSourceLanguage: string
  gemmaTargetLanguage: string
  gemmaSourceLanguage: string
}): TranslationConfiguration {
  const preferences = normalizeTranslationPreferences({
    provider: input.provider,
    deeplPlan: input.deeplPlan,
    deeplTargetLanguage: input.deeplTargetLanguage,
    deeplSourceLanguage: input.deeplSourceLanguage,
    libreBaseUrl: input.libreBaseUrl,
    libreTargetLanguage: input.libreTargetLanguage,
    libreSourceLanguage: input.libreSourceLanguage,
    translangBaseUrl: input.translangBaseUrl,
    translangTargetLanguage: input.translangTargetLanguage,
    translangSourceLanguage: input.translangSourceLanguage,
    lingvaBaseUrl: input.lingvaBaseUrl,
    lingvaTargetLanguage: input.lingvaTargetLanguage,
    lingvaSourceLanguage: input.lingvaSourceLanguage,
    small100BaseUrl: input.small100BaseUrl,
    small100TargetLanguage: input.small100TargetLanguage,
    small100SourceLanguage: input.small100SourceLanguage,
    opusMtTargetLanguage: input.opusMtTargetLanguage,
    opusMtSourceLanguage: input.opusMtSourceLanguage,
    gemmaTargetLanguage: input.gemmaTargetLanguage,
    gemmaSourceLanguage: input.gemmaSourceLanguage,
  })

  return {
    ...preferences,
    deeplAuthKey: input.deeplAuthKey.trim(),
    libreApiKey: input.libreApiKey.trim(),
  }
}

interface LanguageInputProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  languages: TranslationLanguage[]
  allowAuto?: boolean
  placeholder: string
}

function LanguageInput({
  id,
  label,
  value,
  onChange,
  languages,
  allowAuto = false,
  placeholder,
}: LanguageInputProps) {
  const options = useMemo(() => {
    const sorted = sortLanguages(dedupeLanguages(languages))
    return allowAuto
      ? [{ code: 'auto', name: 'Auto detect' }, ...sorted]
      : sorted
  }, [allowAuto, languages])

  if (options.length > 0) {
    return (
      <label className="mt-3 block">
        <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
          {label}
        </span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[16px] text-[rgb(var(--color-label))] outline-none"
        >
          {options.map((language) => (
            <option key={language.code} value={language.code}>
              {language.name} ({language.code})
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <label className="mt-3 block">
      <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
        {label}
      </span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[16px] text-[rgb(var(--color-label))] outline-none"
      />
    </label>
  )
}

export function TranslationSettingsCard() {
  const [loaded, setLoaded] = useState(false)
  const [provider, setProvider] = useState<TranslationProvider>('deepl')
  const [deeplPlan, setDeeplPlan] = useState<'free' | 'pro'>('free')
  const [deeplTargetLanguage, setDeeplTargetLanguage] = useState('EN-US')
  const [deeplSourceLanguage, setDeeplSourceLanguage] = useState('auto')
  const [deeplAuthKey, setDeeplAuthKey] = useState('')
  const [libreBaseUrl, setLibreBaseUrl] = useState('')
  const [libreTargetLanguage, setLibreTargetLanguage] = useState('en')
  const [libreSourceLanguage, setLibreSourceLanguage] = useState('auto')
  const [libreApiKey, setLibreApiKey] = useState('')
  const [translangBaseUrl, setTranslangBaseUrl] = useState('')
  const [translangTargetLanguage, setTranslangTargetLanguage] = useState('en')
  const [translangSourceLanguage, setTranslangSourceLanguage] = useState('auto')
  const [lingvaBaseUrl, setLingvaBaseUrl] = useState('')
  const [lingvaTargetLanguage, setLingvaTargetLanguage] = useState('en')
  const [lingvaSourceLanguage, setLingvaSourceLanguage] = useState('auto')
  const [small100BaseUrl, setSmall100BaseUrl] = useState('http://localhost:7080')
  const [small100TargetLanguage, setSmall100TargetLanguage] = useState('en')
  const [small100SourceLanguage, setSmall100SourceLanguage] = useState('auto')
  const [opusMtTargetLanguage, setOpusMtTargetLanguage] = useState('en')
  const [opusMtSourceLanguage, setOpusMtSourceLanguage] = useState('auto')
  const [gemmaTargetLanguage, setGemmaTargetLanguage] = useState('en')
  const [gemmaSourceLanguage, setGemmaSourceLanguage] = useState('auto')
  const [sourceLanguages, setSourceLanguages] = useState<TranslationLanguage[]>([])
  const [targetLanguages, setTargetLanguages] = useState<TranslationLanguage[]>([])
  const [saving, setSaving] = useState(false)
  const [loadingLanguages, setLoadingLanguages] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showQueueMetrics, setShowQueueMetrics] = useState(() => (
    import.meta.env.DEV ? loadTranslationDevQueueMetricsEnabled() : false
  ))

  function getBrowserPrimaryLanguage(): string {
    const browserLanguage = getBrowserLanguage()?.toLowerCase() ?? 'en'
    return browserLanguage.split('-')[0] ?? 'en'
  }

  useEffect(() => {
    let cancelled = false

    loadTranslationConfiguration()
      .then((configuration) => {
        if (cancelled) return
        setProvider(configuration.provider)
        setDeeplPlan(configuration.deeplPlan)
        setDeeplTargetLanguage(configuration.deeplTargetLanguage)
        setDeeplSourceLanguage(configuration.deeplSourceLanguage)
        setDeeplAuthKey(configuration.deeplAuthKey)
        setLibreBaseUrl(configuration.libreBaseUrl)
        setLibreTargetLanguage(configuration.libreTargetLanguage)
        setLibreSourceLanguage(configuration.libreSourceLanguage)
        setLibreApiKey(configuration.libreApiKey)
        setTranslangBaseUrl(configuration.translangBaseUrl)
        setTranslangTargetLanguage(configuration.translangTargetLanguage)
        setTranslangSourceLanguage(configuration.translangSourceLanguage)
        setLingvaBaseUrl(configuration.lingvaBaseUrl || '')
        setLingvaTargetLanguage(configuration.lingvaTargetLanguage || 'en')
        setLingvaSourceLanguage(configuration.lingvaSourceLanguage || 'auto')
        setSmall100BaseUrl(configuration.small100BaseUrl || 'http://localhost:7080')
        setSmall100TargetLanguage(configuration.small100TargetLanguage)
        setSmall100SourceLanguage(configuration.small100SourceLanguage)
        setOpusMtTargetLanguage(configuration.opusMtTargetLanguage)
        setOpusMtSourceLanguage(configuration.opusMtSourceLanguage)
        setGemmaTargetLanguage(configuration.gemmaTargetLanguage)
        setGemmaSourceLanguage(configuration.gemmaSourceLanguage)
      })
      .catch(() => {
        if (cancelled) return
        setError(tTranslationUi('loadSettingsFailed'))
      })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const storageMode = getTranslationStorageMode()
  const [transportSummary, setTransportSummary] = useState('')

  useEffect(() => {
    if (provider === 'small100') {
      getSmall100TransportSummary(small100BaseUrl).then(setTransportSummary).catch(() => {
        setTransportSummary('Could not check SMaLL-100 daemon status.')
      })
    } else if (provider === 'opusmt') {
      setTransportSummary(getOpusMtTransportSummary())
    } else if (provider === 'gemma') {
      setTransportSummary(getGemmaTransportSummary())
    } else if (provider === 'translang') {
      setTransportSummary(getTranslangTransportSummary(translangBaseUrl))
    } else if (provider === 'lingva') {
      setTransportSummary(getLingvaTransportSummary(lingvaBaseUrl))
    } else if (provider === 'deepl') {
      setTransportSummary(getDeepLTransportSummary())
    } else {
      setTransportSummary(getLibreTransportSummary())
    }
  }, [provider, small100BaseUrl, translangBaseUrl, lingvaBaseUrl])

  const draftConfiguration = buildDraftConfiguration({
    provider,
    deeplPlan,
    deeplTargetLanguage,
    deeplSourceLanguage,
    libreBaseUrl,
    libreTargetLanguage,
    libreSourceLanguage,
    translangBaseUrl,
    translangTargetLanguage,
    translangSourceLanguage,
    lingvaBaseUrl,
    lingvaTargetLanguage,
    lingvaSourceLanguage,
    deeplAuthKey,
    libreApiKey,
    small100BaseUrl,
    small100TargetLanguage,
    small100SourceLanguage,
    opusMtTargetLanguage,
    opusMtSourceLanguage,
    gemmaTargetLanguage,
    gemmaSourceLanguage,
  })

  function getSelectedSourceLanguage(): string {
    switch (provider) {
      case 'deepl':
        return deeplSourceLanguage
      case 'libretranslate':
        return libreSourceLanguage
      case 'translang':
        return translangSourceLanguage
      case 'lingva':
        return lingvaSourceLanguage
      case 'small100':
        return small100SourceLanguage
      case 'opusmt':
        return opusMtSourceLanguage
      case 'gemma':
        return gemmaSourceLanguage
    }
  }

  function getSelectedTargetLanguage(): string {
    switch (provider) {
      case 'deepl':
        return deeplTargetLanguage
      case 'libretranslate':
        return libreTargetLanguage
      case 'translang':
        return translangTargetLanguage
      case 'lingva':
        return lingvaTargetLanguage
      case 'small100':
        return small100TargetLanguage
      case 'opusmt':
        return opusMtTargetLanguage
      case 'gemma':
        return gemmaTargetLanguage
    }
  }

  function setSelectedSourceLanguage(value: string): void {
    switch (provider) {
      case 'deepl':
        setDeeplSourceLanguage(value)
        return
      case 'libretranslate':
        setLibreSourceLanguage(value)
        return
      case 'translang':
        setTranslangSourceLanguage(value)
        return
      case 'lingva':
        setLingvaSourceLanguage(value)
        return
      case 'small100':
        setSmall100SourceLanguage(value)
        return
      case 'opusmt':
        setOpusMtSourceLanguage(value)
        return
      case 'gemma':
        setGemmaSourceLanguage(value)
        return
    }
  }

  function setSelectedTargetLanguage(value: string): void {
    switch (provider) {
      case 'deepl':
        setDeeplTargetLanguage(value)
        return
      case 'libretranslate':
        setLibreTargetLanguage(value)
        return
      case 'translang':
        setTranslangTargetLanguage(value)
        return
      case 'lingva':
        setLingvaTargetLanguage(value)
        return
      case 'small100':
        setSmall100TargetLanguage(value)
        return
      case 'opusmt':
        setOpusMtTargetLanguage(value)
        return
      case 'gemma':
        setGemmaTargetLanguage(value)
        return
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setMessage('')
    setError('')

    try {
      await saveTranslationPreferences(draftConfiguration)
      await saveTranslationSecrets({
        deeplAuthKey: draftConfiguration.deeplAuthKey,
        libreApiKey: draftConfiguration.libreApiKey,
      })
      setMessage(tTranslationUi('saveSettingsSuccess'))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : tTranslationUi('saveSettingsFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleLoadLanguages(): Promise<void> {
    setLoadingLanguages(true)
    setMessage('')
    setError('')

    try {
      const [sources, targets] = await Promise.all([
        listProviderLanguages(draftConfiguration, 'source'),
        listProviderLanguages(draftConfiguration, 'target'),
      ])

      setSourceLanguages(sources)
      setTargetLanguages(targets)

      const selectedTarget = getSelectedTargetLanguage()
      const selectedSource = getSelectedSourceLanguage()

      if (targets[0] && !targets.some(language => language.code === selectedTarget)) {
        setSelectedTargetLanguage(targets[0].code)
      }
      if (sources[0] && selectedSource !== 'auto' && !sources.some(language => language.code === selectedSource)) {
        setSelectedSourceLanguage('auto')
      }

      setMessage(tTranslationUi('loadLanguagesSuccess', {
        count: targets.length,
        provider: getProviderDisplayName(provider),
        suffix: targets.length === 1 ? '' : 's',
      }))
    } catch (languageError) {
      setError(languageError instanceof Error ? languageError.message : tTranslationUi('loadLanguagesFailed'))
    } finally {
      setLoadingLanguages(false)
    }
  }

  async function handleClearKeys(): Promise<void> {
    setClearing(true)
    setMessage('')
    setError('')

    try {
      await clearTranslationSecrets()
      setDeeplAuthKey('')
      setLibreApiKey('')
      setMessage(tTranslationUi('clearKeysSuccess'))
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : tTranslationUi('clearKeysFailed'))
    } finally {
      setClearing(false)
    }
  }

  async function handleApplyLocalPreset(): Promise<void> {
    setMessage('')
    setError('')

    const targetLanguage = getBrowserPrimaryLanguage()
    setProvider('small100')
    setSmall100BaseUrl('http://localhost:7080')
    setSmall100SourceLanguage('auto')
    setSmall100TargetLanguage(targetLanguage)
    setSourceLanguages([])
    setTargetLanguages([])

    try {
      await saveTranslationPreferences({
        provider: 'small100',
        small100BaseUrl: 'http://localhost:7080',
        small100SourceLanguage: 'auto',
        small100TargetLanguage: targetLanguage,
      })
      setMessage(tTranslationUi('presetApplied', { target: targetLanguage }))
    } catch (presetError) {
      setError(presetError instanceof Error ? presetError.message : tTranslationUi('presetFailed'))
    }
  }

  if (!loaded) {
    return (
      <div className="rounded-[20px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] p-4">
        <p className="text-[14px] text-[rgb(var(--color-label-secondary))]">
          {tTranslationUi('loadingTranslationSettings')}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-[20px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg-secondary))] p-4">
      <p className="text-[15px] font-medium text-[rgb(var(--color-label))]">
        {tTranslationUi('inlineTranslationTitle')}
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-[rgb(var(--color-label-secondary))]">
        {tTranslationUi('inlineTranslationIntro')}
      </p>

      <label className="mt-4 block">
        <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
          {tTranslationUi('providerLabel')}
        </span>
        <select
          value={provider}
          onChange={(event) => {
            const value = event.target.value
            setProvider(
              value === 'libretranslate' ? 'libretranslate'
              : value === 'translang' ? 'translang'
              : value === 'lingva' ? 'lingva'
              : value === 'small100' ? 'small100'
              : value === 'opusmt' ? 'opusmt'
              : value === 'gemma' ? 'gemma'
              : 'deepl'
            )
            setSourceLanguages([])
            setTargetLanguages([])
            setMessage('')
            setError('')
          }}
          className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[16px] text-[rgb(var(--color-label))] outline-none"
        >
          <option value="deepl">DeepL</option>
          <option value="libretranslate">LibreTranslate</option>
          <option value="translang">TransLang (Phanpy-compatible)</option>
          <option value="lingva">Lingva (Google Translate frontend)</option>
          <option value="small100">SMaLL-100 (local daemon)</option>
          <option value="opusmt">Opus-MT (in-browser)</option>
          <option value="gemma">Gemma 4 (on-device)</option>
        </select>
      </label>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => void handleApplyLocalPreset()}
          disabled={saving || loadingLanguages || clearing}
          className="w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.2)] bg-[rgb(var(--color-bg))] px-4 py-2.5 text-[14px] font-medium text-[rgb(var(--color-label))] transition-opacity active:opacity-75 disabled:opacity-40"
        >
          {tTranslationUi('useLocalDefaults')}
        </button>
      </div>

      {provider === 'deepl' ? (
        <>
          <label className="mt-3 block">
            <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
              DeepL plan
            </span>
            <select
              value={deeplPlan}
              onChange={(event) => setDeeplPlan(event.target.value === 'pro' ? 'pro' : 'free')}
              className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[16px] text-[rgb(var(--color-label))] outline-none"
            >
              <option value="free">Free API</option>
              <option value="pro">Pro API</option>
            </select>
          </label>

          <label className="mt-3 block">
            <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
              DeepL API key
            </span>
            <input
              type="password"
              value={deeplAuthKey}
              onChange={(event) => setDeeplAuthKey(event.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[16px] text-[rgb(var(--color-label))] outline-none"
            />
          </label>

          <LanguageInput
            id="deepl-source-language"
            label="Source language"
            value={deeplSourceLanguage}
            onChange={setDeeplSourceLanguage}
            languages={sourceLanguages}
            allowAuto
            placeholder="auto"
          />
          <LanguageInput
            id="deepl-target-language"
            label="Target language"
            value={deeplTargetLanguage}
            onChange={setDeeplTargetLanguage}
            languages={targetLanguages}
            placeholder="EN-US"
          />
        </>
      ) : provider === 'libretranslate' ? (
        <>
          <label className="mt-3 block">
            <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
              LibreTranslate instance URL
            </span>
            <input
              type="url"
              value={libreBaseUrl}
              onChange={(event) => setLibreBaseUrl(event.target.value)}
              placeholder="https://translate.example.com"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[16px] text-[rgb(var(--color-label))] outline-none"
            />
          </label>

          <label className="mt-3 block">
            <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
              LibreTranslate API key
            </span>
            <input
              type="password"
              value={libreApiKey}
              onChange={(event) => setLibreApiKey(event.target.value)}
              placeholder="Optional unless your instance requires one"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[16px] text-[rgb(var(--color-label))] outline-none"
            />
          </label>

          <LanguageInput
            id="libre-source-language"
            label="Source language"
            value={libreSourceLanguage}
            onChange={setLibreSourceLanguage}
            languages={sourceLanguages}
            allowAuto
            placeholder="auto"
          />
          <LanguageInput
            id="libre-target-language"
            label="Target language"
            value={libreTargetLanguage}
            onChange={setLibreTargetLanguage}
            languages={targetLanguages}
            placeholder="en"
          />
        </>
      ) : provider === 'translang' ? (
        <>
          <label className="mt-3 block">
            <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
              TransLang instance URL
            </span>
            <input
              type="url"
              value={translangBaseUrl}
              onChange={(event) => setTranslangBaseUrl(event.target.value)}
              placeholder="https://translang.phanpy.social"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[16px] text-[rgb(var(--color-label))] outline-none"
            />
          </label>

          <LanguageInput
            id="translang-source-language"
            label="Source language"
            value={translangSourceLanguage}
            onChange={setTranslangSourceLanguage}
            languages={sourceLanguages}
            allowAuto
            placeholder="auto"
          />
          <LanguageInput
            id="translang-target-language"
            label="Target language"
            value={translangTargetLanguage}
            onChange={setTranslangTargetLanguage}
            languages={targetLanguages}
            placeholder="en"
          />

          <p className="mt-3 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
            Matches Phanpy’s current translation stack. Public instances proxy Google Translate, so use an instance you trust or self-host.
          </p>
        </>
      ) : provider === 'lingva' ? (
        <>
          <label className="mt-3 block">
            <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
              Lingva instance URL
            </span>
            <input
              type="url"
              value={lingvaBaseUrl}
              onChange={(event) => setLingvaBaseUrl(event.target.value)}
              placeholder="https://lingva.ml"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[16px] text-[rgb(var(--color-label))] outline-none"
            />
          </label>

          <LanguageInput
            id="lingva-source-language"
            label="Source language"
            value={lingvaSourceLanguage}
            onChange={setLingvaSourceLanguage}
            languages={sourceLanguages}
            allowAuto
            placeholder="auto"
          />
          <LanguageInput
            id="lingva-target-language"
            label="Target language"
            value={lingvaTargetLanguage}
            onChange={setLingvaTargetLanguage}
            languages={targetLanguages}
            placeholder="en"
          />

          <p className="mt-3 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
            Proxies Google Translate. Best for Asian languages. Use a public instance like <code>https://lingva.ml</code> or self-host.
          </p>
        </>
      ) : provider === 'small100' ? (
        <>
          <label className="mt-3 block">
            <span className="text-[13px] font-medium text-[rgb(var(--color-label))]">
              Daemon URL
            </span>
            <input
              type="url"
              value={small100BaseUrl}
              onChange={(event) => setSmall100BaseUrl(event.target.value)}
              placeholder="http://localhost:7080"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              className="mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.16)] bg-[rgb(var(--color-bg))] px-3 py-2.5 text-[16px] text-[rgb(var(--color-label))] outline-none"
            />
          </label>

          <LanguageInput
            id="small100-source-language"
            label="Source language"
            value={small100SourceLanguage}
            onChange={setSmall100SourceLanguage}
            languages={sourceLanguages}
            allowAuto
            placeholder="auto"
          />
          <LanguageInput
            id="small100-target-language"
            label="Target language"
            value={small100TargetLanguage}
            onChange={setSmall100TargetLanguage}
            languages={targetLanguages}
            placeholder="en"
          />

          <p className="mt-3 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
            Start the daemon with: <code className="font-mono">python server/translate.py</code>. See that file for Docker and GPU instructions.
          </p>
        </>
      ) : provider === 'opusmt' ? (
        <>
          <LanguageInput
            id="opusmt-source-language"
            label="Source language"
            value={opusMtSourceLanguage}
            onChange={setOpusMtSourceLanguage}
            languages={sourceLanguages}
            allowAuto
            placeholder="en"
          />
          <LanguageInput
            id="opusmt-target-language"
            label="Target language"
            value={opusMtTargetLanguage}
            onChange={setOpusMtTargetLanguage}
            languages={targetLanguages}
            placeholder="en"
          />

          <p className="mt-3 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
            Models download once (~50–300 MB per language pair) and run entirely in your browser. No data leaves your device after download, but pair coverage is limited compared with TransLang or SMaLL-100.
          </p>
        </>
      ) : provider === 'gemma' ? (
        <>
          <LanguageInput
            id="gemma-source-language"
            label="Source language"
            value={gemmaSourceLanguage}
            onChange={setGemmaSourceLanguage}
            languages={sourceLanguages}
            allowAuto
            placeholder="auto"
          />
          <LanguageInput
            id="gemma-target-language"
            label="Target language"
            value={gemmaTargetLanguage}
            onChange={setGemmaTargetLanguage}
            languages={targetLanguages}
            placeholder="en"
          />

          <p className="mt-3 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
            Runs entirely on your device using the local Gemma 4 model and WebGPU. No translation text is sent to any remote service, but responses are generated by an LLM, so wording can be less literal than dedicated MT engines.
          </p>
        </>
      ) : null}

      <div className="mt-4 rounded-[16px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] p-3">
        <p className="text-[13px] font-medium text-[rgb(var(--color-label))]">
          {tTranslationUi('transportLabel')}
        </p>
        <p className="mt-1 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
          {transportSummary}
        </p>
        <p className="mt-2 text-[13px] leading-6 text-[rgb(var(--color-label-secondary))]">
          {tTranslationUi('storageLabel')}: {storageMode === 'encrypted-indexeddb'
            ? tTranslationUi('storageEncrypted')
            : tTranslationUi('storageSessionOnly')}
        </p>
      </div>

      {import.meta.env.DEV && (
        <label className="mt-3 flex items-center justify-between gap-3 rounded-[14px] border border-[rgb(var(--color-fill)/0.12)] bg-[rgb(var(--color-bg))] px-3 py-2.5">
          <span className="text-[13px] text-[rgb(var(--color-label-secondary))]">
            {tTranslationUi('queueMetricsLabel')}
          </span>
          <input
            type="checkbox"
            checked={showQueueMetrics}
            onChange={(event) => {
              const enabled = event.target.checked
              setShowQueueMetrics(enabled)
              saveTranslationDevQueueMetricsEnabled(enabled)
            }}
            className="h-4 w-4 accent-[#007AFF]"
          />
        </label>
      )}

      {provider === 'libretranslate' && (
        <p className="mt-3 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
          LibreTranslate requests go directly to the configured instance unless a proxy is configured. Use an instance you trust because that service receives the text you choose to translate.
        </p>
      )}

      {provider === 'translang' && (
        <p className="mt-3 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
          TransLang requests go directly to the configured instance. Phanpy’s public instance is convenient, but translated text is sent to that service, so self-host if you need tighter privacy guarantees.
        </p>
      )}

      {provider === 'deepl' && (
        <p className="mt-3 text-[12px] leading-5 text-[rgb(var(--color-label-secondary))]">
          DeepL does not allow direct browser-origin API calls. On localhost the built-in dev proxy is used; production requires a configured proxy endpoint.
        </p>
      )}

      {message && (
        <p className="mt-4 text-[13px] text-[rgb(var(--color-system-green))]">
          {message}
        </p>
      )}

      {error && (
        <p className="mt-4 text-[13px] text-[rgb(var(--color-system-red))]">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => void handleLoadLanguages()}
          disabled={loadingLanguages || saving || clearing}
          className="
            flex-1 rounded-[14px] border border-[rgb(var(--color-fill)/0.2)]
            bg-[rgb(var(--color-bg))] px-4 py-2.5 text-[14px]
            font-medium text-[rgb(var(--color-label))]
            transition-opacity active:opacity-75 disabled:opacity-40
          "
        >
          {loadingLanguages ? tTranslationUi('loadingLanguages') : tTranslationUi('loadLanguages')}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || loadingLanguages || clearing}
          className="
            flex-1 rounded-[14px] bg-[rgb(var(--color-label))]
            px-4 py-2.5 text-[14px] font-medium text-white
            transition-opacity active:opacity-75 disabled:opacity-40
          "
        >
          {saving ? tTranslationUi('saving') : tTranslationUi('saveSettings')}
        </button>
      </div>

      <button
        type="button"
        onClick={() => void handleClearKeys()}
        disabled={clearing || saving || loadingLanguages}
        className="
          mt-2 w-full rounded-[14px] border border-[rgb(var(--color-fill)/0.2)]
          bg-[rgb(var(--color-bg))] px-4 py-2.5 text-[14px]
          font-medium text-[rgb(var(--color-label))]
          transition-opacity active:opacity-75 disabled:opacity-40
        "
      >
        {clearing ? tTranslationUi('clearing') : tTranslationUi('clearStoredKeys')}
      </button>
    </div>
  )
}
