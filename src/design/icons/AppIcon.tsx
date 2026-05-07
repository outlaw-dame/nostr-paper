import { Icon } from 'konsta/react'
import type { ReactNode } from 'react'

type AppIconProps = {
  ios: ReactNode
  material: ReactNode
  badge?: ReactNode
  className?: string
}

export function AppIcon({ ios, material, badge, className }: AppIconProps) {
  return (
    <Icon
      ios={ios}
      material={material}
      badge={badge}
      className={className}
    />
  )
}
