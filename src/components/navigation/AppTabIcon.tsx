import { AppIcon } from '@/design/icons/AppIcon'
import type { NavIconKey } from '@/design/icons/semanticIcons'

type AppTabIconProps = {
  icon: NavIconKey
  active: boolean
}

export function AppTabIcon({ icon, active }: AppTabIconProps) {
  return <AppIcon name={icon} active={active} />
}
