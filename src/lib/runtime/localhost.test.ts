import { describe, expect, it } from 'vitest'
import { isLocalDevelopmentHost } from '@/lib/runtime/localhost'

describe('isLocalDevelopmentHost', () => {
  it('accepts localhost and loopback hosts', () => {
    expect(isLocalDevelopmentHost('localhost')).toBe(true)
    expect(isLocalDevelopmentHost('app.localhost')).toBe(true)
    expect(isLocalDevelopmentHost('127.0.0.1')).toBe(true)
    expect(isLocalDevelopmentHost('::1')).toBe(true)
    expect(isLocalDevelopmentHost('[::1]')).toBe(true)
  })

  it('accepts common private and local-network addresses', () => {
    expect(isLocalDevelopmentHost('192.168.186.234')).toBe(true)
    expect(isLocalDevelopmentHost('10.0.0.25')).toBe(true)
    expect(isLocalDevelopmentHost('172.20.10.4')).toBe(true)
    expect(isLocalDevelopmentHost('169.254.12.34')).toBe(true)
    expect(isLocalDevelopmentHost('devbox.local')).toBe(true)
    expect(isLocalDevelopmentHost('::ffff:192.168.186.234')).toBe(true)
    expect(isLocalDevelopmentHost('fd12:3456:789a::5')).toBe(true)
  })

  it('rejects public hosts', () => {
    expect(isLocalDevelopmentHost('example.com')).toBe(false)
    expect(isLocalDevelopmentHost('8.8.8.8')).toBe(false)
    expect(isLocalDevelopmentHost('172.32.0.1')).toBe(false)
    expect(isLocalDevelopmentHost('2001:4860:4860::8888')).toBe(false)
  })
})
