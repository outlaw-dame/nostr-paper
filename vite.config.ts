import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

const DEV_NIP05_PROXY_PATH = '/__dev/nip05'
const DEV_NIP05_PROXY_TIMEOUT_MS = 8_000
const DEV_NIP05_PROXY_MAX_BYTES = 256_000

// ── Translation Proxies ─────────────────────────────────────
const DEV_DEEPL_PROXY_PATH = '/__dev/translate/deepl'
const DEV_LIBRE_PROXY_PATH = '/__dev/translate/libre'
const DEV_TRANSLATION_PROXY_TIMEOUT_MS = 12_000
const DEV_TRANSLATION_PROXY_MAX_BYTES = 512_000
const DEV_LINGVA_PROXY_PATH = '/__dev/translate/lingva'

// ── Tenor GIF Proxy ───────────────────────────────────────────
const DEV_TENOR_PROXY_PATH    = '/__dev/tenor'
const DEV_TENOR_TIMEOUT_MS    = 8_000
const TENOR_API_BASE          = 'https://tenor.googleapis.com/v2'

// ── OG Proxy ─────────────────────────────────────────────────
const DEV_OG_PROXY_PATH    = '/__dev/og'
const DEV_OG_TIMEOUT_MS    = 10_000
const DEV_OG_MAX_BYTES     = 512_000   // Only need <head>, stop early
const DEV_OG_MAX_REDIRECTS = 3

// ── Safe Browsing Proxy ───────────────────────────────────────
const DEV_SAFE_BROWSING_PROXY_PATH = '/__dev/safe-browsing'
const DEV_SAFE_BROWSING_TIMEOUT_MS = 8_000
const GOOGLE_SAFE_BROWSING_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find'

// ── Media Fetch Proxy ────────────────────────────────────────
const DEV_MEDIA_PROXY_PATH = '/__dev/media-fetch'
const DEV_MEDIA_PROXY_TIMEOUT_MS = 12_000
const DEV_MEDIA_PROXY_MAX_BYTES = 16 * 1024 * 1024
const DEV_MEDIA_PROXY_MAX_REDIRECTS = 3

// ── Feed Proxy ───────────────────────────────────────────────
const DEV_FEED_PROXY_PATH = '/__dev/feed'
const DEV_FEED_PROXY_TIMEOUT_MS = 12_000
const DEV_FEED_PROXY_MAX_BYTES = 1 * 1024 * 1024
const DEV_FEED_PROXY_MAX_REDIRECTS = 3
const DEV_SERVER_PORT = Number.parseInt(process.env.VITE_DEV_PORT ?? '5173', 10) || 5173
const ENABLE_LOCAL_CROSS_ORIGIN_ISOLATION = process.env.VITE_ENABLE_LOCAL_COI !== 'false'
const SAFE_BROWSING_BACKEND_ORIGIN = (process.env.SAFE_BROWSING_BACKEND_ORIGIN ?? 'http://127.0.0.1:7080').trim()
const LOCAL_CROSS_ORIGIN_ISOLATION_HEADERS = ENABLE_LOCAL_CROSS_ORIGIN_ISOLATION
  ? {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    }
  : undefined

function normalizeModuleId(id: string): string {
  return id.replace(/\\/g, '/')
}

function pickManualChunk(id: string): string | undefined {
  const normalized = normalizeModuleId(id)

  if (normalized.includes('/node_modules/')) {
    if (
      normalized.includes('/react/') ||
      normalized.includes('/react-dom/') ||
      normalized.includes('/react-router-dom/')
    ) {
      return 'react-vendor'
    }

    if (
      normalized.includes('/motion/') ||
      normalized.includes('/@use-gesture/')
    ) {
      return 'motion-vendor'
    }

    if (normalized.includes('/konsta/')) {
      return 'ui-vendor'
    }

    if (
      normalized.includes('/nostr-tools/') ||
      normalized.includes('/@nostr-dev-kit/ndk/') ||
      normalized.includes('/tseep/')
    ) {
      return 'nostr-vendor'
    }

    if (
      normalized.includes('/@huggingface/transformers/') ||
      normalized.includes('/onnxruntime-web/')
    ) {
      return 'ai-vendor'
    }

    if (normalized.includes('/idb-keyval/')) {
      return 'storage-vendor'
    }
  }

  if (
    normalized.includes('/src/lib/translation/') ||
    normalized.includes('/src/components/translation/')
  ) {
    return 'translation'
  }

  if (
    normalized.includes('/src/lib/semantic/') ||
    normalized.includes('/src/hooks/useKeywordFilters') ||
    normalized.includes('/src/hooks/useTagTimelineSemanticFeed')
  ) {
    return 'semantic'
  }

  if (
    normalized.includes('/src/lib/moderation/') ||
    normalized.includes('/src/hooks/useModeration') ||
    normalized.includes('/src/hooks/useMediaModeration') ||
    normalized.includes('/src/hooks/useHideNsfwTaggedPosts')
  ) {
    return 'moderation'
  }

  if (
    normalized.includes('/src/lib/db/') ||
    normalized.includes('/src/lib/nostr/') ||
    normalized.includes('/src/hooks/useNostrFeed') ||
    normalized.includes('/src/hooks/useProfile') ||
    normalized.includes('/src/hooks/useFollowStatus')
  ) {
    return 'nostr-core'
  }

  return undefined
}

