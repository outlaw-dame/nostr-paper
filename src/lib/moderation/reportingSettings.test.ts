import {
  getReportingSettings,
  setReportingSettings,
} from './reportingSettings'

const STORAGE_KEY = 'nostr-paper:reporting-preferences:v1'

function ensureMockStorage() {
  if (globalThis.localStorage) return
  const store = new Map<string, string>()
  const storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size },
  } as Storage
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
}

function ensureWindowShim() {
  if ((globalThis as { window?: Window }).window) return
  ;(globalThis as { window?: Pick<Window, 'localStorage' | 'dispatchEvent'> }).window = {
    localStorage: globalThis.localStorage,
    dispatchEvent: () => true,
  }
}

describe('reportingSettings', () => {
  beforeEach(() => {
    ensureMockStorage()
    ensureWindowShim()
    globalThis.localStorage.clear()
  })

  it('returns sane defaults', () => {
    const settings = getReportingSettings()

    expect(settings.destination).toBe('public')
    expect(settings.privateRelayUrls.length).toBeGreaterThan(0)
    expect(settings.moderatorRelayUrls.length).toBeGreaterThan(0)
    expect(settings.moderatorPubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('persists and normalizes moderator destination values', () => {
    setReportingSettings({
      destination: 'moderator',
      moderatorPubkey: 'A'.repeat(64),
      moderatorRelayUrls: ['wss://relay.nos.social', 'not-a-relay', 'wss://relay.nos.social'],
    })

    const settings = getReportingSettings()
    expect(settings.destination).toBe('moderator')
    expect(settings.moderatorPubkey).toBe('a'.repeat(64))
    expect(settings.moderatorRelayUrls).toEqual(['wss://relay.nos.social'])
  })

  it('falls back safely when stored values are malformed', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      destination: 'bogus',
      moderatorPubkey: 'zzz',
      privateRelayUrls: ['not-a-relay'],
      moderatorRelayUrls: ['still-not-a-relay'],
    }))

    const settings = getReportingSettings()
    expect(settings.destination).toBe('public')
    expect(settings.privateRelayUrls.length).toBeGreaterThan(0)
    expect(settings.moderatorRelayUrls.length).toBeGreaterThan(0)
    expect(settings.moderatorPubkey).toMatch(/^[0-9a-f]{64}$/)
  })
})
