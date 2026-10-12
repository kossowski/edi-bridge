'use client'

import { Alert02Icon, ArrowRight01Icon, Clock01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'

import type { ReactNode } from 'react'

import { FixerBadge, fixerIcons } from '@/components/documents/fixer-badge'
import {
  CopyPartnerMessage,
  MarkWaitingStep,
  ProcessAgainStep,
  ProcessedAgain,
  reprocessMapping,
  TryAgainStep,
  useFreshlyReprocessed,
} from '@/components/documents/problem-actions'
import { fixTargetHref } from '@/lib/navigation'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@edi-bridge/ui/components/card'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { FailedRun } from '@/components/documents/failed-run'
import type { FixTarget } from '@edi-bridge/contracts'

export type WhatToDoStep = { key: string; content: ReactNode }

function useProblemText({ problem, direction, tradingPartner }: FailedRun) {
  const t = useTranslations('Document.problem.reason')
  const { fixTarget } = problem
  const field = fixTarget?.kind === 'mapping' ? fixTarget.fieldPath : null
  const lookupTable = fixTarget?.kind === 'lookupTable' ? fixTarget : null
  const values = { direction, tradingPartner: tradingPartner.name }

  switch (problem.reason) {
    case 'unreadable': {
      return {
        title: t('unreadable.title', values),
        description: t('unreadable.description', values),
      }
    }

    case 'invalidContent': {
      return {
        title: t('invalidContent.title', values),
        description:
          direction === 'outbound' && field === null
            ? t('invalidContent.descriptionWithoutTarget', values)
            : t('invalidContent.description', { ...values, field: field ?? '' }),
      }
    }

    case 'missingCode': {
      return lookupTable
        ? {
            title: t('missingCode.title', { code: lookupTable.code }),
            description: t('missingCode.description', {
              ...values,
              code: lookupTable.code,
              lookupTable: lookupTable.name,
            }),
          }
        : {
            title: t('missingCode.titleWithoutTarget'),
            description: t('missingCode.descriptionWithoutTarget', values),
          }
    }

    case 'missingField': {
      return {
        title: t('missingField.title'),
        description:
          field === null
            ? t('missingField.descriptionWithoutTarget')
            : t('missingField.description', { field }),
      }
    }

    case 'unreachable': {
      return {
        title: t('unreachable.title', values),
        description: t('unreachable.description', values),
      }
    }
  }
}

function FixLink({ target, primary }: { target: FixTarget; primary: boolean }) {
  const t = useTranslations('Document.problem.fixLink')

  const label =
    target.kind === 'lookupTable'
      ? t('lookupTable', { code: target.code, name: target.name })
      : t(target.kind, { name: target.name })

  return (
    <Link
      href={fixTargetHref(target)}
      className={cn(
        buttonVariants({ variant: primary ? 'default' : 'outline' }),
        'h-auto min-h-8 max-w-full py-1.5 text-left whitespace-normal',
      )}>
      {label}
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} aria-hidden data-icon="inline-end" />
    </Link>
  )
}

function StepBody({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <p>{text}</p>
      {children}
    </div>
  )
}