// Private IP ranges — block to prevent SSRF in dev proxy
const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.0\.0\.0|::1|localhost)/i

function isAllowedOGTarget(url: URL): boolean {
  const { protocol, hostname } = url
  if (protocol !== 'https:' && protocol !== 'http:') return false
  if (PRIVATE_IP_RE.test(hostname)) return false
  return true
}

function isAllowedTranslationTarget(url: URL): boolean {
  const { protocol, hostname } = url
  if (protocol === 'https:' && !PRIVATE_IP_RE.test(hostname)) {
    return true
  }

  if (
    (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') &&
    (protocol === 'http:' || protocol === 'https:')
  ) {
    return true
  }

  return false
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d{1,6});/g, (_, n: string) => {
      const cp = parseInt(n, 10)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
    })
}

function extractAttr(tag: string, attr: string): string | null {
  // Handle both `attr="value"` and `attr='value'`
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']{0,2048})["']`, 'i')
  return tag.match(re)?.[1] ?? null
}

function jsonResponse(
  res: import('http').ServerResponse,
  statusCode: number,
  body: unknown,
  origin?: string | string[],
  cacheControl = 'no-store',
): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', cacheControl)
  res.setHeader('Access-Control-Allow-Origin', Array.isArray(origin) ? (origin[0] ?? '*') : (origin ?? '*'))
  res.end(JSON.stringify(body))
}

async function readJsonRequestBody(
  req: import('http').IncomingMessage,
  maxBytes = 64 * 1024,
): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.byteLength
    if (totalBytes > maxBytes) {
      throw new Error('Request body too large')
    }
    chunks.push(buffer)
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) return null

  return JSON.parse(raw)
}

function isTranslationJsonRequest(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeProxySecret(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 256) : ''
}

function sanitizeDeepLLanguage(value: unknown, allowAuto = false): string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (allowAuto && normalized === 'AUTO') return 'auto'
  if (!normalized) return ''
  return /^[A-Z]{2,3}(?:-[A-Z0-9]{2,8})?$/.test(normalized) ? normalized : ''
}

function sanitizeLibreLanguage(value: unknown, allowAuto = false): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (allowAuto && normalized === 'auto') return 'auto'
  if (!normalized) return ''
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(normalized) ? normalized : ''
}

interface OGResult {
  url:            string
  title?:         string
  description?:   string
  image?:         string
  siteName?:      string
  author?:        string
  nostrCreator?:  string
  nostrNip05?:    string
  favicon?:       string
}

function parseOGFromHtml(html: string, pageUrl: string): OGResult {
  // Limit to the first 50 KB of <head> — OG tags are always there
  const headEnd  = html.indexOf('</head>')
  const headHtml = headEnd >= 0 ? html.slice(0, headEnd) : html.slice(0, 50_000)

  const metaMap: Record<string, string> = {}

  // Extract all <meta ...> tags
  const META_RE = /<meta\s[^>]{1,2000}>/gi
  for (const [tag] of headHtml.matchAll(META_RE)) {
    // Attribute order can vary: name/property before or after content
    const key     = extractAttr(tag, 'name') ?? extractAttr(tag, 'property')
    const content = extractAttr(tag, 'content')
    if (key && content !== null) {
      const k = key.toLowerCase().trim()
      if (!(k in metaMap)) metaMap[k] = decodeHtmlEntities(content.trim())
    }
  }

  // Favicon — prefer <link rel="icon"> or <link rel="shortcut icon">
  let favicon: string | undefined
  const LINK_RE = /<link\s[^>]{1,1000}>/gi
  for (const [tag] of headHtml.matchAll(LINK_RE)) {
    const rel  = extractAttr(tag, 'rel')?.toLowerCase().trim() ?? ''
    const href = extractAttr(tag, 'href')
    if (href && (rel === 'icon' || rel === 'shortcut icon' || rel === 'apple-touch-icon')) {
      try {
        favicon = new URL(href, pageUrl).href
      } catch { /* skip malformed href */ }
      if (rel !== 'apple-touch-icon') break  // prefer non-apple icon
    }
  }

  // <title> fallback
  const titleTag = headHtml.match(/<title[^>]*>([^<]{1,300})<\/title>/i)
  const fallbackTitle = titleTag ? decodeHtmlEntities(titleTag[1].trim()) : undefined

  // JSON-LD author extraction
  let jsonLdAuthor: string | undefined
  const LD_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]{1,50000}?)<\/script>/gi
  for (const [, raw] of headHtml.matchAll(LD_RE)) {
    try {
      const data = JSON.parse(raw)
      const items: unknown[] = Array.isArray(data) ? data : [data]
      for (const item of items) {
        if (typeof item !== 'object' || item === null) continue
        const typed = item as Record<string, unknown>
        const t = String(typed['@type'] ?? '')
        if (t === 'Article' || t === 'NewsArticle' || t === 'BlogPosting') {
          const a = typed['author']
          if (typeof a === 'string' && a.trim()) {
            jsonLdAuthor = a.trim()
          } else if (typeof a === 'object' && a !== null) {
            const name = (a as Record<string, unknown>)['name']
            if (typeof name === 'string' && name.trim()) jsonLdAuthor = name.trim()
          }
          break
        }
      }
    } catch { /* malformed JSON-LD — skip */ }
    if (jsonLdAuthor) break
  }

  // Resolve relative image URL
  const rawImage = metaMap['og:image'] ?? metaMap['twitter:image']
  let image: string | undefined
  if (rawImage) {
    try { image = new URL(rawImage, pageUrl).href } catch { /* skip */ }
  }

  const author =
    jsonLdAuthor ??
    metaMap['author'] ??
    metaMap['article:author'] ??
    metaMap['twitter:creator'] ??
    undefined

  return {
    url:      pageUrl,
    title:    metaMap['og:title'] ?? metaMap['twitter:title'] ?? fallbackTitle,
    description: metaMap['og:description'] ?? metaMap['twitter:description'] ?? metaMap['description'],
    image,
    siteName: metaMap['og:site_name'],
    author,
    nostrCreator: metaMap['nostr:creator'],
    nostrNip05:   metaMap['nostr:creator:nip05'],
    favicon,
  }
}

function ogDevProxyPlugin() {
  return {
    name: 'og-dev-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(DEV_OG_PROXY_PATH)) {
          next()
          return
        }

        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Method Not Allowed' }))
          return
        }

        const reqUrl  = new URL(req.url, 'http://localhost')
        const rawTarget = reqUrl.searchParams.get('url') ?? ''

        let targetUrl: URL
        try {
          targetUrl = new URL(rawTarget)
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Invalid URL parameter' }))
          return
        }

        if (!isAllowedOGTarget(targetUrl)) {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Target URL not allowed' }))
          return
        }

        const timeoutSignal = AbortSignal.timeout(DEV_OG_TIMEOUT_MS)
        let currentUrl = targetUrl.href

        try {
          let upstream!: Response
          let redirects = 0

          // Manual redirect following so we can block redirects to private IPs
          while (redirects <= DEV_OG_MAX_REDIRECTS) {
            upstream = await fetch(currentUrl, {
              method:   'GET',
              headers:  {
                'Accept':          'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent':      'Mozilla/5.0 (compatible; NostrPaper/1.0; +https://github.com/nostr-paper)',
              },
              redirect: 'manual',
              signal:   timeoutSignal,
            })

            if (upstream.status >= 301 && upstream.status <= 308) {
              const location = upstream.headers.get('location')
              if (!location) break
              let next: URL
              try { next = new URL(location, currentUrl) } catch { break }
              if (!isAllowedOGTarget(next)) break
              currentUrl = next.href
              redirects++
              continue
            }
            break
          }

          if (!upstream.ok) {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: `Upstream responded with ${upstream.status}` }))
            return
          }

          // Read only up to DEV_OG_MAX_BYTES — we only need <head>
          const reader = upstream.body?.getReader()
          const chunks: Uint8Array[] = []
          let totalBytes = 0
          if (reader) {
            while (true) {
              const { done, value } = await reader.read()
              if (done || !value) break
              chunks.push(value)
              totalBytes += value.byteLength
              if (totalBytes >= DEV_OG_MAX_BYTES) {
                await reader.cancel()
                break
              }
            }
          }

          const buffer  = Buffer.concat(chunks.map(c => Buffer.from(c)))
          const charset = upstream.headers.get('content-type')?.match(/charset=([^\s;]+)/i)?.[1] ?? 'utf-8'
          const html    = buffer.toString(charset as BufferEncoding)
          const result  = parseOGFromHtml(html, currentUrl)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'public, max-age=300')
          res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
          res.end(JSON.stringify(result))
        } catch (error) {
          const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
          res.statusCode = isTimeout ? 504 : 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify({ error: isTimeout ? 'OG proxy timeout' : 'OG proxy request failed' }))
        }
      })
    },
  }
}

function safeBrowsingDevProxyPlugin() {
  return {
    name: 'safe-browsing-dev-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(DEV_SAFE_BROWSING_PROXY_PATH)) {
          next()
          return
        }

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
          res.end()
          return
        }

        if (req.method !== 'POST') {
          jsonResponse(res, 405, { error: 'Method Not Allowed' }, req.headers.origin)
          return
        }

        const apiKey = (process.env.GOOGLE_SAFE_BROWSING_API_KEY ?? '').trim()
        if (!apiKey) {
          jsonResponse(res, 503, { error: 'Safe Browsing API key not configured' }, req.headers.origin)
          return
        }

        const body = await readJsonRequestBody(req).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Invalid JSON request body'
          jsonResponse(res, 400, { error: message }, req.headers.origin)
          return null
        })

        if (!body) return
        if (typeof body !== 'object' || Array.isArray(body) || body === null) {
          jsonResponse(res, 400, { error: 'Invalid Safe Browsing payload' }, req.headers.origin)
          return
        }

        const rawUrl = typeof (body as Record<string, unknown>).url === 'string'
          ? (body as Record<string, string>).url.trim()
          : ''

        let targetUrl: URL
        try {
          targetUrl = new URL(rawUrl)
        } catch {
          jsonResponse(res, 400, { error: 'Invalid URL parameter' }, req.headers.origin)
          return
        }

        if (!isAllowedOGTarget(targetUrl)) {
          jsonResponse(res, 403, { error: 'Target URL not allowed' }, req.headers.origin)
          return
        }

        const payload = {
          client: {
            clientId: 'nostr-paper',
            clientVersion: '0.1.0',
          },
          threatInfo: {
            threatTypes: [
              'MALWARE',
              'SOCIAL_ENGINEERING',
              'UNWANTED_SOFTWARE',
              'POTENTIALLY_HARMFUL_APPLICATION',
            ],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url: targetUrl.href }],
          },
        }

        const endpoint = `${GOOGLE_SAFE_BROWSING_ENDPOINT}?key=${encodeURIComponent(apiKey)}`

        try {
          const upstream = await fetch(endpoint, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            redirect: 'error',
            signal: AbortSignal.timeout(DEV_SAFE_BROWSING_TIMEOUT_MS),
          })

          const responseJson = await upstream.json().catch(() => ({})) as { matches?: Array<{ threatType?: string }> }
          if (!upstream.ok) {
            jsonResponse(res, 502, { error: 'Safe Browsing upstream request failed' }, req.headers.origin)
            return
          }

          const matches = Array.isArray(responseJson.matches) ? responseJson.matches : []
          const threatTypes = matches
            .map((match) => (typeof match?.threatType === 'string' ? match.threatType : 'UNKNOWN'))
            .slice(0, 8)

          jsonResponse(
            res,
            200,
            {
              safe: threatTypes.length === 0,
              threatTypes,
            },
            req.headers.origin,
            'no-store',
          )
        } catch (error) {
          const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
          jsonResponse(
            res,
            isTimeout ? 504 : 502,
            { error: isTimeout ? 'Safe Browsing timeout' : 'Safe Browsing proxy request failed' },
            req.headers.origin,
          )
        }
      })
    },
  }
}

function mediaFetchDevProxyPlugin() {
  function makeMiddleware(): Parameters<import('vite').ViteDevServer['middlewares']['use']>[0] {
    return async (req, res, next) => {
      if (!req.url?.startsWith(DEV_MEDIA_PROXY_PATH)) {
        next()
        return
      }

      if (req.method !== 'GET') {
        jsonResponse(res, 405, { error: 'Method Not Allowed' }, req.headers.origin)
        return
      }

      const reqUrl = new URL(req.url, 'http://localhost')
      const rawTarget = reqUrl.searchParams.get('url') ?? ''

      let targetUrl: URL
      try {
        targetUrl = new URL(rawTarget)
      } catch {
        jsonResponse(res, 400, { error: 'Invalid URL parameter' }, req.headers.origin)
        return
      }

      if (!isAllowedOGTarget(targetUrl)) {
        jsonResponse(res, 403, { error: 'Target URL not allowed' }, req.headers.origin)
        return
      }

      const timeoutSignal = AbortSignal.timeout(DEV_MEDIA_PROXY_TIMEOUT_MS)
      let currentUrl = targetUrl.href

      try {
        let upstream!: Response
        let redirects = 0

        while (redirects <= DEV_MEDIA_PROXY_MAX_REDIRECTS) {
          upstream = await fetch(currentUrl, {
            method: 'GET',
            headers: {
              Accept: 'image/*,video/*,application/octet-stream;q=0.9,*/*;q=0.1',
              'User-Agent': 'Mozilla/5.0 (compatible; NostrPaper/1.0; +https://github.com/nostr-paper)',
            },
            redirect: 'manual',
            signal: timeoutSignal,
          })

          if (upstream.status >= 301 && upstream.status <= 308) {
            const location = upstream.headers.get('location')
            if (!location) break
            let nextTarget: URL
            try {
              nextTarget = new URL(location, currentUrl)
            } catch {
              break
            }
            if (!isAllowedOGTarget(nextTarget)) break
            currentUrl = nextTarget.href
            redirects++
            continue
          }

          break
        }

        if (!upstream.ok) {
          jsonResponse(res, 502, { error: `Upstream responded with ${upstream.status}` }, req.headers.origin)
          return
        }

        const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
        if (
          !contentType.toLowerCase().startsWith('image/') &&
          !contentType.toLowerCase().startsWith('video/') &&
          contentType.toLowerCase() !== 'application/octet-stream'
        ) {
          jsonResponse(res, 415, { error: 'Upstream asset is not image/video media' }, req.headers.origin)
          return
        }

        const buffer = Buffer.from(await upstream.arrayBuffer())
        if (buffer.byteLength > DEV_MEDIA_PROXY_MAX_BYTES) {
          jsonResponse(res, 413, { error: 'Upstream media too large' }, req.headers.origin)
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', contentType)
        res.setHeader('Cache-Control', 'public, max-age=300')
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
        res.end(buffer)
      } catch (error) {
        const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
        jsonResponse(
          res,
          isTimeout ? 504 : 502,
          { error: isTimeout ? 'Media fetch proxy timeout' : 'Media fetch proxy request failed' },
          req.headers.origin,
        )
      }
    }
  }

  return {
    name: 'media-fetch-dev-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(makeMiddleware())
    },
    configurePreviewServer(server: import('vite').PreviewServer) {
      server.middlewares.use(makeMiddleware())
    },
  }
}
function feedDevProxyPlugin() {
  return {
    name: 'feed-dev-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(DEV_FEED_PROXY_PATH)) {
          next()
          return
        }

        if (req.method !== 'GET') {
          jsonResponse(res, 405, { error: 'Method Not Allowed' }, req.headers.origin)
          return
        }

        const reqUrl = new URL(req.url, 'http://localhost')
        const rawTarget = reqUrl.searchParams.get('url') ?? ''

        let targetUrl: URL
        try {
          targetUrl = new URL(rawTarget)
        } catch {
          jsonResponse(res, 400, { error: 'Invalid URL parameter' }, req.headers.origin)
          return
        }

        if (!isAllowedOGTarget(targetUrl)) {
          jsonResponse(res, 403, { error: 'Target URL not allowed' }, req.headers.origin)
          return
        }

        const timeoutSignal = AbortSignal.timeout(DEV_FEED_PROXY_TIMEOUT_MS)
        let currentUrl = targetUrl.href

        try {
          let upstream!: Response
          let redirects = 0

          while (redirects <= DEV_FEED_PROXY_MAX_REDIRECTS) {
            upstream = await fetch(currentUrl, {
              method: 'GET',
              headers: {
                Accept: [
                  'application/feed+json',
                  'application/json',
                  'application/atom+xml',
                  'application/rss+xml',
                  'application/rdf+xml',
                  'application/xml',
                  'text/xml',
                  'text/plain;q=0.8',
                  '*/*;q=0.1',
                ].join(', '),
                'User-Agent': 'Mozilla/5.0 (compatible; NostrPaper/1.0; +https://github.com/nostr-paper)',
              },
              redirect: 'manual',
              signal: timeoutSignal,
            })

            if (upstream.status >= 301 && upstream.status <= 308) {
              const location = upstream.headers.get('location')
              if (!location) break
              let nextTarget: URL
              try {
                nextTarget = new URL(location, currentUrl)
              } catch {
                break
              }
              if (!isAllowedOGTarget(nextTarget)) break
              currentUrl = nextTarget.href
              redirects++
              continue
            }

            break
          }

          if (!upstream.ok) {
            jsonResponse(res, 502, { error: `Upstream responded with ${upstream.status}` }, req.headers.origin)
            return
          }

          const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
          const loweredType = contentType.toLowerCase()
          if (
            !loweredType.includes('xml') &&
            !loweredType.includes('json') &&
            !loweredType.startsWith('text/')
          ) {
            jsonResponse(res, 415, { error: 'Upstream asset is not a syndication document' }, req.headers.origin)
            return
          }

          const buffer = Buffer.from(await upstream.arrayBuffer())
          if (buffer.byteLength > DEV_FEED_PROXY_MAX_BYTES) {
            jsonResponse(res, 413, { error: 'Upstream feed too large' }, req.headers.origin)
            return
          }

          const charset = contentType.match(/charset=([^\s;]+)/i)?.[1]?.toLowerCase()
          let content: string
          try {
            content = buffer.toString((charset as BufferEncoding | undefined) ?? 'utf-8')
          } catch {
            content = buffer.toString('utf-8')
          }

          jsonResponse(
            res,
            200,
            {
              url: upstream.url || currentUrl,
              contentType,
              content,
            },
            req.headers.origin,
            'public, max-age=300',
          )
        } catch (error) {
          const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
          jsonResponse(
            res,
            isTimeout ? 504 : 502,
            { error: isTimeout ? 'Feed proxy timeout' : 'Feed proxy request failed' },
            req.headers.origin,
          )
        }
      })
    },
  }
}

function isValidDevProxyDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/\.+$/, '')
  if (!normalized || normalized.length > 253) return false

  const labels = normalized.split('.')
  if (labels.length < 2) return false

  return labels.every(label =>
    /^[a-z0-9-]{1,63}$/i.test(label) &&
    !label.startsWith('-') &&
    !label.endsWith('-'),
  )
}

function isValidDevProxyName(name: string): boolean {
  return /^[a-z0-9._-]{1,64}$/.test(name)
}

function tenorDevProxyPlugin() {
  return {
    name: 'tenor-dev-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(DEV_TENOR_PROXY_PATH)) {
          next()
          return
        }

        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Method Not Allowed' }))
          return
        }

        const apiKey = process.env.VITE_TENOR_API_KEY
        if (!apiKey) {
          // No key configured — return empty results so the picker just shows nothing
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify({ results: [], next: '' }))
          return
        }

        const url      = new URL(req.url, 'http://localhost')
        const endpoint = url.searchParams.get('endpoint') === 'featured' ? 'featured' : 'search'
        const q        = url.searchParams.get('q') ?? ''
        const limit    = url.searchParams.get('limit') ?? '20'
        const pos      = url.searchParams.get('pos') ?? ''

        const tenorParams = new URLSearchParams({
          key:          apiKey,
          client_key:   'nostr_paper',
          media_filter: 'gif,mediumgif,tinygif',
          limit,
        })
        if (endpoint === 'search' && q) tenorParams.set('q', q)
        if (pos) tenorParams.set('pos', pos)

        const tenorUrl = `${TENOR_API_BASE}/${endpoint}?${tenorParams}`

        try {
          const upstream = await fetch(tenorUrl, {
            signal: AbortSignal.timeout(DEV_TENOR_TIMEOUT_MS),
          })
          const body = await upstream.text()
          res.statusCode = upstream.status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'public, max-age=60')
          res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
          res.end(body)
        } catch (error) {
          const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
          res.statusCode = isTimeout ? 504 : 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify({ error: isTimeout ? 'Tenor proxy timeout' : 'Tenor proxy failed' }))
        }
      })
    },
  }
}

function translationDevProxyPlugin() {
  return {
    name: 'translation-dev-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (
          !req.url?.startsWith(DEV_DEEPL_PROXY_PATH) &&
          !req.url?.startsWith(DEV_LIBRE_PROXY_PATH)
        ) {
          next()
          return
        }

        if (req.method !== 'POST') {
          jsonResponse(res, 405, { error: 'Method Not Allowed' }, req.headers.origin)
          return
        }

        const reqUrl = new URL(req.url, 'http://localhost')
        const body = await readJsonRequestBody(req).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Invalid JSON request body'
          jsonResponse(res, 400, { error: message }, req.headers.origin)
          return null
        })

        if (body === null) return
        if (!isTranslationJsonRequest(body)) {
          jsonResponse(res, 400, { error: 'Invalid translation proxy payload' }, req.headers.origin)
          return
        }

        const timeoutSignal = AbortSignal.timeout(DEV_TRANSLATION_PROXY_TIMEOUT_MS)

        try {
          if (reqUrl.pathname.startsWith(DEV_DEEPL_PROXY_PATH)) {
            const authKey = sanitizeProxySecret(body.authKey)
            if (!authKey) {
              jsonResponse(res, 400, { error: 'Missing DeepL auth key' }, req.headers.origin)
              return
            }

            const plan = body.plan === 'pro' ? 'pro' : 'free'
            const baseUrl = plan === 'pro' ? 'https://api.deepl.com/v2' : 'https://api-free.deepl.com/v2'

            if (reqUrl.pathname === `${DEV_DEEPL_PROXY_PATH}/languages`) {
              const type = body.type === 'source' ? 'source' : 'target'
              const upstream = await fetch(`${baseUrl}/languages?type=${type}`, {
                method: 'GET',
                headers: {
                  Authorization: `DeepL-Auth-Key ${authKey}`,
                  Accept: 'application/json',
                },
                redirect: 'error',
                signal: timeoutSignal,
              })

              const buffer = Buffer.from(await upstream.arrayBuffer())
              if (buffer.byteLength > DEV_TRANSLATION_PROXY_MAX_BYTES) {
                jsonResponse(res, 413, { error: 'Upstream response too large' }, req.headers.origin)
                return
              }

              res.statusCode = upstream.status
              res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
              res.setHeader('Cache-Control', 'no-store')
              res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
              res.end(buffer)
              return
            }

            if (reqUrl.pathname !== `${DEV_DEEPL_PROXY_PATH}/translate`) {
              jsonResponse(res, 404, { error: 'Unknown DeepL proxy endpoint' }, req.headers.origin)
              return
            }

            const textInput = Array.isArray(body.text)
              ? body.text.filter((entry): entry is string => typeof entry === 'string')
              : typeof body.text === 'string'
                ? [body.text]
                : []
            const targetLang = sanitizeDeepLLanguage(body.targetLang, false)
            const sourceLang = sanitizeDeepLLanguage(body.sourceLang, true)

            if (textInput.length === 0 || textInput.some(entry => !entry.trim() || entry.length > 12_000)) {
              jsonResponse(res, 400, { error: 'DeepL translate payload must include 1-50 text items.' }, req.headers.origin)
              return
            }
            if (textInput.length > 50 || !targetLang) {
              jsonResponse(res, 400, { error: 'DeepL translate payload is invalid.' }, req.headers.origin)
              return
            }

            const upstream = await fetch(`${baseUrl}/translate`, {
              method: 'POST',
              headers: {
                Authorization: `DeepL-Auth-Key ${authKey}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                text: textInput,
                target_lang: targetLang,
                ...(sourceLang && sourceLang !== 'auto' ? { source_lang: sourceLang } : {}),
              }),
              redirect: 'error',
              signal: timeoutSignal,
            })

            const buffer = Buffer.from(await upstream.arrayBuffer())
            if (buffer.byteLength > DEV_TRANSLATION_PROXY_MAX_BYTES) {
              jsonResponse(res, 413, { error: 'Upstream response too large' }, req.headers.origin)
              return
            }

            res.statusCode = upstream.status
            res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
            res.end(buffer)
            return
          }

          const baseUrlRaw = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : ''
          if (!baseUrlRaw) {
            jsonResponse(res, 400, { error: 'Missing LibreTranslate base URL' }, req.headers.origin)
            return
          }

          let baseUrl: URL
          try {
            baseUrl = new URL(baseUrlRaw)
          } catch {
            jsonResponse(res, 400, { error: 'Invalid LibreTranslate base URL' }, req.headers.origin)
            return
          }

          if (!isAllowedTranslationTarget(baseUrl)) {
            jsonResponse(res, 403, { error: 'LibreTranslate target URL not allowed' }, req.headers.origin)
            return
          }

          const normalizedBase = baseUrl.href.replace(/\/+$/, '')

          if (reqUrl.pathname === `${DEV_LIBRE_PROXY_PATH}/languages`) {
            const upstream = await fetch(`${normalizedBase}/languages`, {
              method: 'GET',
              headers: {
                Accept: 'application/json',
              },
              redirect: 'error',
              signal: timeoutSignal,
            })

            const buffer = Buffer.from(await upstream.arrayBuffer())
            if (buffer.byteLength > DEV_TRANSLATION_PROXY_MAX_BYTES) {
              jsonResponse(res, 413, { error: 'Upstream response too large' }, req.headers.origin)
              return
            }

            res.statusCode = upstream.status
            res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
            res.end(buffer)
            return
          }

          if (reqUrl.pathname !== `${DEV_LIBRE_PROXY_PATH}/translate`) {
            jsonResponse(res, 404, { error: 'Unknown LibreTranslate proxy endpoint' }, req.headers.origin)
            return
          }

          const source = sanitizeLibreLanguage(body.source, true)
          const target = sanitizeLibreLanguage(body.target, false)
          const format = body.format === 'html' ? 'html' : 'text'
          const apiKey = sanitizeProxySecret(body.apiKey)
          const q = Array.isArray(body.q)
            ? body.q.filter((entry): entry is string => typeof entry === 'string')
            : typeof body.q === 'string'
              ? [body.q]
              : []

          if (!source || !target || q.length === 0 || q.some(entry => !entry.trim() || entry.length > 4_000)) {
            jsonResponse(res, 400, { error: 'LibreTranslate payload is invalid.' }, req.headers.origin)
            return
          }

          const formData = new FormData()
          for (const segment of q) {
            formData.append('q', segment)
          }
          formData.set('source', source)
          formData.set('target', target)
          formData.set('format', format)
          if (apiKey) {
            formData.set('api_key', apiKey)
          }

          const upstream = await fetch(`${normalizedBase}/translate`, {
            method: 'POST',
            body: formData,
            redirect: 'error',
            signal: timeoutSignal,
          })

          const buffer = Buffer.from(await upstream.arrayBuffer())
          if (buffer.byteLength > DEV_TRANSLATION_PROXY_MAX_BYTES) {
            jsonResponse(res, 413, { error: 'Upstream response too large' }, req.headers.origin)
            return
          }

          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
          res.end(buffer)
        } catch (error) {
          const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
          jsonResponse(
            res,
            isTimeout ? 504 : 502,
            { error: isTimeout ? 'Translation proxy timeout' : 'Translation proxy request failed' },
            req.headers.origin,
          )
        }
      })
    },
  }
}

