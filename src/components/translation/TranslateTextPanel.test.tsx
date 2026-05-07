import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslateTextPanel } from '@/components/translation/TranslateTextPanel'
import type { TranslationPreflight, TranslationResult } from '@/lib/translation/client'

const mockedTranslationClient = vi.hoisted(() => ({
  inspectConfiguredTranslationWithOptions: vi.fn<
    (text: string, options?: { sourceLanguageHint?: string | null }) => Promise<TranslationPreflight>
  >(),
  translateConfiguredText: vi.fn<
    (text: string, signal?: AbortSignal) => Promise<TranslationResult>
  >(),
}))

vi.mock('@/lib/translation/client', () => ({
  inspectConfiguredTranslationWithOptions: mockedTranslationClient.inspectConfiguredTranslationWithOptions,
  translateConfiguredText: mockedTranslationClient.translateConfiguredText,
  TranslationServiceError: class TranslationServiceError extends Error {
    code = 'provider' as const
  },
  getProviderDisplayName: () => 'TransLang',
}))

vi.mock('@/lib/translation/storage', () => ({
  loadTranslationDevQueueMetricsEnabled: () => false,
  TRANSLATION_SETTINGS_UPDATED_EVENT: 'paper:translation-settings-updated',
}))

vi.mock('@/lib/translation/i18n', () => ({
  tTranslationUi: (key: string) => {
    if (key === 'translateAction') return 'Translate'
    if (key === 'translated') return 'Translated'
    if (key === 'hideTranslation') return 'Hide'
    if (key === 'showTranslation') return 'Show'
    if (key === 'retranslate') return 'Retranslate'
    if (key === 'translating') return 'Translating…'
    return key
  },
}))

let activeRoot: Root | null = null
let activeContainer: HTMLDivElement | null = null

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderPanels() {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const root = createRoot(container)
  activeRoot = root
  activeContainer = container

  await act(async () => {
    root.render(
      <>
        <TranslateTextPanel
          text="これはテストです"
          autoStart={false}
          translationSyncGroup="note:abc"
        />
        <TranslateTextPanel
          text="これは引用です"
          autoStart={false}
          translationSyncGroup="note:abc"
        />
      </>,
    )
  })

  return container
}

afterEach(async () => {
  mockedTranslationClient.inspectConfiguredTranslationWithOptions.mockReset()
  mockedTranslationClient.translateConfiguredText.mockReset()

  if (activeRoot) {
    await act(async () => {
      activeRoot?.unmount()
      await Promise.resolve()
    })
  }

  activeRoot = null
  activeContainer?.remove()
  activeContainer = null
})

describe('TranslateTextPanel translation sync group', () => {
  it('translates both grouped panels from one translate click', async () => {
    mockedTranslationClient.inspectConfiguredTranslationWithOptions.mockResolvedValue({
      targetLanguage: 'en',
      likelySourceLanguage: 'ja',
      sameLanguage: false,
      canAutoTranslate: true,
    })

    mockedTranslationClient.translateConfiguredText.mockImplementation(async (text: string) => ({
      provider: 'translang',
      translatedText: `translated:${text}`,
      targetLanguage: 'en',
      sourceLanguage: 'auto',
      detectedSourceLanguage: 'ja',
    }))

    const container = await renderPanels()
    await flush()

    const translateButtons = Array.from(container.querySelectorAll('button')).filter((button) => (
      button.textContent?.includes('Translate')
    ))
    expect(translateButtons.length).toBeGreaterThanOrEqual(1)

    await act(async () => {
      translateButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await flush()

    expect(mockedTranslationClient.translateConfiguredText).toHaveBeenCalledTimes(2)
  })
})
