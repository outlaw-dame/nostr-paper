import { getBrowserLanguage } from '@/lib/translation/detect'

export type TranslationUiLocale = 'en' | 'es'

type TranslationUiMessages = Record<string, string>

const FALLBACK_LOCALE: TranslationUiLocale = 'en'

const MESSAGES: Record<TranslationUiLocale, TranslationUiMessages> = {
  en: {
    translationsPageTitle: 'Translations',
    translationsPageSubtitle: 'Configure translation providers and language preferences for inline post translations.',
    goBack: 'Go back',

    translateAction: 'Translate',
    longPostHint: 'Long post: tap to translate on demand.',
    retrySoonHint: 'Retry available in a few seconds.',
    translating: 'Translating...',
    autoQueueLabel: 'Auto-translate queue: {active} active, {queued} waiting',
    translationUnavailable: 'Translation unavailable',
    translationFailed: 'Translation failed',
    retry: 'Retry',
    openTranslationSettings: 'Open Translation Settings',
    translatedFrom: 'Translated from {source}',
    translated: 'Translated',
    showTranslation: 'Show translation',
    hideTranslation: 'Hide translation',
    retranslate: 'Re-translate',
    toastNeedsSetup: 'Translation needs setup. Open Translation Settings.',
    toastFailed: 'Translation failed. You can retry or adjust Translation Settings.',
    translationUnavailableCurrentSettings: 'Translation is not available with current settings.',

    loadSettingsFailed: 'Failed to load translation settings.',
    saveSettingsSuccess: 'Translation settings saved locally.',
    saveSettingsFailed: 'Failed to save translation settings.',
    loadLanguagesSuccess: 'Loaded {count} {provider} target language{suffix}.',
    loadLanguagesFailed: 'Failed to load provider languages.',
    clearKeysSuccess: 'Stored translation API keys cleared.',
    clearKeysFailed: 'Failed to clear stored translation API keys.',
    presetApplied: 'Applied local SMaLL-100 preset (target: {target}).',
    presetFailed: 'Failed to apply local preset.',

    loadingTranslationSettings: 'Loading translation settings...',
    inlineTranslationTitle: 'Inline Translation',
    inlineTranslationIntro: 'Notes, articles, and profile bios auto-translate inline once a provider is configured. API keys are encrypted locally when the browser supports Web Crypto and IndexedDB. No keys are sent to relays.',
    providerLabel: 'Provider',
    useLocalDefaults: 'Use Local SMaLL-100 Defaults',
    transportLabel: 'Transport',
    storageLabel: 'Storage',
    storageEncrypted: 'Encrypted local persistence',
    storageSessionOnly: 'Session-only fallback',
    queueMetricsLabel: 'Show auto-translate queue metrics in feed (dev)',
    loadingLanguages: 'Loading...',
    loadLanguages: 'Load Languages',
    saving: 'Saving...',
    saveSettings: 'Save Settings',
    clearing: 'Clearing...',
    clearStoredKeys: 'Clear Stored API Keys',

    gemmaUnavailableSummary: 'Unavailable until a local Gemma model is configured and the browser exposes WebGPU.',
    gemmaTransportSummary: 'Runs entirely on-device via WebGPU using the local Gemma 4 model. No translation text leaves your browser.',
    gemmaUnavailableError: 'Gemma local translation is unavailable. Configure a local model and use a WebGPU-capable browser.',
    gemmaTranslationFailed: 'Gemma translation failed.',
    gemmaReturnedEmpty: 'Gemma returned an empty translation.',
    geminiTransportSummary: 'Uses the Google Gemini cloud API over HTTPS. Translated text is sent to Google for processing.',
    geminiMissingApiKey: 'Enter a Gemini API key in Settings first.',
    geminiTranslationFailed: 'Gemini translation failed.',
    geminiReturnedEmpty: 'Gemini returned an empty translation.',
    geminiMalformedResponse: 'Gemini returned an invalid response payload.',
    geminiPromptBlocked: 'Gemini blocked this translation request ({reason}).',
  },
  es: {
    translationsPageTitle: 'Traducciones',
    translationsPageSubtitle: 'Configura proveedores de traduccion y preferencias de idioma para traducir publicaciones en linea.',
    goBack: 'Volver',

    translateAction: 'Traducir',
    longPostHint: 'Publicacion larga: toca para traducir bajo demanda.',
    retrySoonHint: 'Puedes reintentar en unos segundos.',
    translating: 'Traduciendo...',
    autoQueueLabel: 'Cola de traduccion automatica: {active} activas, {queued} en espera',
    translationUnavailable: 'Traduccion no disponible',
    translationFailed: 'La traduccion fallo',
    retry: 'Reintentar',
    openTranslationSettings: 'Abrir ajustes de traduccion',
    translatedFrom: 'Traducido desde {source}',
    translated: 'Traducido',
    showTranslation: 'Mostrar traduccion',
    hideTranslation: 'Ocultar traduccion',
    retranslate: 'Traducir de nuevo',
    toastNeedsSetup: 'La traduccion requiere configuracion. Abre Ajustes de traduccion.',
    toastFailed: 'La traduccion fallo. Puedes reintentar o ajustar los Ajustes de traduccion.',
    translationUnavailableCurrentSettings: 'La traduccion no esta disponible con la configuracion actual.',

    loadSettingsFailed: 'No se pudieron cargar los ajustes de traduccion.',
    saveSettingsSuccess: 'Ajustes de traduccion guardados localmente.',
    saveSettingsFailed: 'No se pudieron guardar los ajustes de traduccion.',
    loadLanguagesSuccess: 'Se cargaron {count} idiomas de destino de {provider}{suffix}.',
    loadLanguagesFailed: 'No se pudieron cargar los idiomas del proveedor.',
    clearKeysSuccess: 'Se borraron las claves API guardadas.',
    clearKeysFailed: 'No se pudieron borrar las claves API guardadas.',
    presetApplied: 'Preajuste local de SMaLL-100 aplicado (destino: {target}).',
    presetFailed: 'No se pudo aplicar el preajuste local.',

    loadingTranslationSettings: 'Cargando ajustes de traduccion...',
    inlineTranslationTitle: 'Traduccion en linea',
    inlineTranslationIntro: 'Las notas, articulos y biografias se traducen en linea cuando un proveedor esta configurado. Las claves API se cifran localmente cuando el navegador soporta Web Crypto e IndexedDB. No se envian claves a los relays.',
    providerLabel: 'Proveedor',
    useLocalDefaults: 'Usar valores locales de SMaLL-100',
    transportLabel: 'Transporte',
    storageLabel: 'Almacenamiento',
    storageEncrypted: 'Persistencia local cifrada',
    storageSessionOnly: 'Solo sesion',
    queueMetricsLabel: 'Mostrar metricas de cola de auto-traduccion en el feed (dev)',
    loadingLanguages: 'Cargando...',
    loadLanguages: 'Cargar idiomas',
    saving: 'Guardando...',
    saveSettings: 'Guardar ajustes',
    clearing: 'Borrando...',
    clearStoredKeys: 'Borrar claves API guardadas',

    gemmaUnavailableSummary: 'No disponible hasta que se configure un modelo local de Gemma y el navegador exponga WebGPU.',
    gemmaTransportSummary: 'Se ejecuta completamente en el dispositivo usando WebGPU y el modelo local de Gemma 4. Ningun texto de traduccion sale de tu navegador.',
    gemmaUnavailableError: 'La traduccion local con Gemma no esta disponible. Configura un modelo local y usa un navegador compatible con WebGPU.',
    gemmaTranslationFailed: 'La traduccion con Gemma fallo.',
    gemmaReturnedEmpty: 'Gemma devolvio una traduccion vacia.',
    geminiTransportSummary: 'Usa la API en la nube de Google Gemini por HTTPS. El texto traducido se envia a Google para su procesamiento.',
    geminiMissingApiKey: 'Primero agrega una clave API de Gemini en Ajustes.',
    geminiTranslationFailed: 'La traduccion con Gemini fallo.',
    geminiReturnedEmpty: 'Gemini devolvio una traduccion vacia.',
    geminiMalformedResponse: 'Gemini devolvio una respuesta no valida.',
    geminiPromptBlocked: 'Gemini bloqueo esta solicitud de traduccion ({reason}).',
  },
}

function resolveLocale(): TranslationUiLocale {
  const language = getBrowserLanguage()
  const normalized = language?.toLowerCase().trim() ?? ''
  const [primary] = normalized.split('-')
  if (primary === 'es') return 'es'
  return FALLBACK_LOCALE
}

function interpolate(template: string, vars: Record<string, string | number> | undefined): string {
  if (!vars) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key: string) => {
    const value = vars[key]
    return value === undefined ? full : String(value)
  })
}

export function tTranslationUi(
  key: string,
  vars?: Record<string, string | number>,
): string {
  const locale = resolveLocale()
  const localeMessages = MESSAGES[locale]
  const fallbackMessages = MESSAGES[FALLBACK_LOCALE]
  const template = localeMessages[key] ?? fallbackMessages[key] ?? key
  return interpolate(template, vars)
}
