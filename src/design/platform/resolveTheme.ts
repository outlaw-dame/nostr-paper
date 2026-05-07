export type PlatformTheme = 'ios' | 'material'

export function resolvePlatformTheme(input: {
  explicitTheme?: PlatformTheme | 'system'
  detectedPlatform?: 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'unknown'
}): PlatformTheme {
  if (input.explicitTheme === 'ios' || input.explicitTheme === 'material') {
    return input.explicitTheme
  }
  if (input.detectedPlatform === 'android') {
    return 'material'
  }
  return 'ios'
}
