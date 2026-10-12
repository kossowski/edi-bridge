'use client'

import { Cancel01Icon, Clock01Icon, MinusSignIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import {
  documentPath,
  type PathStep,
  type PathStepState,
} from '@/components/documents/document-path'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@edi-bridge/ui/components/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@edi-bridge/ui/components/tooltip'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { RunDetail } from '@edi-bridge/contracts'

const stateIcons: Record<PathStepState, IconSvgElement | null> = {
  done: Tick02Icon,
  failed: Cancel01Icon,
  running: Clock01Icon,
  pending: null,
  skipped: MinusSignIcon,
  notReached: null,
}

function PathStepItem({ run, step, first }: { run: RunDetail; step: PathStep; first: boolean }) {
  const t = useTranslations('Document.path')
  const hintId = useId()
  const label = t(`step.${step.key}`)

  const hint = t(`hint.${step.key}`, {
    direction: run.direction,
    tradingPartner: run.tradingPartner.name,
  })

  const icon = stateIcons[step.state]
  const reached = step.state === 'done' || step.state === 'failed' || step.state === 'running'

  return (
    <li className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
      {!first && (
        <span
          aria-hidden
          className={cn(
            'absolute top-3.5 right-1/2 h-0.5 w-full -translate-y-1/2',
            reached ? 'bg-primary' : 'bg-border',
            step.state === 'failed' && 'bg-destructive',
          )}
        />
      )}
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-describedby={hintId}
          className={cn(
            'focus-visible:ring-ring/50 relative z-10 flex size-7 items-center justify-center rounded-full border-2 outline-none focus-visible:ring-3',
            step.state === 'done' && 'bg-primary border-primary text-primary-foreground',
            step.state === 'failed' && 'bg-destructive border-destructive text-white',
            step.state === 'running' && 'bg-background border-primary text-primary',
            (step.state === 'pending' || step.state === 'skipped' || step.state === 'notReached') &&
              'bg-background border-border text-muted-foreground',
            step.state === 'skipped' && 'border-dashed',
          )}>
          {icon && <HugeiconsIcon icon={icon} strokeWidth={2.5} aria-hidden className="size-3.5" />}
          <span className="sr-only">
            {t('stepName', { step: label, state: t(`state.${step.state}`) })}
          </span>
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
      <span id={hintId} className="sr-only">
        {hint}
      </span>
      <span
        aria-hidden
        className={cn(
          'max-w-full text-xs break-words',
          step.state === 'failed'
            ? 'text-destructive-text font-semibold'
            : reached
              ? 'text-foreground'
              : 'text-muted-foreground',
        )}>
        {label}
      </span>
      {(step.state === 'failed' || step.state === 'running' || step.state === 'skipped') && (
        <span
          aria-hidden
          className={cn(
            'max-w-full text-xs break-words',
            step.state === 'failed' ? 'text-destructive-text' : 'text-muted-foreground',
          )}>
          {t(`state.${step.state}`)}
        </span>
      )}
    </li>
  )
}

export function DocumentPathCard({ run }: { run: RunDetail }) {
  const t = useTranslations('Document.path')
  const titleId = useId()

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2 id={titleId}>{t('title')}</h2>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol aria-labelledby={titleId} className="flex w-full items-start">
          {documentPath(run).map((step, index) => (
            <PathStepItem key={step.stage} first={index === 0} run={run} step={step} />
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
