'use client'

import {
  Alert02Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'

import { Badge } from '@edi-bridge/ui/components/badge'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { AcknowledgementState } from '@edi-bridge/contracts'

const acknowledgementIcons: Record<AcknowledgementState, IconSvgElement> = {
  pending: Clock01Icon,
  accepted: CheckmarkCircle02Icon,
  rejected: CancelCircleIcon,
  overdue: Alert02Icon,
}

const acknowledgementStyles: Record<AcknowledgementState, string> = {
  pending: 'border-border text-foreground',
  accepted: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  rejected: 'bg-red-500/10 text-red-800 dark:text-red-300',
  overdue: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
}

export function AcknowledgementBadge({
  state,
  count,
}: {
  state: AcknowledgementState
  count?: number
}) {
  const t = useTranslations('OrderLifecycle.acknowledgement.state')
  const format = useFormatter()

  return (
    <Badge variant="outline" className={cn('gap-1', acknowledgementStyles[state])}>
      <HugeiconsIcon icon={acknowledgementIcons[state]} strokeWidth={2} aria-hidden />
      {count !== undefined && <span className="tabular-nums">{format.number(count)}</span>}
      {t(state)}
    </Badge>
  )
}