export function useFixSteps(run: FailedRun): WhatToDoStep[] {
  const t = useTranslations('Document.problem.steps')
  const { problem, tradingPartner } = run
  const target = problem.fixTarget

  switch (problem.whoFixes) {
    case 'you': {
      const mapping = reprocessMapping(run)

      if (target === null && mapping === null) {
        return [
          {
            key: 'fix',
            content: (
              <StepBody
                text={t('fixCauseWithoutTarget', {
                  direction: run.direction,
                  tradingPartner: tradingPartner.name,
                })}
              />
            ),
          },
        ]
      }

      return [
        ...(target
          ? [
              {
                key: 'fix',
                content: (
                  <StepBody text={t('fixCause')}>
                    <FixLink primary target={target} />
                  </StepBody>
                ),
              },
            ]
          : []),
        ...(mapping
          ? [{ key: 'processAgain', content: <ProcessAgainStep mapping={mapping} run={run} /> }]
          : []),
      ]
    }

    case 'retry': {
      return [
        { key: 'tryAgain', content: <TryAgainStep run={run} /> },
        ...(target
          ? [
              {
                key: 'fix',
                content: (
                  <StepBody text={t('checkConnection')}>
                    <FixLink primary={false} target={target} />
                  </StepBody>
                ),
              },
            ]
          : []),
      ]
    }

    case 'tradingPartner': {
      return [
        {
          key: 'tell',
          content: (
            <StepBody text={t('tellTradingPartner', { tradingPartner: tradingPartner.name })}>
              <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
                <CopyPartnerMessage run={run} />
                {target && <FixLink primary={false} target={target} />}
              </div>
            </StepBody>
          ),
        },
        { key: 'markWaiting', content: <MarkWaitingStep run={run} /> },
      ]
    }
  }
}

function WhatToDo({ children }: { children: ReactNode }) {
  const t = useTranslations('Document.problem')

  return (
    <section aria-labelledby="what-to-do" className="flex min-w-0 flex-col gap-3">
      <h3 id="what-to-do" tabIndex={-1} className="scroll-mt-20 text-sm font-semibold outline-none">
        {t('whatToDo')}
      </h3>
      {children}
    </section>
  )
}

function Steps({ steps }: { steps: ReadonlyArray<WhatToDoStep> }) {
  return (
    <ol className="flex flex-col gap-4 text-sm">
      {steps.map((step, index) => (
        <li key={step.key} className="flex gap-3">
          <span
            aria-hidden
            className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
            {index + 1}
          </span>
          {step.content}
        </li>
      ))}
    </ol>
  )
}

function WaitingNote({ run, since }: { run: FailedRun; since: string }) {
  const t = useTranslations('Document.problem')
  const format = useFormatter()

  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm">
      <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} aria-hidden className="size-4 shrink-0" />
      <span>
        {t.rich('waiting', {
          tradingPartner: run.tradingPartner.name,
          since: format.dateTime(new Date(since), { dateStyle: 'medium', timeStyle: 'short' }),
          time: (chunks) => <time dateTime={since}>{chunks}</time>,
        })}
      </span>
    </p>
  )
}

export function ProblemCard({ run }: { run: FailedRun }) {
  const t = useTranslations('Document.problem')
  const { title, description } = useProblemText(run)
  const steps = useFixSteps(run)
  const freshlyReprocessed = useFreshlyReprocessed(run.id)
  const fixer = run.problem.whoFixes

  return (
    <Card className="ring-destructive/40">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            aria-hidden
            className="text-destructive-text size-5 shrink-0"
          />
          <CardTitle className="text-lg">
            <h2>{title}</h2>
          </CardTitle>
          <FixerBadge fixer={fixer} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="what-happened" className="flex min-w-0 flex-col gap-2">
          <h3 id="what-happened" className="text-sm font-semibold">
            {t('whatHappened')}
          </h3>
          <p className="text-muted-foreground text-sm">{description}</p>
          <p className="flex items-start gap-2 text-sm">
            <HugeiconsIcon
              icon={fixerIcons[fixer]}
              strokeWidth={2}
              aria-hidden
              className="mt-0.5 size-4 shrink-0"
            />
            {t(`whoFixes.${fixer}`, { tradingPartner: run.tradingPartner.name })}
          </p>
          {run.waitingForTradingPartnerSince !== null && (
            <WaitingNote run={run} since={run.waitingForTradingPartnerSince} />
          )}
        </section>
        <WhatToDo>
          {run.replacedBy || freshlyReprocessed ? (
            <ProcessedAgain replacedBy={freshlyReprocessed ? null : run.replacedBy} />
          ) : (
            <Steps steps={steps} />
          )}
        </WhatToDo>
      </CardContent>
    </Card>
  )
}
