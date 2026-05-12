import { Icon } from 'konsta/react'
import type { ReactNode } from 'react'
import { appIcons, type AppIconKey } from '@/design/icons/semanticIcons'

type DirectAppIconProps = {
  ios: ReactNode
  material: ReactNode
  name?: never
  active?: never
  badge?: ReactNode
  className?: string
}

type SemanticAppIconProps = {
  name: AppIconKey
  active?: boolean
  ios?: never
  material?: never
  badge?: ReactNode
  className?: string
}

type AppIconProps = DirectAppIconProps | SemanticAppIconProps

function resolveSemanticIcon(name: AppIconKey, active = false): { ios: ReactNode; material: ReactNode } {
  const entry = appIcons[name]

  let ios: ReactNode | null = 'ios' in entry ? entry.ios : null
  let material: ReactNode | null = 'material' in entry ? entry.material : null

  if ('iosActive' in entry && 'iosInactive' in entry) {
    ios = active ? entry.iosActive : entry.iosInactive
  }
  if ('materialActive' in entry && 'materialInactive' in entry) {
    material = active ? entry.materialActive : entry.materialInactive
  }

  return {
    ios: ios ?? null,
    material: material ?? null,
  }
}

export function AppIcon(props: AppIconProps) {
  const icon = props.name
    ? resolveSemanticIcon(props.name, props.active)
    : { ios: props.ios, material: props.material }

  return (
    <Icon
      ios={icon.ios}
      material={icon.material}
      badge={props.badge}
      className={props.className}
    />
  )
}
