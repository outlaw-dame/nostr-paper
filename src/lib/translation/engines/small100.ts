/**
 * SMaLL-100 local daemon client.
 *
 * Expects a locally running HTTP service (default: http://localhost:7080)
 * implementing this contract:
 *
 *   GET  /health
 *        → { status: "ok", model: "small100" }
 *
 *   POST /translate
 *        body: { text: string, source_lang: string, target_lang: string }
 *          source_lang may be "auto"
 *        → { translation: string, detected_source_lang?: string }
 *
 *   GET  /languages
 *        → Array<{ code: string, name: string }>
 *
 * A ready-to-run Python daemon is provided in server/translate.py.
 */

import { TranslationServiceError } from '@/lib/translation/errors'
import { buildAbortController, cleanBaseUrl, isRecord } from '@/lib/translation/utils'

const HEALTH_TIMEOUT_MS = 3_000
const TRANSLATE_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 256_000

function normalizeCode(code: string): string {
  return code.trim().toLowerCase().split('-')[0] ?? 'auto'
}

async function small100Request(
  baseUrl: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = `${cleanBaseUrl(baseUrl)}${path}`
  const { controller, cleanup } = buildAbortController(timeoutMs, signal)

  let response: Response
  try {
    response = await globalThis.fetch(url, {
      ...init,
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  } catch (error) {
    cleanup()
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      throw new TranslationServiceError(
        'SMaLL-100 service did not respond in time. Is the daemon running?',
        { code: 'unavailable' },
      )
    }
    throw new TranslationServiceError(
      'SMaLL-100 service is not reachable. Start the daemon with: python server/translate.py',
      { code: 'unavailable' },
    )
  } finally {
    cleanup()
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const message = text.trim().slice(0, 120) || `HTTP ${response.status}`
    throw new TranslationServiceError(`SMaLL-100 error: ${message}`, {
      code: response.status >= 500 ? 'provider' : 'config',
      status: response.status,
    })
  }

  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new TranslationServiceError('SMaLL-100 response exceeded size limit.', { code: 'parse' })
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new TranslationServiceError('SMaLL-100 returned invalid JSON.', { code: 'parse' })
  }
}

export async function checkSmall100Health(baseUrl: string): Promise<boolean> {
  try {
    const payload = await small100Request(baseUrl, '/health', { method: 'GET' }, HEALTH_TIMEOUT_MS)
    return isRecord(payload) && payload.status === 'ok'
  } catch {
    return false
  }
}

export async function listSmall100Languages(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<Array<{ code: string; name: string }>> {
  const payload = await small100Request(baseUrl, '/languages', { method: 'GET' }, HEALTH_TIMEOUT_MS, signal)
  if (!Array.isArray(payload)) return []

  return payload
    .filter((entry): entry is { code: string; name: string } =>
      isRecord(entry) &&
      typeof entry.code === 'string' &&
      typeof entry.name === 'string',
    )
    .map(entry => ({
      code: (entry.code as string).trim().toLowerCase(),
      name: (entry.name as string).trim(),
    }))
    .filter(entry => entry.code && entry.name)
}

export async function translateWithSmall100(
  baseUrl: string,
  text: string,
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<{ translation: string; detectedSourceLang?: string }> {
  const payload = await small100Request(
    baseUrl,
    '/translate',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text,
        source_lang: normalizeCode(sourceLang),
        target_lang: normalizeCode(targetLang),
      }),
    },
    TRANSLATE_TIMEOUT_MS,
    signal,
  )

  if (!isRecord(payload) || typeof payload.translation !== 'string') {
    throw new TranslationServiceError('SMaLL-100 returned an invalid translation payload.', { code: 'parse' })
  }

  const detectedSourceLang =
    typeof payload.detected_source_lang === 'string' && payload.detected_source_lang.trim()
      ? payload.detected_source_lang.trim().toLowerCase()
      : undefined

  return {
    translation: payload.translation.trim(),
    ...(detectedSourceLang ? { detectedSourceLang } : {}),
  }
}
