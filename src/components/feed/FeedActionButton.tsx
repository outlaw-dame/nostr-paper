import { memo } from 'react'
import { motion } from 'motion/react'
import { Icon } from 'konsta/react'
import { appIcons, type FeedActionKey } from '@/design/icons/semanticIcons'

type FeedActionButtonProps = {
  action: FeedActionKey
  active?: boolean
  label: string
  count?: number
  onClick: () => void
}

export const FeedActionButton = memo(function FeedActionButton({
  action,
  active = false,
  label,
  count,
  onClick,
}: FeedActionButtonProps) {
  const icon = appIcons[action]

  let ios = 'ios' in icon ? icon.ios : null
  let material = 'material' in icon ? icon.material : null

  if ('iosActive' in icon && 'iosInactive' in icon) {
    ios = active ? icon.iosActive : icon.iosInactive
  }
  if ('materialActive' in icon && 'materialInactive' in icon) {
    material = active ? icon.materialActive : icon.materialInactive
  }

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      data-active={active}
      className="
        inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full px-2
        text-[rgb(var(--color-label-secondary))]
        data-[active=true]:text-[rgb(var(--color-accent))]
        active:bg-black/[0.06]
        dark:active:bg-white/[0.08]
      "
    >
      {ios !== null && material !== null && (
        <Icon ios={ios} material={material} />
      )}
      {typeof count === 'number' && count > 0 ? (
        <span className="text-[13px] leading-none tabular-nums">{count}</span>
      ) : null}
    </motion.button>
  )
})
