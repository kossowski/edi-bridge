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
  const showsState = step.state === 'failed' || step.state === 'running' || step.state === 'skipped'

  return (
    <li
      className="group relative flex items-center gap-3 py-1 @lg:flex-1 @lg:flex-col @lg:gap-1.5 @lg:py-0 @lg:text-center"
      data-state={step.state}>
      {!first && (
        <span
          aria-hidden
          className="bg-border group-data-[state=done]:bg-primary group-data-[state=failed]:bg-destructive group-data-[state=running]:bg-primary absolute bottom-1/2 left-3.5 h-full w-0.5 -translate-x-1/2 @lg:top-3.5 @lg:right-1/2 @lg:bottom-auto @lg:left-auto @lg:h-0.5 @lg:w-full @lg:translate-x-0 @lg:-translate-y-1/2"
        />
      )}
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-describedby={hintId}
          className="focus-visible:ring-ring/50 bg-background border-border text-muted-foreground group-data-[state=done]:bg-primary group-data-[state=done]:border-primary group-data-[state=done]:text-primary-foreground group-data-[state=failed]:bg-destructive group-data-[state=failed]:border-destructive group-data-[state=running]:border-primary group-data-[state=running]:text-primary relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 outline-none group-data-[state=failed]:text-white group-data-[state=skipped]:border-dashed focus-visible:ring-3">
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
        className="flex flex-wrap items-baseline gap-x-2 text-xs @lg:flex-col @lg:items-center">
        <span className="text-muted-foreground group-data-[state=done]:text-foreground group-data-[state=failed]:text-destructive-text group-data-[state=running]:text-foreground group-data-[state=failed]:font-semibold">
          {label}
        </span>
        {showsState && (
          <span className="text-muted-foreground group-data-[state=failed]:text-destructive-text">
            {t(`state.${step.state}`)}
          </span>
        )}
      </span>
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
      <CardContent className="@container">
        <ol aria-labelledby={titleId} className="flex w-full flex-col @lg:flex-row @lg:items-start">
          {documentPath(run).map((step, index) => (
            <PathStepItem key={step.stage} first={index === 0} run={run} step={step} />
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