function lingvaDevProxyPlugin() {
  return {
    name: 'lingva-dev-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(DEV_LINGVA_PROXY_PATH)) {
          next()
          return
        }

        if (req.method !== 'GET') {
          jsonResponse(res, 405, { error: 'Method Not Allowed' }, req.headers.origin)
          return
        }

        const reqUrl = new URL(req.url, 'http://localhost')
        const rawTarget = reqUrl.searchParams.get('url') ?? ''

        let targetUrl: URL
        try {
          targetUrl = new URL(rawTarget)
        } catch {
          jsonResponse(res, 400, { error: 'Invalid URL parameter' }, req.headers.origin)
          return
        }

        if (!isAllowedTranslationTarget(targetUrl)) {
          jsonResponse(res, 403, { error: 'Target URL not allowed' }, req.headers.origin)
          return
        }

        try {
          const upstream = await fetch(targetUrl, {
            signal: AbortSignal.timeout(DEV_TRANSLATION_PROXY_TIMEOUT_MS),
          })
          const body = await upstream.text()
          jsonResponse(res, upstream.status, JSON.parse(body), req.headers.origin)
        } catch (error) {
          const isTimeout = error instanceof DOMException && error.name === 'TimeoutError'
          jsonResponse(res, isTimeout ? 504 : 502, { error: isTimeout ? 'Lingva proxy timeout' : 'Lingva proxy failed' }, req.headers.origin)
        }
      })
    },
  }
}

