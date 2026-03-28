interface ResolveAppBaseUrlOptions {
  preferPublicOrigin?: boolean
}

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    const protocol = parsed.protocol.toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

function getRuntimeLocationOrigin(): string | null {
  try {
    return normalizeOrigin(globalThis.location?.origin)
  } catch {
    return null
  }
}

export function resolveAppBaseUrl(options: ResolveAppBaseUrlOptions = {}): string | null {
  const { preferPublicOrigin = true } = options
  const envOrigin = normalizeOrigin(import.meta.env.VITE_PUBLIC_APP_ORIGIN as string | undefined)
  const runtimeOrigin = getRuntimeLocationOrigin()

  if (preferPublicOrigin) {
    return envOrigin ?? runtimeOrigin
  }

  return runtimeOrigin ?? envOrigin
}

export function resolveAppUrl(input: string, options: ResolveAppBaseUrlOptions = {}): URL | null {
  try {
    return new URL(input)
  } catch {
    // Continue with app-relative resolution.
  }

  const baseUrl = resolveAppBaseUrl(options)
  if (!baseUrl) return null

  try {
    return new URL(input, baseUrl)
  } catch {
    return null
  }
}
