'use client'

import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  DashedLineCircleIcon,
  Loading03Icon,
  MinusSignCircleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'

import { cn } from '@edi-bridge/ui/lib/utils'

import type { RunStep, RunStepStatus } from '@edi-bridge/contracts'

const stepIcons: Record<RunStepStatus, IconSvgElement> = {
  succeeded: CheckmarkCircle02Icon,
  failed: CancelCircleIcon,
  running: Loading03Icon,
  pending: DashedLineCircleIcon,
  skipped: MinusSignCircleIcon,
}

const stepStyles: Record<RunStepStatus, string> = {
  succeeded: 'text-emerald-700 dark:text-emerald-400',
  failed: 'text-red-700 dark:text-red-400',
  running: 'text-sky-700 dark:text-sky-400',
  pending: 'text-muted-foreground',
  skipped: 'text-muted-foreground',
}

function Duration({ step }: { step: RunStep }) {
  const format = useFormatter()

  if (step.startedAt === null || step.finishedAt === null) {
    return null
  }

  const milliseconds = Date.parse(step.finishedAt) - Date.parse(step.startedAt)

  return (
    <span className="text-muted-foreground tabular-nums">
      {milliseconds < 1000
        ? format.number(milliseconds, { style: 'unit', unit: 'millisecond' })
        : format.number(milliseconds / 1000, {
            style: 'unit',
            unit: 'second',
            maximumFractionDigits: 1,
          })}
    </span>
  )
}

export function RunTimeline({ steps }: { steps: RunStep[] }) {
  const t = useTranslations('RunDetail.steps')
  const format = useFormatter()

  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => (
        <li key={step.stage} className="relative flex gap-3 pb-4 last:pb-0">
          {index < steps.length - 1 && (
            <span aria-hidden className="bg-border absolute top-6 bottom-0 left-2.5 w-px" />
          )}
          <HugeiconsIcon
            icon={stepIcons[step.status]}
            strokeWidth={2}
            aria-hidden
            className={cn('relative size-5 shrink-0', stepStyles[step.status])}
          />
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
            <span className="font-medium">{t(`stage.${step.stage}`)}</span>
            <span
              className={cn(stepStyles[step.status], step.status === 'failed' && 'font-semibold')}>
              {t(`status.${step.status}`)}
            </span>
            {step.status === 'failed' && (
              <span className="text-xs font-medium text-red-800 uppercase dark:text-red-300">
                {t('failedHere')}
              </span>
            )}
            <Duration step={step} />
            {step.startedAt !== null && (
              <time
                dateTime={step.startedAt}
                className="text-muted-foreground ml-auto text-xs tabular-nums">
                {format.dateTime(new Date(step.startedAt), {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  fractionalSecondDigits: 3,
                })}
              </time>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
