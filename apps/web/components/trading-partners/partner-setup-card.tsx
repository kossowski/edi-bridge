'use client'

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  Rocket01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

import { linkClass } from '@/components/detail-parts'
import {
  awaitsReceiptConfirmation,
  type PartnerActivityProps,
  testRejected,
} from '@/components/trading-partners/partner-page-helpers'
import {
  type PartnerSetup,
  type PartnerSetupItem,
  partnerSetup,
  type PartnerSetupStepState,
} from '@/components/trading-partners/partner-setup'
import { useSession } from '@/hooks/use-session'
import { sendTestInterchange, switchToProduction, testInterchangeRefusalOf } from '@/lib/api/client'
import { currentWorkspaceQuery, storeSavedTradingPartner } from '@/lib/api/queries'
import { documentHref, flowHref } from '@/lib/navigation'
import {
  canSendTestInterchange,
  canSwitchToProduction,
  type TestInterchangeRefusal,
  type TradingPartner,
} from '@edi-bridge/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@edi-bridge/ui/components/alert-dialog'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@edi-bridge/ui/components/card'
import { Progress } from '@edi-bridge/ui/components/progress'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

type SetupContext = {
  tradingPartner: TradingPartner
  workspaceGln: string | null
  canChange: boolean
  onLive: () => void
  onAddConnection: () => void
  onAddDocument: () => void
}

const stepBadges = {
  done: 'secondary',
  next: 'default',
  open: 'outline',
} as const satisfies Record<PartnerSetupStepState, 'secondary' | 'default' | 'outline'>

function SendRefused({ refusal, name }: { refusal: TestInterchangeRefusal; name: string }) {
  const t = useTranslations('TradingPartner.setup.sendRefused')

  switch (refusal.reason) {
    case 'notAwaited':
    case 'noOutboundFlow':
      return t(refusal.reason, { name })
    case 'sampleMissing':
      return t.rich('sampleMissing', {
        flow: refusal.flow.name,
        link: (chunks) => (
          <Link href={flowHref(refusal.flow.id)} className={linkClass}>
            {chunks}
          </Link>
        ),
      })
  }
}

function SendTestDocument({
  tradingPartner,
  again,
}: {
  tradingPartner: TradingPartner
  again: boolean
}) {
  const t = useTranslations('TradingPartner.setup')
  const queryClient = useQueryClient()

  const send = useMutation({
    mutationFn: () => sendTestInterchange(tradingPartner.id),
    onSuccess: (updated) => storeSavedTradingPartner(queryClient, updated),
  })

  const refusal = testInterchangeRefusalOf(send.error)

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        variant={again ? 'outline' : 'default'}
        aria-disabled={send.isPending || undefined}
        className="w-fit aria-disabled:cursor-progress aria-disabled:opacity-50"
        onClick={() => {
          if (!send.isPending) {
            send.mutate()
          }
        }}>
        {send.isPending
          ? t('actions.sending')
          : again
            ? t('actions.resend')
            : t('actions.testInterchange')}
      </Button>
      {send.isError && (
        <p role="alert" className="text-destructive-text text-sm">
          {refusal ? <SendRefused name={tradingPartner.name} refusal={refusal} /> : t('sendFailed')}
        </p>
      )}
    </div>
  )
}

