import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { appIcon } from '@/lib/navigation'
import { cn } from '@edi-bridge/ui/lib/utils'

export function AppBrand({ className }: { className?: string }) {
  const t = useTranslations('Shell')

  return (
    <div className={cn('flex items-center gap-2 font-semibold', className)}>
      <HugeiconsIcon icon={appIcon} strokeWidth={2} className="size-4 shrink-0" />
      <span className="truncate group-data-[collapsible=icon]:hidden">{t('appName')}</span>
    </div>
  )
}
