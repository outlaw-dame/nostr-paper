import { Icon } from 'konsta/react'
import { appIcons, type NavIconKey } from '@/design/icons/semanticIcons'

type AppTabIconProps = {
  icon: NavIconKey
  active: boolean
}

export function AppTabIcon({ icon, active }: AppTabIconProps) {
  const entry = appIcons[icon]
  return (
    <Icon
      ios={active ? entry.iosActive : entry.iosInactive}
      material={active ? entry.materialActive : entry.materialInactive}
    />
  )
}
