'use client'

import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { Fact, linkClass } from '@/components/detail-parts'
import {
  dateTimeFormat,
  OrderMessage,
  type OrderTradingPartner,
} from '@/components/orders/order-message'
import { OrderStatusIcon, type StepState, StepIcon } from '@/components/orders/order-status'
import {
  latestMessageCount,
  type OrderLifecycleStep,
  orderLifecycleSteps,
  shownMessages,
} from '@/components/orders/order-steps'
import { type OrderVerdict, orderVerdictOf } from '@/components/orders/order-verdict'
import { MessageTypeName, usePlainNames } from '@/components/plain-names'
import { tradingPartnerHref } from '@/lib/navigation'
import {
  type OrderLifecycle,
  type OrderLifecycleStep as SummaryStep,
  toOrderLifecycleSummary,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@edi-bridge/ui/components/card'

function useVerdictText(tradingPartner: string, verdict: OrderVerdict) {
  const t = useTranslations('Orders.verdict')
  const plainNames = usePlainNames()

  if (verdict.reason === 'done') {
    return t('done')
  }

  const values = {
    tradingPartner,
    document: plainNames.messageTypeNameInText(verdict.messageType),
    messageType: verdict.messageType,
  }

  return verdict.reason === 'nextDocument'
    ? t('nextDocument', values)
    : t(verdict.reason, { ...values, direction: verdict.direction })
}

function Verdict({ tradingPartner, verdict }: { tradingPartner: string; verdict: OrderVerdict }) {
  const t = useTranslations('Orders')
  const text = useVerdictText(tradingPartner, verdict)

  return (
    <Card
      className="data-[status=needs-attention]:bg-destructive/5 data-[status=needs-attention]:ring-destructive/30 data-[status=done]:bg-emerald-500/5 data-[status=done]:ring-emerald-500/30 data-[status=waiting-for-trading-partner]:bg-amber-500/5 data-[status=waiting-for-trading-partner]:ring-amber-500/30"
      data-status={verdict.status}>
      <CardContent className="flex items-start gap-3">
        <OrderStatusIcon status={verdict.status} className="mt-0.5 size-6" />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-lg font-medium text-balance">{text}</h3>
          <p className="text-sm">
            <span className="font-medium">{t(`status.${verdict.status}`)}</span>
            {'\u00a0· '}
            <span className="whitespace-nowrap">
              {t('verdict.progress', { done: verdict.done, total: verdict.total })}
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function StepMessages({
  tradingPartner,
  businessReference,
  step,
  now,
}: {
  tradingPartner: OrderTradingPartner
  businessReference: string
  step: OrderLifecycleStep
  now: Date
}) {
  const t = useTranslations('Orders.timeline')
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const collapsible = step.messages.length > latestMessageCount
  const shown = shownMessages(step.messages, expanded)

  return (
    <>
      {collapsible && !expanded && (
        <p className="text-muted-foreground text-sm">
          {t('latestShown', {
            shown: latestMessageCount,
            count: step.messages.length,
            attention: shown.length - latestMessageCount,
          })}
        </p>
      )}
      <ol id={listId} className="flex flex-col gap-2">
        {shown.map((message) => (
          <OrderMessage
            key={message.run.id}
            businessReference={businessReference}
            message={message}
            now={now}
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
            : t('showAll', { count: step.messages.length })}
        </Button>
      )}
    </>
  )
}

function TimelineStep({
  tradingPartner,
  businessReference,
  step,
  state,
  last,
  now,
}: {
  tradingPartner: OrderTradingPartner
  businessReference: string
  step: OrderLifecycleStep
  state: StepState
  last: boolean
  now: Date
}) {
  const t = useTranslations('Orders.timeline')
  const plainNames = usePlainNames()
  const empty = state === 'open' || state === 'missing' ? state : null

  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <StepIcon state={state} />
        {!last && (
          <span
            aria-hidden
            className="bg-border data-[state=done]:bg-success-text/40 my-1 w-px flex-1"
            data-state={state}
          />
        )}
      </div>
      <div
        className="flex min-w-0 flex-1 flex-col gap-3 pb-8 data-last:pb-0"
        data-last={last || undefined}>
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
          <h4 className="font-medium">
            <MessageTypeName messageType={step.messageType} />
          </h4>
          <span className="text-muted-foreground text-sm">
            {t(`state.${state}`)}
            {step.messages.length > 1 && (
              <>
                {'\u00a0· '}
                <span className="whitespace-nowrap">
                  {t('messageCount', { count: step.messages.length })}
                </span>
              </>
            )}
          </span>
        </div>
        {empty ? (
          <p className="text-muted-foreground text-sm">
            {t(empty, {
              document: plainNames.messageTypeNameInText(step.messageType),
              messageType: step.messageType,
            })}
          </p>
        ) : (
          <StepMessages
            businessReference={businessReference}
            now={now}
            step={step}
            tradingPartner={tradingPartner}
          />
        )}
      </div>
    </li>
  )
}

function OrderFacts({ lifecycle }: { lifecycle: OrderLifecycle }) {
  const t = useTranslations('Orders.facts')
  const format = useFormatter()
  const { startedAt, lastActivityAt } = toOrderLifecycleSummary(lifecycle)
  const titleId = useId()

  const dateTime = (value: string) => (
    <time dateTime={value}>{format.dateTime(new Date(value), dateTimeFormat)}</time>
  )

  return (
    <Card size="sm" className="h-fit">
      <CardHeader>
        <CardTitle>
          <h3 id={titleId}>{t('label')}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl aria-labelledby={titleId} className="flex flex-col gap-3">
          <Fact label={t('orderNumber')}>{lifecycle.businessReference}</Fact>
          <Fact label={t('tradingPartner')}>
            <Link href={tradingPartnerHref(lifecycle.tradingPartner.id)} className={linkClass}>
              {lifecycle.tradingPartner.name}
            </Link>
          </Fact>
          <Fact label={t('startedAt')}>{dateTime(startedAt)}</Fact>
          <Fact label={t('lastActivityAt')}>{dateTime(lastActivityAt)}</Fact>
        </dl>
      </CardContent>
    </Card>
  )
}

function stepStateOf(step: OrderLifecycleStep, stepStates: ReadonlyArray<SummaryStep>): StepState {
  if (step.missing) {
    return 'missing'
  }

  return stepStates.find(({ messageType }) => messageType === step.messageType)?.state ?? 'open'
}

export function OrderTimeline({ lifecycle }: { lifecycle: OrderLifecycle }) {
  const t = useTranslations('Orders')
  const now = useNow({ updateInterval: 60_000 })
  const headingId = useId()
  const verdict = orderVerdictOf(lifecycle)
  const { steps: stepStates } = toOrderLifecycleSummary(lifecycle)
  const steps = orderLifecycleSteps(lifecycle.messages)
  const { tradingPartner, businessReference } = lifecycle

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-xl font-semibold tracking-tight">
        {tradingPartner.name}
      </h2>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Verdict tradingPartner={tradingPartner.name} verdict={verdict} />
          <ol aria-label={t('timeline.label', { tradingPartner: tradingPartner.name })}>
            {steps.map((step, index) => (
              <TimelineStep
                key={step.messageType}
                businessReference={businessReference}
                last={index === steps.length - 1}
                now={now}
                state={stepStateOf(step, stepStates)}
                step={step}
                tradingPartner={tradingPartner}
              />
            ))}
          </ol>
        </div>
        <OrderFacts lifecycle={lifecycle} />
      </div>
    </section>
  )
}
