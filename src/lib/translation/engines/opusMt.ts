/**
 * Opus-MT in-browser translation engine.
 *
 * Uses @huggingface/transformers (ONNX Runtime Web / WebAssembly) to run
 * Helsinki-NLP Opus-MT models directly in the browser. After the first
 * download (~50–300 MB per model pair) the model is cached by the browser
 * and runs fully offline.
 *
 * Requirements:
 *   - The app must serve COOP/COEP headers (already done via service worker)
 *     so SharedArrayBuffer is available for the WASM runtime.
 *   - CSP must allow 'wasm-unsafe-eval' for ONNX Runtime Web.
 *
 * Not all language pairs are available. See SUPPORTED_PAIRS below.
 * For wider language coverage use SMaLL-100 instead.
 */

import { pipeline, env } from '@huggingface/transformers'
import { TranslationServiceError } from '@/lib/translation/errors'
import { detectScriptLanguage } from '@/lib/translation/detect'

// Use HuggingFace Hub; do not attempt to load from local filesystem
env.allowLocalModels = false
env.allowRemoteModels = true

// Cap the in-memory pipeline cache to avoid excessive RAM usage
// (the library manages the model weight cache in browser storage separately)
const MAX_PIPELINE_CACHE = 3
type TranslationPipeline = (text: string) => Promise<Array<{ translation_text?: string }>>

const pipelineCache = new Map<string, TranslationPipeline>()
const pipelineAccessOrder: string[] = []
const MARIAN_FAST_TOKENIZER_WARNING_FRAGMENT = 'MarianTokenizer'

// Xenova/Opus-MT model IDs — confirmed ONNX conversions on HuggingFace Hub.
// Keys are "src-tgt" using BCP-47 2-letter codes (lowercase).
export const OPUS_MT_SUPPORTED_PAIRS: Record<string, string> = {
  'en-ar': 'Xenova/opus-mt-en-ar',
  'en-cs': 'Xenova/opus-mt-en-cs',
  'en-de': 'Xenova/opus-mt-en-de',
  'en-es': 'Xenova/opus-mt-en-es',
  'en-fi': 'Xenova/opus-mt-en-fi',
  'en-fr': 'Xenova/opus-mt-en-fr',
  'en-hu': 'Xenova/opus-mt-en-hu',
  'en-id': 'Xenova/opus-mt-en-id',
  'en-it': 'Xenova/opus-mt-en-it',
  'en-ja': 'Xenova/opus-mt-en-jap',
  'en-ko': 'Xenova/opus-mt-en-ko',
  'en-nl': 'Xenova/opus-mt-en-nl',
  'en-pl': 'Xenova/opus-mt-en-pl',
  'en-pt': 'Xenova/opus-mt-en-pt',
  'en-ro': 'Xenova/opus-mt-en-ro',
  'en-ru': 'Xenova/opus-mt-en-ru',
  'en-sv': 'Xenova/opus-mt-en-sv',
  'en-tr': 'Xenova/opus-mt-en-tr',
  'en-uk': 'Xenova/opus-mt-en-uk',
  'en-vi': 'Xenova/opus-mt-en-vi',
  'en-zh': 'Xenova/opus-mt-en-zh',
  'ar-en': 'Xenova/opus-mt-ar-en',
  'cs-en': 'Xenova/opus-mt-cs-en',
  'de-en': 'Xenova/opus-mt-de-en',
  'es-en': 'Xenova/opus-mt-es-en',
  'fi-en': 'Xenova/opus-mt-fi-en',
  'fr-en': 'Xenova/opus-mt-fr-en',
  'hu-en': 'Xenova/opus-mt-hu-en',
  'id-en': 'Xenova/opus-mt-id-en',
  'it-en': 'Xenova/opus-mt-it-en',
  'ja-en': 'Xenova/opus-mt-jap-en',
  'ko-en': 'Xenova/opus-mt-ko-en',
  'nl-en': 'Xenova/opus-mt-nl-en',
  'pl-en': 'Xenova/opus-mt-pl-en',
  'pt-en': 'Xenova/opus-mt-pt-en',
  'ro-en': 'Xenova/opus-mt-ro-en',
  'ru-en': 'Xenova/opus-mt-ru-en',
  'sv-en': 'Xenova/opus-mt-sv-en',
  'tr-en': 'Xenova/opus-mt-tr-en',
  'uk-en': 'Xenova/opus-mt-uk-en',
  'vi-en': 'Xenova/opus-mt-vi-en',
  'zh-en': 'Xenova/opus-mt-zh-en',
}

