import type { PlatformCapabilities, RuntimePlatform } from '@/lib/runtime/platformCapabilities'
import type { PlatformTheme } from '@/design/platform/resolveTheme'

export type VisualLanguage = 'apple' | 'material'
export type IconVariant = 'ios' | 'material'
export type NavigationPattern = 'ios-tabs' | 'ios-sidebar' | 'material-tabs' | 'material-rail'
export type ComposePattern = 'ios-toolbar-sheet' | 'material-fab'
export type InstallPattern =
  | 'hidden'
  | 'ios-share-sheet-instructions'
  | 'android-beforeinstallprompt'
  | 'macos-add-to-dock'
  | 'desktop-browser'
export type MotionPreset = 'ios-spring' | 'material-emphasized' | 'reduced'
export type ChromeStyle = 'translucent' | 'solid' | 'material'
export type HapticsPolicy = 'none' | 'vibration-api-light'
export type Density = 'touch' | 'pointer' | 'compact' | 'regular'

export interface PlatformUX {
  platform: RuntimePlatform
  displayMode: PlatformCapabilities['displayMode']
  isStandalone: boolean
  theme: PlatformTheme
  visualLanguage: VisualLanguage
  iconVariant: IconVariant
  navigationPattern: NavigationPattern
  composePattern: ComposePattern
  installPattern: InstallPattern
  motionPreset: MotionPreset
  chromeStyle: ChromeStyle
  hapticsPolicy: HapticsPolicy
  density: Density
}