function nip05DevProxyPlugin() {
  return {
    name: 'nip05-dev-proxy',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(DEV_NIP05_PROXY_PATH)) {
          next()
          return
        }

        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Method Not Allowed' }))
          return
        }

        const url = new URL(req.url, 'http://localhost')
        const domain = url.searchParams.get('domain') ?? ''
        const name = url.searchParams.get('name') ?? ''

        if (!isValidDevProxyDomain(domain) || !isValidDevProxyName(name)) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Invalid NIP-05 lookup parameters' }))
          return
        }

        const target = new URL(`https://${domain}/.well-known/nostr.json`)
        target.searchParams.set('name', name)

        const timeoutSignal = AbortSignal.timeout(DEV_NIP05_PROXY_TIMEOUT_MS)

        try {
          const upstream = await fetch(target, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
            },
            redirect: 'manual',
            signal: timeoutSignal,
          })

          // Upstream 404 means the name simply isn't registered — normalize to 200
          // with empty names so the browser doesn't log a noisy 404 console error.
          // nip05.ts will correctly treat a missing name as invalid.
          if (upstream.status === 404) {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
            res.end(JSON.stringify({ names: {}, relays: {} }))
            return
          }

          const buffer = Buffer.from(await upstream.arrayBuffer())
          if (buffer.byteLength > DEV_NIP05_PROXY_MAX_BYTES) {
            res.statusCode = 413
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'Upstream response too large' }))
            return
          }

          res.statusCode = upstream.status
          res.setHeader(
            'Content-Type',
            upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
          )
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
          res.end(buffer)
        } catch (error) {
          const isAbort = error instanceof DOMException && error.name === 'TimeoutError'
          res.statusCode = isAbort ? 504 : 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify({
            error: isAbort ? 'NIP-05 proxy timeout' : 'NIP-05 proxy request failed',
          }))
        }
      })
    },
  }
}

