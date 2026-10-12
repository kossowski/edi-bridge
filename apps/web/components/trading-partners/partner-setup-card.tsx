'use client'

import { CheckmarkCircle02Icon, Loading03Icon, Rocket01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

import { awaitsReceiptConfirmation } from '@/components/trading-partners/partner-page-helpers'
import { partnerSetup, type PartnerSetupStep } from '@/components/trading-partners/partner-setup'
import { useSession } from '@/hooks/use-session'
import { sendTestInterchange, switchToProduction } from '@/lib/api/client'
import { currentWorkspaceQuery, storeSavedTradingPartner } from '@/lib/api/queries'
import {
  canSendTestInterchange,
  canSwitchToProduction,
  type TradingPartner,
  type TradingPartnerActivityDetail,
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
import { Progress, ProgressLabel } from '@edi-bridge/ui/components/progress'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

const stepLinks: Partial<Record<PartnerSetupStep, string>> = {
  identity: '/settings',
  connections: '/channels/new',
  documents: '/flows/new',
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
          {t('sendFailed')}
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
  const trigger = useRef<HTMLButtonElement>(null)
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
      <Button ref={trigger} size="sm" className="w-fit" onClick={() => changeOpen(true)}>
        <HugeiconsIcon icon={Rocket01Icon} strokeWidth={2} aria-hidden data-icon="inline-start" />
        {t('actions.production')}
      </Button>
      <AlertDialogContent
        finalFocus={trigger}
        initialFocus={cancel}
        aria-busy={production.isPending || undefined}>
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
    <div className="flex flex-col gap-1 rounded-lg border border-sky-600/40 bg-sky-500/10 p-3 text-sm">
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

function StepAction({
  step,
  tradingPartner,
  workspaceGln,
  canChange,
  arrived,
  onLive,
}: {
  step: PartnerSetupStep
  tradingPartner: TradingPartner
  workspaceGln: string | null
  canChange: boolean
  arrived: boolean
  onLive: () => void
}) {
  const t = useTranslations('TradingPartner.setup')
  const link = stepLinks[step]

  if (step === 'contrl') {
    return (
      <>
        <Waiting tradingPartner={tradingPartner} />
        {canChange && canSendTestInterchange(tradingPartner, workspaceGln) && (
          <SendTestDocument again tradingPartner={tradingPartner} />
        )}
      </>
    )
  }

  const arrivedNote = step === 'production' && arrived && (
    <p className="flex items-center gap-2 text-sm">
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        strokeWidth={2}
        aria-hidden
        className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
      />
      {t('arrived', { name: tradingPartner.name })}
    </p>
  )

  if (!canChange) {
    return (
      <>
        {arrivedNote}
        <p className="text-sm">
          {step === 'identity' ? t('viewOnly.identity') : t('viewOnly.other')}
        </p>
      </>
    )
  }

  if (link) {
    return (
      <Link href={link} className={cn(buttonVariants({ size: 'sm' }), 'w-fit')}>
        {t(`actions.${step}`)}
      </Link>
    )
  }

  if (step === 'testInterchange' && canSendTestInterchange(tradingPartner, workspaceGln)) {
    return <SendTestDocument again={false} tradingPartner={tradingPartner} />
  }

  if (step === 'production' && canSwitchToProduction(tradingPartner, workspaceGln)) {
    return (
      <>
        {arrivedNote}
        <GoLive tradingPartner={tradingPartner} onLive={onLive} />
      </>
    )
  }

  return null
}

function doneAt(step: PartnerSetupStep, tradingPartner: TradingPartner) {
  switch (step) {
    case 'testInterchange':
      return tradingPartner.onboarding.testInterchangeSentAt
    case 'contrl':
      return tradingPartner.onboarding.contrlReceivedAt
    default:
      return null
  }
}

function SetupSteps({
  tradingPartner,
  activity,
  workspaceGln,
  canChange,
  arrived,
  onLive,
}: {
  tradingPartner: TradingPartner
  activity: TradingPartnerActivityDetail
  workspaceGln: string | null
  canChange: boolean
  arrived: boolean
  onLive: () => void
}) {
  const t = useTranslations('TradingPartner.setup')
  const format = useFormatter()
  const setup = partnerSetup(tradingPartner, activity, workspaceGln)
  const progress = t('progress', { done: setup.done, total: setup.total })

  return (
    <>
      <Progress getAriaValueText={() => progress} value={(setup.done / setup.total) * 100}>
        <ProgressLabel>{t('title')}</ProgressLabel>
        <span className="text-muted-foreground ml-auto text-sm tabular-nums">{progress}</span>
      </Progress>
      <ol className="flex flex-col gap-3">
        {setup.steps.map(({ step, done }, index) => {
          const next = step === setup.next
          const at = done ? doneAt(step, tradingPartner) : null

          return (
            <li
              key={step}
              aria-current={next ? 'step' : undefined}
              className={cn(
                'flex gap-3 rounded-xl border p-4',
                next && 'border-primary/40 bg-primary/5',
              )}>
              <span
                aria-hidden
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium tabular-nums',
                  done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}>
                {done ? (
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4" />
                ) : (
                  index + 1
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{t(`steps.${step}.title`)}</h3>
                  <Badge variant={done ? 'secondary' : next ? 'default' : 'outline'}>
                    {done ? t('state.done') : next ? t('state.next') : t('state.open')}
                  </Badge>
                </div>
                <p className={cn('text-sm', !next && 'text-muted-foreground')}>
                  {t(`steps.${step}.description`)}
                </p>
                {at && (
                  <p className="text-sm">
                    {t.rich('doneAt', {
                      at: format.dateTime(new Date(at), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                      when: (chunks) => <time dateTime={at}>{chunks}</time>,
                    })}
                  </p>
                )}
                {next && (
                  <StepAction
                    arrived={arrived}
                    canChange={canChange}
                    step={step}
                    tradingPartner={tradingPartner}
                    workspaceGln={workspaceGln}
                    onLive={onLive}
                  />
                )}
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
}: {
  tradingPartner: TradingPartner
  activity: TradingPartnerActivityDetail
}) {
  const t = useTranslations('TradingPartner.setup')
  const workspace = useQuery(currentWorkspaceQuery)
  const session = useSession()
  const titleId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [wentLive, setWentLive] = useState(false)
  const awaiting = awaitsReceiptConfirmation(tradingPartner)
  const [sawWaiting, setSawWaiting] = useState(awaiting)
  const name = tradingPartner.name

  if (awaiting && !sawWaiting) {
    setSawWaiting(true)
  }

  const arrived = sawWaiting && !awaiting && tradingPartner.testMode

  useEffect(() => {
    if (wentLive && !tradingPartner.testMode) {
      heading.current?.focus()
    }
  }, [wentLive, tradingPartner.testMode])

  const status = !tradingPartner.testMode
    ? wentLive && t('goLive.done', { name })
    : arrived && t('arrived', { name })

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
              className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
            />
            {t('complete', { name })}
          </p>
        ) : workspace.isPending || session.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <SetupSteps
            activity={activity}
            arrived={arrived}
            canChange={session.canChange}
            tradingPartner={tradingPartner}
            workspaceGln={workspace.data?.gln ?? null}
            onLive={() => setWentLive(true)}
          />
        )}
      </CardContent>
    </Card>
  )
}
