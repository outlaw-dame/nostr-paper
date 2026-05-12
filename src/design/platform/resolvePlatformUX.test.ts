import { resolvePlatformUX } from '@/design/platform/resolvePlatformUX'
import type { PlatformCapabilities } from '@/lib/runtime/platformCapabilities'

const baseCapabilities: PlatformCapabilities = {
  platform: 'unknown',
  isMobile: false,
  isAppleMobileWebKit: false,
  isStandalone: false,
  displayMode: 'browser',
  supportsServiceWorker: true,
  supportsPush: true,
  supportsNotifications: true,
  supportsShare: true,
  supportsFileShare: false,
  supportsClipboardWrite: true,
  supportsBadging: false,
  supportsContactPicker: false,
  prefersReducedMotion: false,
  canPromptPwaInstall: false,
  shouldShowInstallHint: false,
  preferNativeEmoji: true,
}

function capabilities(overrides: Partial<PlatformCapabilities>): PlatformCapabilities {
  return { ...baseCapabilities, ...overrides }
}

describe('resolvePlatformUX', () => {
  it('uses Material UX for Android installable browsers', () => {
    const ux = resolvePlatformUX(capabilities({
      platform: 'android',
      isMobile: true,
      canPromptPwaInstall: true,
    }))

    expect(ux.theme).toBe('material')
    expect(ux.visualLanguage).toBe('material')
    expect(ux.navigationPattern).toBe('material-tabs')
    expect(ux.composePattern).toBe('material-fab')
    expect(ux.installPattern).toBe('android-beforeinstallprompt')
  })

  it('defaults desktop and unknown platforms to Apple-like UX', () => {
    const ux = resolvePlatformUX(capabilities({ platform: 'windows' }))

    expect(ux.theme).toBe('ios')
    expect(ux.visualLanguage).toBe('apple')
    expect(ux.iconVariant).toBe('ios')
    expect(ux.navigationPattern).toBe('ios-sidebar')
  })

  it('hides install prompts and reduces motion when the environment asks for it', () => {
    const ux = resolvePlatformUX(capabilities({
      platform: 'ios',
      isMobile: true,
      isStandalone: true,
      displayMode: 'standalone',
      prefersReducedMotion: true,
    }))

    expect(ux.installPattern).toBe('hidden')
    expect(ux.motionPreset).toBe('reduced')
    expect(ux.navigationPattern).toBe('ios-tabs')
  })
})
