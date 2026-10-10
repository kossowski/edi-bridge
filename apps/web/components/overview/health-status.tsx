'use client'

import { Alert02Icon, CancelCircleIcon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { Badge } from '@edi-bridge/ui/components/badge'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { HealthStatus } from '@edi-bridge/contracts'

const healthStatusIcons: Record<HealthStatus, IconSvgElement> = {
  healthy: CheckmarkCircle02Icon,
  degraded: Alert02Icon,
  failing: CancelCircleIcon,
}

const healthStatusStyles: Record<HealthStatus, string> = {
  healthy: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  degraded: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
  failing: 'bg-red-500/10 text-red-800 dark:text-red-300',
}

export function HealthStatusBadge({ status }: { status: HealthStatus }) {
  const t = useTranslations('Overview.health.status')

  return (
    <Badge variant="outline" className={cn('gap-1', healthStatusStyles[status])}>
      <HugeiconsIcon icon={healthStatusIcons[status]} strokeWidth={2} aria-hidden />
      {t(status)}
    </Badge>
  )
}
