'use client'

import { CheckmarkCircle02Icon, TestTube01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { Badge } from '@edi-bridge/ui/components/badge'
import { cn } from '@edi-bridge/ui/lib/utils'

export const testModeClassName = 'bg-amber-500/10 text-amber-800 dark:text-amber-300'

export function TestModeBadge({ testMode }: { testMode: boolean }) {
  const t = useTranslations('TradingPartners.mode')

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1',
        testMode ? testModeClassName : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
      )}>
      <HugeiconsIcon
        icon={testMode ? TestTube01Icon : CheckmarkCircle02Icon}
        strokeWidth={2}
        aria-hidden
      />
      {testMode ? t('test') : t('production')}
    </Badge>
  )
}
