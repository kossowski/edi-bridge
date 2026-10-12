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

import type { AcknowledgementState } from '@edi-bridge/contracts'

const acknowledgementIcons: Record<AcknowledgementState, IconSvgElement> = {
  pending: Clock01Icon,
  accepted: CheckmarkCircle02Icon,
  rejected: CancelCircleIcon,
  overdue: Alert02Icon,
}

export function AcknowledgementStateBadge({
  state,
  count,
}: {
  state: AcknowledgementState
  count?: number
}) {
  const t = useTranslations('OrderLifecycle.acknowledgement.state')
  const format = useFormatter()

  return (
    <Badge
      variant="outline"
      className="gap-1 data-[state=accepted]:bg-emerald-500/10 data-[state=accepted]:text-emerald-800 data-[state=overdue]:bg-amber-500/10 data-[state=overdue]:text-amber-800 data-[state=rejected]:bg-red-500/10 data-[state=rejected]:text-red-800 dark:data-[state=accepted]:text-emerald-300 dark:data-[state=overdue]:text-amber-300 dark:data-[state=rejected]:text-red-300"
      data-state={state}>
      <HugeiconsIcon icon={acknowledgementIcons[state]} strokeWidth={2} aria-hidden />
      {count !== undefined && <span className="tabular-nums">{format.number(count)}</span>}
      {t(state)}
    </Badge>
  )
}
