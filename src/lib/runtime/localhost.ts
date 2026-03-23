const LOOPBACK_IPV4_RE = /^127(?:\.\d{1,3}){3}$/

export function isLocalDevelopmentHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    LOOPBACK_IPV4_RE.test(hostname)
  )
}