const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic', cs: 'Czech', de: 'German', en: 'English', es: 'Spanish',
  fi: 'Finnish', fr: 'French', hu: 'Hungarian', id: 'Indonesian',
  it: 'Italian', ja: 'Japanese', ko: 'Korean', nl: 'Dutch', pl: 'Polish',
  pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sv: 'Swedish',
  tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese', zh: 'Chinese',
}

export function normalizeLangCode(code: string): string {
  return code.trim().toLowerCase().split('-')[0] ?? ''
}

export function getOpusMtModelId(sourceLang: string, targetLang: string): string | null {
  const src = normalizeLangCode(sourceLang)
  const tgt = normalizeLangCode(targetLang)
  return OPUS_MT_SUPPORTED_PAIRS[`${src}-${tgt}`] ?? null
}

export function listOpusMtLanguages(): Array<{ code: string; name: string }> {
  const seen = new Set<string>()
  for (const pair of Object.keys(OPUS_MT_SUPPORTED_PAIRS)) {
    const [src, tgt] = pair.split('-')
    if (src) seen.add(src)
    if (tgt) seen.add(tgt)
  }
  return [...seen]
    .sort()
    .map(code => ({ code, name: LANGUAGE_NAMES[code] ?? code.toUpperCase() }))
}

async function getOrCreatePipeline(modelId: string): Promise<TranslationPipeline> {
  const cached = pipelineCache.get(modelId)
  if (cached) {
    // Move to end of access order (LRU)
    const idx = pipelineAccessOrder.indexOf(modelId)
    if (idx !== -1) pipelineAccessOrder.splice(idx, 1)
    pipelineAccessOrder.push(modelId)
    return cached
  }

  // Evict least recently used if at capacity
  if (pipelineCache.size >= MAX_PIPELINE_CACHE) {
    const evict = pipelineAccessOrder.shift()
    if (evict) pipelineCache.delete(evict)
  }

  // Load from HuggingFace Hub and cache
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    const first = args[0]
    if (typeof first === 'string' && first.includes(MARIAN_FAST_TOKENIZER_WARNING_FRAGMENT)) {
      return
    }
    originalWarn(...args)
  }

  let pipe: TranslationPipeline
  try {
    pipe = await pipeline('translation', modelId, { dtype: 'q8' }) as unknown as TranslationPipeline
  } finally {
    console.warn = originalWarn
  }

  pipelineCache.set(modelId, pipe)
  pipelineAccessOrder.push(modelId)
  return pipe
}

export async function translateWithOpusMt(
  text: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<{ translation: string }> {
  let src = normalizeLangCode(sourceLang)
  const tgt = normalizeLangCode(targetLang)

  if (src === 'auto') {
    const detected = detectScriptLanguage(text)
    if (!detected) {
      // Latin-script or unrecognised — can't determine language without a
      // language-detection API.  Silently skip so the panel stays hidden.
      throw new TranslationServiceError(
        'Opus-MT could not determine the source language from the text script. Set a source language in Settings or switch to TransLang / SMaLL-100.',
        { code: 'config' },
      )
    }
    src = detected
  }

  const modelId = getOpusMtModelId(src, tgt)
  if (!modelId) {
    throw new TranslationServiceError(
      `Opus-MT has no model for ${src}→${tgt}. Use TransLang or SMaLL-100 for broader language coverage.`,
      { code: 'config' },
    )
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const pipe = await getOrCreatePipeline(modelId)

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  // @huggingface/transformers v3 pipeline output: [{translation_text: string}]
  const result = await pipe(text)

  if (!Array.isArray(result) || result.length === 0) {
    throw new TranslationServiceError('Opus-MT returned an empty result.', { code: 'parse' })
  }

  const first = result[0] as Record<string, unknown>
  if (typeof first.translation_text !== 'string') {
    throw new TranslationServiceError('Opus-MT returned an unexpected result format.', { code: 'parse' })
  }

  return { translation: first.translation_text.trim() }
}
