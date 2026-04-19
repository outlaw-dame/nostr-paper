import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  AI_ASSIST_PROVIDER_UPDATED_EVENT,
  getAiAssistProvider,
  setAiAssistProvider,
} from '@/lib/ai/provider'

function createMockWindow(): Window {
  const storage = new Map<string, string>()
  const eventTarget = new EventTarget()

  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) },
    clear: () => { storage.clear() },
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size },
  }

  return {
    localStorage,
    dispatchEvent: (event: Event) => eventTarget.dispatchEvent(event),
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (!listener) return
      const wrapped = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
      eventTarget.addEventListener(type, wrapped)
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject | null) => {
      if (!listener) return
      const wrapped = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
      eventTarget.removeEventListener(type, wrapped)
    },
  } as unknown as Window
}

describe('ai assist provider preferences', () => {
  const originalWindow = (globalThis as { window?: Window }).window

  beforeEach(() => {
    ;(globalThis as { window?: Window }).window = createMockWindow()
  })

  afterEach(() => {
    if (originalWindow) {
      ;(globalThis as { window?: Window }).window = originalWindow
      return
    }
    delete (globalThis as { window?: Window }).window
  })

  it('defaults to auto', () => {
    expect(getAiAssistProvider()).toBe('auto')
  })

  it('stores and reads selected provider', () => {
    setAiAssistProvider('gemini')
    expect(getAiAssistProvider()).toBe('gemini')

    setAiAssistProvider('gemma')
    expect(getAiAssistProvider()).toBe('gemma')
  })

  it('emits update event on change', () => {
    const events: string[] = []
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ provider?: string }>
      events.push(custom.detail?.provider ?? '')
    }

    window.addEventListener(AI_ASSIST_PROVIDER_UPDATED_EVENT, handler as EventListener)
    setAiAssistProvider('gemini')
    window.removeEventListener(AI_ASSIST_PROVIDER_UPDATED_EVENT, handler as EventListener)

    expect(events).toEqual(['gemini'])
  })
})
