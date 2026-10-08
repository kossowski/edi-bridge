'use client'

import {
  CancelCircleIcon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  CodeIcon,
  Copy01Icon,
  DeliveryTruck01Icon,
  FlowConnectionIcon,
  HourglassIcon,
  InboxDownloadIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { Badge } from '@edi-bridge/ui/components/badge'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { FailureStage, RunStatus } from '@edi-bridge/contracts'

export const runStatusIcons: Record<RunStatus, IconSvgElement> = {
  received: InboxDownloadIcon,
  processing: HourglassIcon,
  delivered: CheckmarkCircle02Icon,
  failed: CancelCircleIcon,
  duplicate: Copy01Icon,
}

const runStatusStyles: Record<RunStatus, string> = {
  received: 'border-border text-foreground',
  processing: 'bg-sky-500/10 text-sky-800 dark:text-sky-300',
  delivered: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  failed: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  duplicate: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
}

export const failureStageIcons: Record<FailureStage, IconSvgElement> = {
  parse: CodeIcon,
  validation: CheckListIcon,
  mapping: FlowConnectionIcon,
  delivery: DeliveryTruck01Icon,
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const t = useTranslations('Runs.status')

  return (
    <Badge variant="outline" className={cn('gap-1', runStatusStyles[status])}>
      <HugeiconsIcon icon={runStatusIcons[status]} strokeWidth={2} aria-hidden />
      {t(status)}
    </Badge>
  )
}

export function FailureStageLabel({ failureStage }: { failureStage: FailureStage | null }) {
  const t = useTranslations('Runs')

  if (failureStage === null) {
    return (
      <>
        <span aria-hidden className="text-muted-foreground">
          –
        </span>
        <span className="sr-only">{t('noFailureStage')}</span>
      </>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <HugeiconsIcon
        icon={failureStageIcons[failureStage]}
        strokeWidth={2}
        aria-hidden
        className="size-4"
      />
      {t(`failureStage.${failureStage}`)}
    </span>
  )
}
