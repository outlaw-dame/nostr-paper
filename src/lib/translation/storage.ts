import { createStore, del, get, set } from 'idb-keyval'
import { getBrowserLanguage } from '@/lib/translation/detect'

export type TranslationProvider = 'deepl' | 'libretranslate' | 'small100' | 'opusmt' | 'translang' | 'lingva' | 'gemma' | 'gemini'
export type DeepLApiPlan = 'free' | 'pro'
export type TranslationStorageMode = 'encrypted-indexeddb' | 'session-only'

export interface TranslationPreferences {
  provider: TranslationProvider
  deeplPlan: DeepLApiPlan
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
  small100BaseUrl: string
  small100TargetLanguage: string
  small100SourceLanguage: string
  opusMtTargetLanguage: string
  opusMtSourceLanguage: string
  gemmaTargetLanguage: string
  gemmaSourceLanguage: string
  geminiModel: string
  geminiTargetLanguage: string
  geminiSourceLanguage: string
}

export interface TranslationSecrets {
  deeplAuthKey: string
  libreApiKey: string
  geminiApiKey: string
}

export interface TranslationConfiguration extends TranslationPreferences, TranslationSecrets {}

interface EncryptedSecretRecord {
  iv: string
  ciphertext: string
}

interface EncryptedSecretBundle {
  deeplAuthKey?: EncryptedSecretRecord
  libreApiKey?: EncryptedSecretRecord
  geminiApiKey?: EncryptedSecretRecord
}

const TRANSLATION_DB_NAME = 'nostr-paper-translation'
const PREFERENCES_STORE = createStore(TRANSLATION_DB_NAME, 'preferences')
const SECRETS_STORE = createStore(TRANSLATION_DB_NAME, 'secrets')
const PREFERENCES_KEY = 'translation-preferences'
const SECRET_KEY_KEY = 'translation-crypto-key'
const ENCRYPTED_SECRETS_KEY = 'translation-encrypted-secrets'
const MAX_SECRET_CHARS = 256
const DEV_QUEUE_METRICS_PREF_KEY = 'translation-dev-queue-metrics-enabled'
const DEFAULT_DEEPL_AUTH_KEY = sanitizeSecret(
  typeof import.meta.env.VITE_DEEPL_AUTH_KEY === 'string'
    ? import.meta.env.VITE_DEEPL_AUTH_KEY
    : '',
)
const DEFAULT_GEMINI_API_KEY = sanitizeSecret(
  typeof import.meta.env.VITE_GEMINI_API_KEY === 'string'
    ? import.meta.env.VITE_GEMINI_API_KEY
    : '',
)

export const TRANSLATION_SETTINGS_UPDATED_EVENT = 'nostr-paper:translation-settings-updated'

const DEFAULT_PREFERENCES: TranslationPreferences = {
  provider: 'deepl',
  deeplPlan: 'free',
  deeplTargetLanguage: 'EN-US',
  deeplSourceLanguage: 'auto',
  libreBaseUrl: '',
  libreTargetLanguage: 'en',
  libreSourceLanguage: 'auto',
  translangBaseUrl: '',
  translangTargetLanguage: 'en',
  translangSourceLanguage: 'auto',
  lingvaBaseUrl: '',
  lingvaTargetLanguage: 'en',
  lingvaSourceLanguage: 'auto',
  small100BaseUrl: 'http://localhost:7080',
  small100TargetLanguage: 'en',
  small100SourceLanguage: 'auto',
  opusMtTargetLanguage: 'en',
  opusMtSourceLanguage: 'auto',
  gemmaTargetLanguage: 'en',
  gemmaSourceLanguage: 'auto',
  geminiModel: 'gemini-2.5-flash',
  geminiTargetLanguage: 'en',
  geminiSourceLanguage: 'auto',
}

const DEFAULT_SECRETS: TranslationSecrets = {
  deeplAuthKey: DEFAULT_DEEPL_AUTH_KEY,
  libreApiKey: '',
  geminiApiKey: DEFAULT_GEMINI_API_KEY,
}

