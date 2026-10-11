'use client'

import { CircleIcon, DashedLineCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId } from 'react'

import { linkClass } from '@/components/detail-parts'
import {
  type OrderLifecycleStep,
  orderLifecycleSteps,
} from '@/components/order-lifecycle/order-lifecycle-steps'
import { RunLink } from '@/components/runs/run-link'
import { FailureStageLabel, RunStatusBadge } from '@/components/runs/run-status'
import { Badge } from '@edi-bridge/ui/components/badge'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { OrderLifecycle, OrderLifecycleMessage } from '@edi-bridge/contracts'

function MessageEntry({
  message,
  tradingPartner,
}: {
  message: OrderLifecycleMessage
  tradingPartner: string
}) {
  const t = useTranslations('OrderLifecycle')
  const tRuns = useTranslations('Runs')
  const { run, interchange } = message

  return (
    <li className="hover:bg-muted/50 relative flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-medium">{t(`direction.${message.direction}`)}</span>
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-muted-foreground">{t(`time.${message.direction}`)}</span>
          <RunLink
            description={tRuns('openRun', { tradingPartner, messageType: message.messageType })}
            run={{ id: run.id, receivedAt: message.receivedAt }}
          />
        </span>
        <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <RunStatusBadge status={run.status} />
          {run.status === 'failed' && (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{t('failureStage')}</span>
              <FailureStageLabel failureStage={run.failureStage} />
            </span>
          )}
        </span>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>
          {interchange
            ? t('controlReference', { controlReference: interchange.controlReference })
            : t('noInterchange')}
        </span>
        {run.replacedBy && (
          <span>
            {t('replacedBy')}{' '}
            <Link href={`/runs/${run.replacedBy.id}`} className={cn(linkClass, 'relative')}>
              {t('runLink', { id: run.replacedBy.id.slice(0, 8) })}
            </Link>
          </span>
        )}
      </div>
    </li>
  )
}

function Step({
  step,
  last,
  tradingPartner,
}: {
  step: OrderLifecycleStep
  last: boolean
  tradingPartner: string
}) {
  const t = useTranslations('OrderLifecycle')

  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {!last && <span aria-hidden className="bg-border absolute top-7 bottom-1 left-2.5 w-px" />}
      <HugeiconsIcon
        icon={step.open ? DashedLineCircleIcon : CircleIcon}
        strokeWidth={2}
        aria-hidden
        className={cn(
          'relative mt-0.5 size-5 shrink-0',
          step.open ? 'text-muted-foreground' : 'text-foreground',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono font-semibold">{step.messageType}</h3>
          {step.open ? (
            <Badge variant="outline" className="text-muted-foreground border-dashed">
              {t('open.label')}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-sm">
              {t('messageCount', { count: step.messages.length })}
            </span>
          )}
        </div>
        {step.open ? (
          <p className="text-muted-foreground text-sm">
            {t('open.description', { messageType: step.messageType })}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {step.messages.map((message) => (
              <MessageEntry
                key={message.run.id}
                message={message}
                tradingPartner={tradingPartner}
              />
            ))}
          </ol>
        )}
      </div>
    </li>
  )
}

export function OrderLifecycleTimeline({ lifecycle }: { lifecycle: OrderLifecycle }) {
  const t = useTranslations('OrderLifecycle')
  const headingId = useId()
  const steps = orderLifecycleSteps(lifecycle.messages)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-lg font-semibold">
          {lifecycle.tradingPartner.name}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t('messageCount', { count: lifecycle.messages.length })}
        </p>
      </div>
      <ol aria-label={t('timelineLabel', { tradingPartner: lifecycle.tradingPartner.name })}>
        {steps.map((step, index) => (
          <Step
            key={step.messageType}
            last={index === steps.length - 1}
            step={step}
            tradingPartner={lifecycle.tradingPartner.name}
          />
        ))}
      </ol>
    </section>
  )
}
