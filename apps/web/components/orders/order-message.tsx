'use client'

import {
  ArrowRight01Icon,
  Clock01Icon,
  Mail01Icon,
  MailBlock01Icon,
  MinusSignCircleIcon,
  RepeatIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useState } from 'react'

import { CopyButton } from '@/components/copy-button'
import { linkClass } from '@/components/detail-parts'
import { RunStatusBadge } from '@/components/documents/run-status'
import { AcknowledgementStateBadge } from '@/components/orders/acknowledgement-state'
import { confirmationNotTracked, waitingTimeOf } from '@/components/orders/order-verdict'
import { usePlainNames } from '@/components/plain-names'
import { Term } from '@/components/term'
import { documentHref, navigationItems, tradingPartnerHref } from '@/lib/navigation'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Textarea } from '@edi-bridge/ui/components/textarea'
import { cn } from '@edi-bridge/ui/lib/utils'

import type {
  AcknowledgementNotSentReason,
  OrderLifecycle,
  OrderLifecycleMessage,
} from '@edi-bridge/contracts'

export const dateTimeFormat = { dateStyle: 'medium', timeStyle: 'short' } as const

export type OrderTradingPartner = OrderLifecycle['tradingPartner']

function AskTradingPartner({
  tradingPartner,
  businessReference,
  message,
  controlReference,
}: {
  tradingPartner: string
  businessReference: string
  message: OrderLifecycleMessage
  controlReference: string
}) {
  const t = useTranslations('Orders.overdue')
  const format = useFormatter()
  const plainNames = usePlainNames()
  const [open, setOpen] = useState(false)
  const messageId = useId()
  const hintId = useId()

  const text = t('text', {
    tradingPartner,
    document: plainNames.messageTypeNameInText(message.messageType),
    messageType: message.messageType,
    businessReference,
    sentAt: format.dateTime(new Date(message.receivedAt), dateTimeFormat),
    controlReference,
  })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          size="sm"
          aria-controls={messageId}
          aria-describedby={hintId}
          aria-expanded={open}
          onClick={() => setOpen(!open)}>
          <HugeiconsIcon icon={Mail01Icon} strokeWidth={2} aria-hidden />
          {t('ask')}
        </Button>
        <span id={hintId} className="text-muted-foreground text-xs">
          {t('askHint')}
        </span>
      </div>
      <div id={messageId} hidden={!open} className="flex flex-col gap-2">
        <Textarea
          readOnly
          rows={8}
          value={text}
          aria-label={t('messageLabel', { tradingPartner })}
        />
        <CopyButton label={t('copyLabel')} value={text} />
      </div>
    </div>
  )
}

function OverdueHelp({
  tradingPartner,
  businessReference,
  message,
  controlReference,
}: {
  tradingPartner: OrderTradingPartner
  businessReference: string
  message: OrderLifecycleMessage
  controlReference: string
}) {
  const t = useTranslations('Orders.overdue')

  return (
    <div className="bg-muted/50 flex flex-col gap-3 rounded-lg border p-3">
      <p>
        <strong className="font-medium">{t('question')}</strong>{' '}
        {t.rich('explanation', {
          tradingPartner: tradingPartner.name,
          limit: tradingPartner.acknowledgementTimeLimitHours,
          term: (chunks) => <Term glossaryKey="acknowledgement">{chunks}</Term>,
        })}
      </p>
      <AskTradingPartner
        businessReference={businessReference}
        controlReference={controlReference}
        message={message}
        tradingPartner={tradingPartner.name}
      />
    </div>
  )
}

const notSentFixHref: Record<
  AcknowledgementNotSentReason,
  (tradingPartner: OrderTradingPartner) => string | null
> = {
  noOutboundChannel: ({ id }) => tradingPartnerHref(id, 'documents'),
  ambiguousChannel: ({ id }) => tradingPartnerHref(id, 'documents'),
  workspaceGlnMissing: () => navigationItems.settings.href,
  unechoableInterchangeHeader: () => null,
  demoChannel: () => null,
}

function NotSentHelp({
  tradingPartner,
  message,
  reason,
}: {
  tradingPartner: OrderTradingPartner
  message: OrderLifecycleMessage
  reason: AcknowledgementNotSentReason
}) {
  const t = useTranslations('Orders.notSent')
  const tMessage = useTranslations('Orders.message')
  const plainNames = usePlainNames()

  const fixHref = notSentFixHref[reason](tradingPartner)

  const values = {
    reason,
    tradingPartner: tradingPartner.name,
    document: plainNames.messageTypeNameInText(message.messageType),
    messageType: message.messageType,
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{tMessage('receiptConfirmation')}</span>
        <Badge
          variant="outline"
          className="gap-1 bg-amber-500/10 text-amber-800 dark:text-amber-300">
          <HugeiconsIcon icon={MailBlock01Icon} strokeWidth={2} aria-hidden />
          {t('state')}
        </Badge>
      </span>
      <p>
        {t('reason', values)}{' '}
        {t.rich('fix', {
          ...values,
          link: (chunks) =>
            fixHref === null ? (
              chunks
            ) : (
              <Link href={fixHref} className={linkClass}>
                {chunks}
              </Link>
            ),
        })}
      </p>
    </div>
  )
}