let memoryPreferences = { ...DEFAULT_PREFERENCES }
let memorySecrets = { ...DEFAULT_SECRETS }
let memoryCryptoKey: CryptoKey | null = null
let cachedConfiguration: TranslationConfiguration | null = null

function getBrowserTargetLanguageFallback(): string | null {
  return getBrowserLanguage()
}

function canUsePersistentStorage(): boolean {
  return (
    typeof globalThis.indexedDB !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined'
  )
}

function emitTranslationSettingsUpdated(): void {
  if (typeof globalThis.window === 'undefined') return
  globalThis.window.dispatchEvent(new CustomEvent(TRANSLATION_SETTINGS_UPDATED_EVENT))
}

export function loadTranslationDevQueueMetricsEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  if (typeof globalThis.localStorage === 'undefined') return true

  try {
    const rawValue = globalThis.localStorage.getItem(DEV_QUEUE_METRICS_PREF_KEY)
    return rawValue !== 'false'
  } catch {
    return true
  }
}

export function saveTranslationDevQueueMetricsEnabled(enabled: boolean): void {
  if (!import.meta.env.DEV) return
  if (typeof globalThis.localStorage === 'undefined') return

  try {
    globalThis.localStorage.setItem(DEV_QUEUE_METRICS_PREF_KEY, enabled ? 'true' : 'false')
  } catch {
    return
  }

  emitTranslationSettingsUpdated()
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return globalThis.btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function sanitizeSecret(secret: string | undefined): string {
  return typeof secret === 'string' ? secret.trim().slice(0, MAX_SECRET_CHARS) : ''
}

function isAsciiAlphaNumeric(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0)
    const isDigit = code >= 48 && code <= 57
    const isUpper = code >= 65 && code <= 90
    const isLower = code >= 97 && code <= 122
    if (!isDigit && !isUpper && !isLower) return false
  }
  return true
}

function isStructuredLanguageCode(
  value: string,
  options: { primaryMin: number; primaryMax: number; primaryCase: 'upper' | 'lower'; allowAuto: boolean },
): boolean {
  if (options.allowAuto && value === 'auto') return true

  const parts = value.split('-')
  if (parts.length === 0 || parts.length > 2) return false

  const [primary = '', secondary] = parts
  if (primary.length < options.primaryMin || primary.length > options.primaryMax) return false
  if (!isAsciiAlphaNumeric(primary)) return false

  const normalizedPrimary =
    options.primaryCase === 'upper' ? primary.toUpperCase() : primary.toLowerCase()
  if (primary !== normalizedPrimary) return false

  if (secondary === undefined) return true
  if (secondary.length < 2 || secondary.length > 8) return false
  return isAsciiAlphaNumeric(secondary)
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

function normalizeRemoteUrl(rawUrl: string | undefined): string {
  if (typeof rawUrl !== 'string') return ''

  const trimmed = rawUrl.trim()
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol === 'https:') {
      return parsed.href.replace(/\/+$/, '')
    }

    if (import.meta.env.DEV && protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
      return parsed.href.replace(/\/+$/, '')
    }

    return ''
  } catch {
    return ''
  }
}

function normalizeLocalServiceUrl(rawUrl: string | undefined): string {
  if (typeof rawUrl !== 'string') return ''
  const trimmed = rawUrl.trim()
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol === 'https:') return parsed.href.replace(/\/+$/, '')
    // HTTP loopback is always allowed (browser treats localhost as secure context)
    if (protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
      return parsed.href.replace(/\/+$/, '')
    }
    // In dev, allow HTTP LAN addresses for testing (e.g. NAS at 192.168.x.x)
    if (import.meta.env.DEV && protocol === 'http:') {
      return parsed.href.replace(/\/+$/, '')
    }
    return ''
  } catch {
    return ''
  }
}

function normalizeDeepLLanguage(value: string | undefined, allowAuto = false, fallback = DEFAULT_PREFERENCES.deeplTargetLanguage): string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (allowAuto && normalized === 'AUTO') return 'auto'
  if (!normalized) return allowAuto ? 'auto' : fallback
  if (isStructuredLanguageCode(normalized, { primaryMin: 2, primaryMax: 3, primaryCase: 'upper', allowAuto: false })) {
    return normalized
  }
  return allowAuto ? 'auto' : fallback
}