function GoLive({
  tradingPartner,
  onLive,
}: {
  tradingPartner: TradingPartner
  onLive: () => void
}) {
  const t = useTranslations('TradingPartner.setup')
  const queryClient = useQueryClient()
  const cancel = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const name = tradingPartner.name

  const production = useMutation({
    mutationFn: () => switchToProduction(tradingPartner.id),
    onSuccess: (updated) => {
      onLive()
      storeSavedTradingPartner(queryClient, updated)
    },
  })

  function changeOpen(next: boolean) {
    if (production.isPending) {
      return
    }

    if (next) {
      production.reset()
    }

    setOpen(next)
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger render={<Button size="sm" className="w-fit" />}>
        <HugeiconsIcon icon={Rocket01Icon} strokeWidth={2} aria-hidden data-icon="inline-start" />
        {t('actions.production')}
      </AlertDialogTrigger>
      <AlertDialogContent initialFocus={cancel} aria-busy={production.isPending || undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('goLive.title', { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('goLive.description', { name })}</AlertDialogDescription>
        </AlertDialogHeader>
        {production.isError && (
          <p role="alert" className="text-destructive-text text-sm">
            {t('goLive.failed', { name })}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel
            ref={cancel}
            aria-disabled={production.isPending || undefined}
            className="aria-disabled:cursor-progress aria-disabled:opacity-50">
            {t('goLive.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            aria-disabled={production.isPending || undefined}
            className="aria-disabled:cursor-progress aria-disabled:opacity-50"
            onClick={() => {
              if (!production.isPending) {
                production.mutate()
              }
            }}>
            {production.isPending ? t('goLive.pending') : t('goLive.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Waiting({ tradingPartner }: { tradingPartner: TradingPartner }) {
  const t = useTranslations('TradingPartner.setup')
  const format = useFormatter()
  const now = useNow({ updateInterval: 30_000 })
  const sentAt = tradingPartner.onboarding.testInterchangeSentAt

  return (
    <div className="border-info/40 bg-info/10 flex flex-col gap-1 rounded-lg border p-3 text-sm">
      <p className="flex items-start gap-2">
        <HugeiconsIcon
          icon={Loading03Icon}
          strokeWidth={2}
          aria-hidden
          className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
        />
        {t('waiting', { name: tradingPartner.name })}
      </p>
      {sentAt && (
        <p className="pl-6">
          {t.rich('sentAt', {
            time: format.relativeTime(new Date(sentAt), now),
            when: (chunks) => <time dateTime={sentAt}>{chunks}</time>,
          })}
        </p>
      )}
    </div>
  )
}

function Rejected({ name, runId }: { name: string; runId: string | null }) {
  const t = useTranslations('TradingPartner.setup')

  return (
    <p className="border-destructive/40 bg-destructive/10 flex flex-wrap items-start gap-x-2 gap-y-1 rounded-lg border p-3 text-sm">
      <HugeiconsIcon
        icon={AlertCircleIcon}
        strokeWidth={2}
        aria-hidden
        className="text-destructive-text mt-0.5 size-4 shrink-0"
      />
      <span>{t('rejected', { name })}</span>
      {runId && (
        <Link href={documentHref(runId)} className={linkClass}>
          {t('rejectedReason')}
        </Link>
      )}
    </p>
  )
}

function Confirmed({ tradingPartner }: { tradingPartner: TradingPartner }) {
  const t = useTranslations('TradingPartner.setup')

  if (!tradingPartner.testMode || tradingPartner.onboarding.contrlReceivedAt === null) {
    return null
  }

  return (
    <p className="flex items-center gap-2 text-sm">
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        strokeWidth={2}
        aria-hidden
        className="text-success-text size-4 shrink-0"
      />
      {t('arrived', { name: tradingPartner.name })}
    </p>
  )
}

function StepAction({ item, context }: { item: PartnerSetupItem; context: SetupContext }) {
  const t = useTranslations('TradingPartner.setup')
  const { step, action } = item

  const { tradingPartner, workspaceGln, canChange, onLive, onAddConnection, onAddDocument } =
    context

  const viewOnly = (
    <p className="text-sm">{step === 'identity' ? t('viewOnly.identity') : t('viewOnly.other')}</p>
  )

  switch (action.kind) {
    case 'link':
      return canChange ? (
        <Link href={action.href} className={cn(buttonVariants({ size: 'sm' }), 'w-fit')}>
          {t(`actions.${action.step}`)}
        </Link>
      ) : (
        viewOnly
      )
    case 'addConnection':
      return canChange ? (
        <Button size="sm" className="w-fit" onClick={onAddConnection}>
          {t('actions.connections')}
        </Button>
      ) : (
        viewOnly
      )
    case 'addDocument':
      return canChange ? (
        <Button size="sm" className="w-fit" onClick={onAddDocument}>
          {t('actions.documents')}
        </Button>
      ) : (
        viewOnly
      )
    case 'sendTest':
      if (!canChange) {
        return viewOnly
      }

      return canSendTestInterchange(tradingPartner, workspaceGln) ? (
        <SendTestDocument again={false} tradingPartner={tradingPartner} />
      ) : null
    case 'awaitConfirmation':
      return (
        <>
          {testRejected(tradingPartner) ? (
            <Rejected
              name={tradingPartner.name}
              runId={tradingPartner.onboarding.testRejectedRunId}
            />
          ) : (
            <Waiting tradingPartner={tradingPartner} />
          )}
          {canChange && canSendTestInterchange(tradingPartner, workspaceGln) && (
            <SendTestDocument again tradingPartner={tradingPartner} />
          )}
        </>
      )
    case 'goLive':
      return (
        <>
          <Confirmed tradingPartner={tradingPartner} />
          {canChange
            ? canSwitchToProduction(tradingPartner, workspaceGln) && (
                <GoLive tradingPartner={tradingPartner} onLive={onLive} />
              )
            : viewOnly}
        </>
      )
  }
}

function SetupSteps({
  setup,
  titleId,
  context,
}: {
  setup: PartnerSetup
  titleId: string
  context: SetupContext
}) {
  const t = useTranslations('TradingPartner.setup')
  const format = useFormatter()
  const progress = t('progress', { done: setup.done, total: setup.total })

  return (
    <>
      <Progress
        getAriaValueText={() => progress}
        value={(setup.done / setup.total) * 100}
        aria-labelledby={titleId}>
        <span className="text-muted-foreground text-sm tabular-nums">{progress}</span>
      </Progress>
      <ol className="flex flex-col gap-3">
        {setup.steps.map((item, index) => {
          const { step, state, doneAt } = item

          return (
            <li
              key={step}
              aria-current={state === 'next' ? 'step' : undefined}
              className={cn(
                'flex gap-3 rounded-xl border p-4',
                state === 'next' && 'border-primary/40 bg-primary/5',
              )}>
              <span
                aria-hidden
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium tabular-nums',
                  state === 'done'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}>
                {state === 'done' ? (
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4" />
                ) : (
                  index + 1
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{t(`steps.${step}.title`)}</h3>
                  <Badge variant={stepBadges[state]}>{t(`state.${state}`)}</Badge>
                </div>
                <p className={cn('text-sm', state !== 'next' && 'text-muted-foreground')}>
                  {t(`steps.${step}.description`)}
                </p>
                {doneAt && (
                  <p className="text-sm">
                    {t.rich('doneAt', {
                      at: format.dateTime(new Date(doneAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                      when: (chunks) => <time dateTime={doneAt}>{chunks}</time>,
                    })}
                  </p>
                )}
                {state === 'next' && <StepAction context={context} item={item} />}
              </div>
            </li>
          )
        })}
      </ol>
    </>
  )
}

export function PartnerSetupCard({
  tradingPartner,
  activity,
  onAddConnection,
  onAddDocument,
}: PartnerActivityProps & { onAddConnection: () => void; onAddDocument: () => void }) {
  const t = useTranslations('TradingPartner.setup')
  const workspace = useQuery(currentWorkspaceQuery)
  const session = useSession()
  const titleId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [wentLive, setWentLive] = useState(false)
  const awaiting = awaitsReceiptConfirmation(tradingPartner)
  const [sawWaiting, setSawWaiting] = useState(awaiting)
  const name = tradingPartner.name
  const workspaceGln = workspace.data?.gln ?? null

  if (awaiting && !sawWaiting) {
    setSawWaiting(true)
  }

  useEffect(() => {
    if (wentLive && !tradingPartner.testMode) {
      heading.current?.focus()
    }
  }, [wentLive, tradingPartner.testMode])

  const status = !tradingPartner.testMode
    ? wentLive && t('goLive.done', { name })
    : sawWaiting &&
      !awaiting &&
      (testRejected(tradingPartner) ? t('rejected', { name }) : t('arrived', { name }))

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle>
          <h2 id={titleId} ref={heading} tabIndex={-1} className="outline-none">
            {t('title')}
          </h2>
        </CardTitle>
        {tradingPartner.testMode && <CardDescription>{t('description', { name })}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p role="status" className="sr-only">
          {status}
        </p>
        {!tradingPartner.testMode ? (
          <p className="flex items-center gap-2 text-sm">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              strokeWidth={2}
              aria-hidden
              className="text-success-text size-4 shrink-0"
            />
            {t('complete', { name })}
          </p>
        ) : workspace.isPending || session.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <SetupSteps
            context={{
              tradingPartner,
              workspaceGln,
              canChange: session.canChange,
              onLive: () => setWentLive(true),
              onAddConnection,
              onAddDocument,
            }}
            setup={partnerSetup(tradingPartner, activity, workspaceGln)}
            titleId={titleId}
          />
        )}
      </CardContent>
    </Card>
  )
}