function NotTracked() {
  const t = useTranslations('Orders.message')

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{t('receiptConfirmation')}</span>
        <Badge variant="outline" className="text-muted-foreground gap-1">
          <HugeiconsIcon icon={MinusSignCircleIcon} strokeWidth={2} aria-hidden />
          {t('notTracked')}
        </Badge>
      </span>
      <span className="text-muted-foreground">{t('notTrackedReason')}</span>
    </div>
  )
}

function sentKind({ direction, run }: OrderLifecycleMessage) {
  if (direction === 'inbound') {
    return 'received'
  }

  return run.status === 'delivered' ? 'sent' : 'created'
}

export function OrderMessage({
  tradingPartner,
  businessReference,
  message,
  now,
}: {
  tradingPartner: OrderTradingPartner
  businessReference: string
  message: OrderLifecycleMessage
  now: Date
}) {
  const t = useTranslations('Orders.message')
  const format = useFormatter()
  const plainNames = usePlainNames()
  const { run, interchange } = message
  const acknowledgement = interchange?.acknowledgement ?? null
  const notSentReason = interchange?.notSentReason ?? null
  const replaced = run.replacedBy !== null
  const failed = run.status === 'failed' && !replaced
  const waiting = acknowledgement === 'pending' || acknowledgement === 'overdue'
  const waitingTime = waitingTimeOf(message.receivedAt, now)

  return (
    <li
      className="data-replaced:bg-muted/40 flex flex-col gap-2 rounded-lg border p-3 text-sm"
      data-replaced={replaced || undefined}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Link
          href={documentHref(run.id)}
          className={cn(linkClass, 'inline-flex flex-wrap items-baseline gap-x-2')}>
          <span>{plainNames.messageTypeName(message.messageType)}</span>{' '}
          <span className="text-muted-foreground font-normal">
            {t.rich('at', {
              kind: sentKind(message),
              date: format.dateTime(new Date(message.receivedAt), dateTimeFormat),
              time: (chunks) => <time dateTime={message.receivedAt}>{chunks}</time>,
            })}
          </span>
        </Link>
        <span className="sm:ml-auto">
          {replaced ? (
            <Badge variant="outline" className="text-muted-foreground gap-1">
              <HugeiconsIcon icon={RepeatIcon} strokeWidth={2} aria-hidden />
              {t('replaced')}
            </Badge>
          ) : (
            <RunStatusBadge status={run.status} />
          )}
        </span>
      </div>
      {run.status === 'failed' && run.failureStage !== null && (
        <p className={cn(replaced && 'text-muted-foreground')}>
          {plainNames.failureStageTitle(run.failureStage)}
        </p>
      )}
      {run.replacedBy && (
        <p className="text-muted-foreground">
          {t('replacedBy')}{' '}
          <Link href={documentHref(run.replacedBy.id)} className={linkClass}>
            {t('replacement')}
          </Link>
        </p>
      )}
      {acknowledgement && !replaced && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{t('receiptConfirmation')}</span>
            <AcknowledgementStateBadge state={acknowledgement} />
          </span>
          {waiting && (
            <span
              className="data-overdue:font-medium data-overdue:text-amber-800 dark:data-overdue:text-amber-300"
              data-overdue={acknowledgement === 'overdue' || undefined}>
              {t('waiting', {
                unit: waitingTime.unit,
                value: waitingTime.value,
                limit: tradingPartner.acknowledgementTimeLimitHours,
              })}
            </span>
          )}
        </div>
      )}
      {confirmationNotTracked(message) && !replaced && <NotTracked />}
      {notSentReason && !replaced && (
        <NotSentHelp message={message} reason={notSentReason} tradingPartner={tradingPartner} />
      )}
      {failed && run.waitingForTradingPartnerSince !== null && (
        <p className="text-muted-foreground flex items-center gap-2">
          <HugeiconsIcon
            icon={Clock01Icon}
            strokeWidth={2}
            aria-hidden
            className="size-4 shrink-0"
          />
          <span>
            {t('waitingForResend', {
              tradingPartner: tradingPartner.name,
              since: format.dateTime(new Date(run.waitingForTradingPartnerSince), dateTimeFormat),
            })}
          </span>
        </p>
      )}
      {failed && (
        <Link
          href={`${documentHref(run.id)}#what-to-do`}
          className={cn(buttonVariants({ size: 'sm' }), 'self-start')}>
          {t('seeWhatToDo')}
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            aria-hidden
            data-icon="inline-end"
          />
        </Link>
      )}
      {acknowledgement === 'overdue' && interchange && (
        <OverdueHelp
          businessReference={businessReference}
          controlReference={interchange.controlReference}
          message={message}
          tradingPartner={tradingPartner}
        />
      )}
    </li>
  )
}
