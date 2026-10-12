'use client'

import { CircleIcon, DashedLineCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { linkClass } from '@/components/detail-parts'
import { RunLink, shortId } from '@/components/documents/run-link'
import { FailureStageLabel, RunStatusBadge } from '@/components/documents/run-status'
import { AcknowledgementStateBadge } from '@/components/order-lifecycle/acknowledgement-state'
import {
  acknowledgementCounts,
  latestMessageCount,
  type OrderLifecycleStep,
  orderLifecycleSteps,
  shownMessages,
} from '@/components/order-lifecycle/order-lifecycle-steps'
import { documentHref, interchangeHref } from '@/lib/navigation'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
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
  const { run, interchange } = message

  return (
    <li className="hover:bg-muted/50 relative flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-medium">{t(`direction.${message.direction}`)}</span>
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-muted-foreground">{t('receivedAt')}</span>
          <RunLink
            description={t('openDocument', { tradingPartner, messageType: message.messageType })}
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
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span>
          {interchange ? (
            <Link
              href={interchangeHref(interchange.controlReference)}
              className={cn(linkClass, 'relative')}>
              {t('interchangeLink', { controlReference: interchange.controlReference })}
            </Link>
          ) : (
            t('noInterchange')
          )}
        </span>
        {interchange?.acknowledgement && (
          <span className="flex items-center gap-1.5">
            {t('acknowledgement.label')}
            <AcknowledgementStateBadge state={interchange.acknowledgement} />
          </span>
        )}
        {run.replacedBy && (
          <span>
            {t('replacedBy')}{' '}
            <Link href={documentHref(run.replacedBy.id)} className={cn(linkClass, 'relative')}>
              {t('documentLink', { id: shortId(run.replacedBy.id) })}
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
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const collapsible = step.messages.length > latestMessageCount
  const counts = collapsible ? acknowledgementCounts(step.messages) : []

  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {!last && <span aria-hidden className="bg-border absolute top-7 bottom-1 left-2.5 w-px" />}
      <HugeiconsIcon
        icon={step.open || step.missing ? DashedLineCircleIcon : CircleIcon}
        strokeWidth={2}
        aria-hidden
        className={cn(
          'relative mt-0.5 size-5 shrink-0',
          step.open || step.missing ? 'text-muted-foreground' : 'text-foreground',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono font-semibold">{step.messageType}</h3>
          {step.open || step.missing ? (
            <Badge variant="outline" className="text-muted-foreground border-dashed">
              {t(step.open ? 'open.label' : 'missing.label')}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-sm">
              {t('messageCount', { count: step.messages.length })}
            </span>
          )}
        </div>
        {step.open || step.missing ? (
          <p className="text-muted-foreground text-sm">
            {t(step.open ? 'open.description' : 'missing.description', {
              messageType: step.messageType,
            })}
          </p>
        ) : (
          <>
            {counts.length > 0 && (
              <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
                {t('acknowledgement.summary')}
                <ul
                  aria-label={t('acknowledgement.summaryLabel', {
                    messageType: step.messageType,
                  })}
                  className="flex flex-wrap gap-1.5">
                  {counts.map(({ state, count }) => (
                    <li key={state}>
                      <AcknowledgementStateBadge count={count} state={state} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {collapsible && !expanded && (
              <p className="text-muted-foreground text-sm">
                {t('latestShown', { shown: latestMessageCount, count: step.messages.length })}
              </p>
            )}
            <ol id={listId} className="flex flex-col gap-2">
              {shownMessages(step.messages, expanded).map((message) => (
                <MessageEntry
                  key={message.run.id}
                  message={message}
                  tradingPartner={tradingPartner}
                />
              ))}
            </ol>
            {collapsible && (
              <Button
                ref={toggleRef}
                size="sm"
                variant="outline"
                aria-controls={listId}
                aria-expanded={expanded}
                className="self-start"
                onClick={() => {
                  flushSync(() => setExpanded(!expanded))

                  if (expanded) {
                    toggleRef.current?.scrollIntoView({ block: 'nearest' })
                  }
                }}>
                {expanded
                  ? t('showLatest', { count: latestMessageCount })
                  : t('showAll', { count: step.messages.length, messageType: step.messageType })}
              </Button>
            )}
          </>
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
