const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/
const IPV4_MAPPED_IPV6_PREFIX = '::ffff:'
const LINK_LOCAL_IPV6_RE = /^fe[89ab][0-9a-f:]*/i

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase()

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function isLocalIpv4(hostname: string): boolean {
  if (!IPV4_RE.test(hostname)) return false

  const octets = hostname.split('.').map((segment) => Number(segment))
  if (octets.some((segment) => Number.isNaN(segment) || segment < 0 || segment > 255)) {
    return false
  }

  const [first = -1, second = -1, third = -1, fourth = -1] = octets

  return (
    (first === 0 && second === 0 && third === 0 && fourth === 0) ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function isLocalIpv6(hostname: string): boolean {
  return (
    hostname === '::1' ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    LINK_LOCAL_IPV6_RE.test(hostname)
  )
}

export function isLocalDevelopmentHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  if (!normalized) return false

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true
  }

  if (isLocalIpv4(normalized)) return true

  if (normalized.startsWith(IPV4_MAPPED_IPV6_PREFIX)) {
    return isLocalIpv4(normalized.slice(IPV4_MAPPED_IPV6_PREFIX.length))
  }

  return isLocalIpv6(normalized)
}
