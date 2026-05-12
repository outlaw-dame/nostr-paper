import type { PlatformCapabilities } from '@/lib/runtime/platformCapabilities'
import { resolvePlatformTheme } from '@/design/platform/resolveTheme'
import type { PlatformUX, InstallPattern, NavigationPattern } from '@/design/platform/platformTypes'

function resolveInstallPattern(capabilities: PlatformCapabilities): InstallPattern {
  if (capabilities.isStandalone) return 'hidden'
  if (capabilities.platform === 'ios') return 'ios-share-sheet-instructions'
  if (capabilities.platform === 'android' && capabilities.canPromptPwaInstall) {
    return 'android-beforeinstallprompt'
  }
  if (capabilities.platform === 'macos') return 'macos-add-to-dock'
  return 'desktop-browser'
}

function resolveNavigationPattern(capabilities: PlatformCapabilities, theme: PlatformUX['theme']): NavigationPattern {
  if (theme === 'material') {
    return capabilities.isMobile ? 'material-tabs' : 'material-rail'
  }
  return capabilities.isMobile ? 'ios-tabs' : 'ios-sidebar'
}

export function resolvePlatformUX(capabilities: PlatformCapabilities): PlatformUX {
  const theme = resolvePlatformTheme({ detectedPlatform: capabilities.platform })
  const isMaterial = theme === 'material'

  return {
    platform: capabilities.platform,
    displayMode: capabilities.displayMode,
    isStandalone: capabilities.isStandalone,
    theme,
    visualLanguage: isMaterial ? 'material' : 'apple',
    iconVariant: isMaterial ? 'material' : 'ios',
    navigationPattern: resolveNavigationPattern(capabilities, theme),
    composePattern: isMaterial ? 'material-fab' : 'ios-toolbar-sheet',
    installPattern: resolveInstallPattern(capabilities),
    motionPreset: capabilities.prefersReducedMotion
      ? 'reduced'
      : isMaterial
        ? 'material-emphasized'
        : 'ios-spring',
    chromeStyle: isMaterial ? 'material' : 'translucent',
    hapticsPolicy: capabilities.platform === 'android' ? 'vibration-api-light' : 'none',
    density: capabilities.isMobile ? 'touch' : 'pointer',
  }
}