// Fixes .wasm files being served as text/html inside module Workers in dev mode
function wasmMimePlugin() {
  return {
    name: 'wasm-mime',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.endsWith('.wasm')) {
          res.setHeader('Content-Type', 'application/wasm')
          if (ENABLE_LOCAL_CROSS_ORIGIN_ISOLATION) {
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          }
        }
        next()
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      wasmMimePlugin(),
      tenorDevProxyPlugin(),
      translationDevProxyPlugin(),
      lingvaDevProxyPlugin(),
      nip05DevProxyPlugin(),
      safeBrowsingDevProxyPlugin(),
      ogDevProxyPlugin(),
      mediaFetchDevProxyPlugin(),
      feedDevProxyPlugin(),
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'prompt',
        devOptions: {
          // Keep service workers off during local Vite dev. We rely on the
          // normal dev server plus optional COI headers, and a dev SW can get
          // stuck controlling localhost even though the app explicitly skips SW
          // registration there.
          enabled: false,
          type: 'module',
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
          // Semantic search assets are large and only needed on demand. Keep
          // them out of the install-time precache so the app shell stays small.
          globIgnores: ['assets/ort-wasm-*.wasm', 'assets/semantic.worker-*.js', 'assets/moderation.worker-*.js', 'assets/mediaModeration.worker-*.js'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        manifest: {
          name: 'Nostr Paper',
          short_name: 'Paper',
          description: 'A local-first, decentralized social reader',
          theme_color: '#f4f0e8',
          background_color: '#f4f0e8',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          id: 'nostr-paper-pwa',
          icons: [
            { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/pwa-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          categories: ['social', 'news'],
          shortcuts: [
            {
              name: 'New Note',
              short_name: 'Compose',
              description: 'Compose a new Nostr note',
              url: '/?compose=true',
              icons: [{ src: '/icons/shortcut-compose.png', sizes: '96x96' }],
            },
          ],
        },
      }),
      mode === 'analyze' &&
        visualizer({ open: true, gzipSize: true, brotliSize: true }),
    ].filter(Boolean),

    resolve: {
      alias: [
        { find: /^tseep$/, replacement: resolve(__dirname, 'src/shims/tseep-safe.ts') },
        { find: '@lib', replacement: resolve(__dirname, 'src/lib') },
        { find: '@components', replacement: resolve(__dirname, 'src/components') },
        { find: '@hooks', replacement: resolve(__dirname, 'src/hooks') },
        { find: '@types', replacement: resolve(__dirname, 'src/types') },
        { find: '@contexts', replacement: resolve(__dirname, 'src/contexts') },
        { find: '@pages', replacement: resolve(__dirname, 'src/pages') },
        { find: '@styles', replacement: resolve(__dirname, 'src/styles') },
        { find: '@workers', replacement: resolve(__dirname, 'src/workers') },
        { find: '@', replacement: resolve(__dirname, 'src') },
      ],
    },

    assetsInclude: ['**/*.wasm'],

    server: {
      host: '0.0.0.0',
      port: DEV_SERVER_PORT,
      strictPort: true,
      headers: LOCAL_CROSS_ORIGIN_ISOLATION_HEADERS,
      proxy: {
        '/api/safe-browsing/check': {
          target: SAFE_BROWSING_BACKEND_ORIGIN,
          changeOrigin: true,
          rewrite: (path) => path.replace('/api/safe-browsing/check', '/safe-browsing/check'),
        },
      },
      fs: {
        allow: ['..'],
      },
    },

    preview: {
      headers: LOCAL_CROSS_ORIGIN_ISOLATION_HEADERS,
    },

    optimizeDeps: {
      exclude: ['@sqlite.org/sqlite-wasm', '@mediapipe/tasks-genai'],
    },

    worker: {
      format: 'es',
    },

    build: {
      target: 'es2022',
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: pickManualChunk,
        },
      },
    },

    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.tsx'],
      exclude: ['**/node_modules/**', '**/*.ui.test.ts', '**/*.ui.test.tsx'],
      pool: 'forks',
      poolOptions: {
        forks: {
          minForks: 1,
          maxForks: 1,
        },
      },
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
      },
    },
  }
})