function normalizeLibreLanguage(value: string | undefined, allowAuto = false, fallback = DEFAULT_PREFERENCES.libreTargetLanguage): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (allowAuto && normalized === 'auto') return 'auto'
  if (!normalized) return allowAuto ? 'auto' : fallback
  if (isStructuredLanguageCode(normalized, { primaryMin: 2, primaryMax: 3, primaryCase: 'lower', allowAuto: false })) {
    // Most non-DeepL engines use ISO-639 base codes for routing/model selection.
    // Normalize region variants like "en-us" to "en" for broad compatibility.
    const [primary] = normalized.split('-')
    return primary ?? normalized
  }
  return allowAuto ? 'auto' : fallback
}

function normalizeTranslangLanguage(value: string | undefined, allowAuto = false, fallback = DEFAULT_PREFERENCES.translangTargetLanguage): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return allowAuto ? 'auto' : fallback
  if (allowAuto && normalized.toLowerCase() === 'auto') return 'auto'
  if (!isStructuredLanguageCode(normalized.toLowerCase(), { primaryMin: 2, primaryMax: 3, primaryCase: 'lower', allowAuto: false })) {
    return allowAuto ? 'auto' : fallback
  }

  const [primary, ...rest] = normalized.split('-')
  return [
    primary?.toLowerCase() ?? '',
    ...rest.map((part) => {
      if (part.length === 2) return part.toUpperCase()
      if (part.length === 4) return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`
      return part.toLowerCase()
    }),
  ].join('-')
}

function normalizeGeminiModel(value: string | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return DEFAULT_PREFERENCES.geminiModel
  return /^[a-z0-9][a-z0-9._-]*$/i.test(normalized)
    ? normalized
    : DEFAULT_PREFERENCES.geminiModel
}

export function normalizeTranslationPreferences(
  input: Partial<TranslationPreferences> | null | undefined,
): TranslationPreferences {
  const raw = input ?? {}
  const browserTarget = getBrowserTargetLanguageFallback()
  const deeplTargetFallback = browserTarget
    ? normalizeDeepLLanguage(browserTarget, false)
    : DEFAULT_PREFERENCES.deeplTargetLanguage
  const libreTargetFallback = browserTarget
    ? normalizeLibreLanguage(browserTarget, false)
    : DEFAULT_PREFERENCES.libreTargetLanguage
  const translangTargetFallback = browserTarget
    ? normalizeTranslangLanguage(browserTarget, false)
    : DEFAULT_PREFERENCES.translangTargetLanguage

  return {
    provider: raw.provider === 'deepl' ? 'deepl'
      : raw.provider === 'libretranslate' ? 'libretranslate'
      : raw.provider === 'translang' ? 'translang'
      : raw.provider === 'lingva' ? 'lingva'
      : raw.provider === 'small100' ? 'small100'
      : raw.provider === 'opusmt' ? 'opusmt'
      : raw.provider === 'gemma' ? 'gemma'
      : raw.provider === 'gemini' ? 'gemini'
      : DEFAULT_PREFERENCES.provider,
    deeplPlan: raw.deeplPlan === 'pro' ? 'pro' : 'free',
    deeplTargetLanguage: normalizeDeepLLanguage(raw.deeplTargetLanguage, false, deeplTargetFallback),
    deeplSourceLanguage: normalizeDeepLLanguage(raw.deeplSourceLanguage, true),
    libreBaseUrl: normalizeRemoteUrl(raw.libreBaseUrl),
    libreTargetLanguage: normalizeLibreLanguage(raw.libreTargetLanguage, false, libreTargetFallback),
    libreSourceLanguage: normalizeLibreLanguage(raw.libreSourceLanguage, true),
    translangBaseUrl: typeof raw.translangBaseUrl === 'string'
      ? normalizeRemoteUrl(raw.translangBaseUrl)
      : DEFAULT_PREFERENCES.translangBaseUrl,
    translangTargetLanguage: normalizeTranslangLanguage(raw.translangTargetLanguage, false, translangTargetFallback),
    translangSourceLanguage: normalizeTranslangLanguage(raw.translangSourceLanguage, true),
    lingvaBaseUrl: typeof raw.lingvaBaseUrl === 'string'
      ? normalizeRemoteUrl(raw.lingvaBaseUrl)
      : DEFAULT_PREFERENCES.lingvaBaseUrl,
    lingvaTargetLanguage: normalizeLibreLanguage(raw.lingvaTargetLanguage, false, libreTargetFallback),
    lingvaSourceLanguage: normalizeLibreLanguage(raw.lingvaSourceLanguage, true),
    small100BaseUrl: normalizeLocalServiceUrl(raw.small100BaseUrl),
    small100TargetLanguage: normalizeLibreLanguage(raw.small100TargetLanguage, false, libreTargetFallback),
    small100SourceLanguage: normalizeLibreLanguage(raw.small100SourceLanguage, true),
    opusMtTargetLanguage: normalizeLibreLanguage(raw.opusMtTargetLanguage, false, libreTargetFallback),
    opusMtSourceLanguage: normalizeLibreLanguage(raw.opusMtSourceLanguage, true),
    gemmaTargetLanguage: normalizeLibreLanguage(raw.gemmaTargetLanguage, false, libreTargetFallback),
    gemmaSourceLanguage: normalizeLibreLanguage(raw.gemmaSourceLanguage, true),
    geminiModel: normalizeGeminiModel(raw.geminiModel),
    geminiTargetLanguage: normalizeLibreLanguage(raw.geminiTargetLanguage, false, libreTargetFallback),
    geminiSourceLanguage: normalizeLibreLanguage(raw.geminiSourceLanguage, true),
  }
}

function mergeConfiguration(
  preferences: TranslationPreferences,
  secrets: TranslationSecrets,
): TranslationConfiguration {
  return {
    ...preferences,
    deeplAuthKey: sanitizeSecret(secrets.deeplAuthKey),
    libreApiKey: sanitizeSecret(secrets.libreApiKey),
    geminiApiKey: sanitizeSecret(secrets.geminiApiKey),
  }
}

async function getOrCreateCryptoKey(): Promise<CryptoKey> {
  if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
    throw new Error('Secure secret storage is unavailable in this browser.')
  }

  if (memoryCryptoKey) return memoryCryptoKey

  try {
    const storedKey = await get<CryptoKey>(SECRET_KEY_KEY, SECRETS_STORE)
    if (storedKey) {
      memoryCryptoKey = storedKey
      return storedKey
    }

    const key = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    await set(SECRET_KEY_KEY, key, SECRETS_STORE)
    memoryCryptoKey = key
    return key
  } catch {
    memoryCryptoKey = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    return memoryCryptoKey
  }
}

async function encryptSecret(secret: string): Promise<EncryptedSecretRecord> {
  const key = await getOrCreateCryptoKey()
  const iv = Uint8Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)))
  const encoded = Uint8Array.from(new TextEncoder().encode(secret))
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  )

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

async function decryptSecret(record: EncryptedSecretRecord): Promise<string> {
  const key = await getOrCreateCryptoKey()
  const iv = Uint8Array.from(base64ToBytes(record.iv))
  const ciphertext = Uint8Array.from(base64ToBytes(record.ciphertext))
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  )

  return new TextDecoder().decode(decrypted)
}

export function getTranslationStorageMode(): TranslationStorageMode {
  return canUsePersistentStorage() ? 'encrypted-indexeddb' : 'session-only'
}

export async function loadTranslationPreferences(): Promise<TranslationPreferences> {
  if (!canUsePersistentStorage()) {
    return { ...memoryPreferences }
  }

  try {
    const stored = await get<Partial<TranslationPreferences>>(PREFERENCES_KEY, PREFERENCES_STORE)
    const normalized = normalizeTranslationPreferences(stored)
    memoryPreferences = normalized
    return { ...normalized }
  } catch {
    return { ...memoryPreferences }
  }
}

export async function saveTranslationPreferences(
  preferences: Partial<TranslationPreferences>,
): Promise<TranslationPreferences> {
  const normalized = normalizeTranslationPreferences(preferences)
  memoryPreferences = normalized
  cachedConfiguration = null

  if (canUsePersistentStorage()) {
    try {
      await set(PREFERENCES_KEY, normalized, PREFERENCES_STORE)
    } catch {
      // Fall back to memory-only preferences.
    }
  }

  emitTranslationSettingsUpdated()
  return { ...normalized }
}

export async function loadTranslationSecrets(): Promise<TranslationSecrets> {
  if (!canUsePersistentStorage()) {
    return { ...memorySecrets }
  }

  try {
    const encrypted = await get<EncryptedSecretBundle>(ENCRYPTED_SECRETS_KEY, SECRETS_STORE)
    if (!encrypted) {
      return { ...memorySecrets }
    }

    const nextSecrets: TranslationSecrets = {
      deeplAuthKey: encrypted.deeplAuthKey ? await decryptSecret(encrypted.deeplAuthKey) : '',
      libreApiKey: encrypted.libreApiKey ? await decryptSecret(encrypted.libreApiKey) : '',
      geminiApiKey: encrypted.geminiApiKey ? await decryptSecret(encrypted.geminiApiKey) : '',
    }
    memorySecrets = {
      deeplAuthKey: sanitizeSecret(nextSecrets.deeplAuthKey),
      libreApiKey: sanitizeSecret(nextSecrets.libreApiKey),
      geminiApiKey: sanitizeSecret(nextSecrets.geminiApiKey),
    }
    return { ...memorySecrets }
  } catch {
    return { ...memorySecrets }
  }
}

export async function saveTranslationSecrets(
  secrets: Partial<TranslationSecrets>,
): Promise<TranslationSecrets> {
  const normalized: TranslationSecrets = {
    deeplAuthKey: sanitizeSecret(secrets.deeplAuthKey),
    libreApiKey: sanitizeSecret(secrets.libreApiKey),
    geminiApiKey: sanitizeSecret(secrets.geminiApiKey),
  }

  memorySecrets = normalized
  cachedConfiguration = null

  if (canUsePersistentStorage()) {
    try {
      const encrypted: EncryptedSecretBundle = {}
      if (normalized.deeplAuthKey) {
        encrypted.deeplAuthKey = await encryptSecret(normalized.deeplAuthKey)
      }
      if (normalized.libreApiKey) {
        encrypted.libreApiKey = await encryptSecret(normalized.libreApiKey)
      }
      if (normalized.geminiApiKey) {
        encrypted.geminiApiKey = await encryptSecret(normalized.geminiApiKey)
      }
      await set(ENCRYPTED_SECRETS_KEY, encrypted, SECRETS_STORE)
    } catch {
      // Fall back to memory-only secrets.
    }
  }

  emitTranslationSettingsUpdated()
  return { ...normalized }
}

export async function clearTranslationSecrets(): Promise<void> {
  memorySecrets = { ...DEFAULT_SECRETS }
  cachedConfiguration = null

  if (canUsePersistentStorage()) {
    try {
      await del(ENCRYPTED_SECRETS_KEY, SECRETS_STORE)
    } catch {
      // Keep in-memory state cleared even if persistent deletion fails.
    }
  }

  emitTranslationSettingsUpdated()
}

export async function loadTranslationConfiguration(): Promise<TranslationConfiguration> {
  if (cachedConfiguration) {
    return { ...cachedConfiguration }
  }

  const [preferences, secrets] = await Promise.all([
    loadTranslationPreferences(),
    loadTranslationSecrets(),
  ])

  // Migrate legacy defaults from opusmt -> deepl so auto-translate uses
  // DeepL unless the user explicitly chooses another provider.
  let effectivePreferences = preferences
  if (preferences.provider === 'opusmt') {
    effectivePreferences = {
      ...preferences,
      provider: 'deepl',
    }
    void saveTranslationPreferences(effectivePreferences).catch(() => {})
  }

  cachedConfiguration = mergeConfiguration(effectivePreferences, secrets)
  return { ...cachedConfiguration }
}
