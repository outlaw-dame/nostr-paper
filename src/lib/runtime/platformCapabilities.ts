export type RuntimePlatform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'unknown'

export interface PlatformCapabilities {
  platform: RuntimePlatform
  isMobile: boolean
  isAppleMobileWebKit: boolean
  isStandalone: boolean
  displayMode: 'browser' | 'standalone' | 'fullscreen' | 'minimal-ui' | 'unknown'
  supportsServiceWorker: boolean
  supportsPush: boolean
  supportsNotifications: boolean
  supportsShare: boolean
  supportsFileShare: boolean
  supportsClipboardWrite: boolean
  supportsBadging: boolean
  supportsContactPicker: boolean
  prefersReducedMotion: boolean
  canPromptPwaInstall: boolean
  shouldShowInstallHint: boolean
  preferNativeEmoji: boolean
}

function detectDisplayMode(runtimeWindow: Window): PlatformCapabilities['displayMode'] {
  const modes: Array<PlatformCapabilities['displayMode']> = ['fullscreen', 'standalone', 'minimal-ui', 'browser']
  for (const mode of modes) {
    if (runtimeWindow.matchMedia(`(display-mode: ${mode})`).matches) {
      return mode
    }
  }
  return 'unknown'
}

export function detectPlatformFromUserAgent(userAgent: string): RuntimePlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macos'
  if (/Windows/i.test(userAgent)) return 'windows'
  if (/Linux/i.test(userAgent)) return 'linux'
  return 'unknown'
}

export function isAppleMobileWebKitUserAgent(userAgent: string): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) && /AppleWebKit/i.test(userAgent)
}

export function detectRuntimePlatform(runtimeNavigator: Navigator): RuntimePlatform {
  const uaPlatform = (runtimeNavigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  if (typeof uaPlatform === 'string') {
    if (/iOS/i.test(uaPlatform)) return 'ios'
    if (/Android/i.test(uaPlatform)) return 'android'
    if (/macOS/i.test(uaPlatform)) return 'macos'
    if (/Windows/i.test(uaPlatform)) return 'windows'
    if (/Linux/i.test(uaPlatform)) return 'linux'
  }

  return detectPlatformFromUserAgent(runtimeNavigator.userAgent ?? '')
}

function createFallbackCapabilities(): PlatformCapabilities {
  return {
    platform: 'unknown',
    isMobile: false,
    isAppleMobileWebKit: false,
    isStandalone: false,
    displayMode: 'unknown',
    supportsServiceWorker: false,
    supportsPush: false,
    supportsNotifications: false,
    supportsShare: false,
    supportsFileShare: false,
    supportsClipboardWrite: false,
    supportsBadging: false,
    supportsContactPicker: false,
    prefersReducedMotion: false,
    canPromptPwaInstall: false,
    shouldShowInstallHint: false,
    preferNativeEmoji: true,
  }
}

export function detectPlatformCapabilities(runtimeWindow: Window = window): PlatformCapabilities {
  const runtimeNavigator = runtimeWindow.navigator
  if (!runtimeNavigator) return createFallbackCapabilities()
  const runtimeNavigatorWithStandalone = runtimeNavigator as Navigator & { standalone?: boolean }

  const userAgent = runtimeNavigator.userAgent ?? ''
  const platform = detectRuntimePlatform(runtimeNavigator)
  const displayMode = detectDisplayMode(runtimeWindow)
  const isStandalone = displayMode !== 'browser'
    || runtimeNavigatorWithStandalone.standalone === true

  const supportsShare = typeof runtimeNavigator.share === 'function'
  const supportsFileShare = supportsShare
    && typeof runtimeNavigator.canShare === 'function'
  const supportsNotifications = 'Notification' in runtimeWindow
  const supportsServiceWorker = 'serviceWorker' in runtimeNavigator
  const supportsPush = 'PushManager' in runtimeWindow
  const supportsClipboardWrite = Boolean(runtimeNavigator.clipboard?.writeText)
  const supportsBadging = 'setAppBadge' in runtimeNavigator
  const supportsContactPicker = 'contacts' in runtimeNavigator
  const prefersReducedMotion = runtimeWindow.matchMedia('(prefers-reduced-motion: reduce)').matches
  const canPromptPwaInstall = 'onbeforeinstallprompt' in runtimeWindow

  return {
    platform,
    isMobile: platform === 'ios' || platform === 'android',
    isAppleMobileWebKit: isAppleMobileWebKitUserAgent(userAgent),
    isStandalone,
    displayMode,
    supportsServiceWorker,
    supportsPush,
    supportsNotifications,
    supportsShare,
    supportsFileShare,
    supportsClipboardWrite,
    supportsBadging,
    supportsContactPicker,
    prefersReducedMotion,
    canPromptPwaInstall,
    shouldShowInstallHint: !isStandalone && (platform === 'ios' || canPromptPwaInstall),
    // Native emoji should be the default UI style across platforms.
    preferNativeEmoji: true,
  }
}

let cachedCapabilities: PlatformCapabilities | null = null

export function getCachedPlatformCapabilities(): PlatformCapabilities {
  if (cachedCapabilities) return cachedCapabilities
  if (typeof window === 'undefined') return createFallbackCapabilities()
  cachedCapabilities = detectPlatformCapabilities(window)
  return cachedCapabilities
}

export function refreshPlatformCapabilities(): PlatformCapabilities {
  if (typeof window === 'undefined') return createFallbackCapabilities()
  cachedCapabilities = detectPlatformCapabilities(window)
  return cachedCapabilities
}
