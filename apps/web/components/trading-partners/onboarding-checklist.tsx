'use client'

import { CheckmarkCircle02Icon, CircleIcon, Rocket01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { linkClass } from '@/components/detail-parts'
import { switchToProduction } from '@/lib/api/client'
import { storeSavedTradingPartner } from '@/lib/api/queries'
import {
  type OnboardingChecklistItem,
  onboardingChecklist,
  type OnboardingStep,
  type TradingPartner,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { cn } from '@edi-bridge/ui/lib/utils'

function StepIcon({ state }: { state: OnboardingChecklistItem['state'] }) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
        state === 'done' && 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
        state === 'current' &&
          'bg-sky-500/10 text-sky-800 ring-2 ring-sky-600/60 dark:text-sky-300',
        state === 'pending' && 'text-muted-foreground',
      )}>
      <HugeiconsIcon
        icon={state === 'done' ? CheckmarkCircle02Icon : CircleIcon}
        strokeWidth={2}
        className="size-4"
      />
    </span>
  )
}

function ProductionSwitch({
  tradingPartner,
  onSwitched,
}: {
  tradingPartner: TradingPartner
  onSwitched: () => void
}) {
  const t = useTranslations('TradingPartner.onboarding.switch')
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const toggled = useRef(false)
  const switchButton = useRef<HTMLButtonElement>(null)
  const confirmation = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (toggled.current) {
      ;(confirming ? confirmation : switchButton).current?.focus()
    }
  }, [confirming])

  function toggle(next: boolean) {
    toggled.current = true
    setConfirming(next)
  }

  const production = useMutation({
    mutationFn: () => switchToProduction(tradingPartner.id),
    onSuccess: (updated) => {
      onSwitched()
      storeSavedTradingPartner(queryClient, updated)
    },
  })

  if (!confirming) {
    return (
      <Button ref={switchButton} className="w-fit" onClick={() => toggle(true)}>
        <HugeiconsIcon icon={Rocket01Icon} strokeWidth={2} aria-hidden />
        {t('button')}
      </Button>
    )
  }

  return (
    <div
      role="group"
      aria-labelledby="production-confirm"
      className="flex flex-col gap-3 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3">
      <p id="production-confirm" ref={confirmation} tabIndex={-1} className="text-sm">
        {t('confirmation', { tradingPartner: tradingPartner.name })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={production.isPending} onClick={() => production.mutate()}>
          {production.isPending ? t('pending') : t('confirm')}
        </Button>
        <Button disabled={production.isPending} variant="outline" onClick={() => toggle(false)}>
          {t('cancel')}
        </Button>
      </div>
      {production.isError && (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t('failed')}
        </p>
      )}
    </div>
  )
}

function StepDetail({
  item,
  blockedBy,
  tradingPartner,
  onSwitched,
}: {
  item: OnboardingChecklistItem
  blockedBy: OnboardingStep | undefined
  tradingPartner: TradingPartner
  onSwitched: () => void
}) {
  const t = useTranslations('TradingPartner.onboarding')

  if (item.step === 'identity' && item.state === 'current') {
    return (
      <Link href="/settings" className={cn(linkClass, 'w-fit text-sm')}>
        {t('setIdentity')}
      </Link>
    )
  }

  if (item.step === 'production' && item.state === 'current') {
    return <ProductionSwitch tradingPartner={tradingPartner} onSwitched={onSwitched} />
  }

  if (
    item.step === 'production' &&
    item.state === 'pending' &&
    blockedBy !== undefined &&
    blockedBy !== 'production'
  ) {
    return <p className="text-muted-foreground text-sm">{t(`productionLocked.${blockedBy}`)}</p>
  }

  return null
}

export function OnboardingChecklist({
  tradingPartner,
  workspaceGln,
}: {
  tradingPartner: TradingPartner
  workspaceGln: string | null
}) {
  const t = useTranslations('TradingPartner.onboarding')
  const format = useFormatter()
  const checklist = onboardingChecklist(tradingPartner, workspaceGln)
  const blockedBy = checklist.find(({ state }) => state === 'current')?.step
  const [switched, setSwitched] = useState(false)
  const productionTitle = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (switched && !tradingPartner.testMode) {
      productionTitle.current?.focus()
    }
  }, [switched, tradingPartner.testMode])

  return (
    <ol className="flex flex-col gap-4 rounded-lg border p-4">
      {checklist.map((item) => (
        <li
          key={item.step}
          aria-current={item.state === 'current' ? 'step' : undefined}
          className="flex gap-3">
          <StepIcon state={item.state} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <p
              ref={item.step === 'production' ? productionTitle : undefined}
              tabIndex={item.step === 'production' ? -1 : undefined}
              className="flex flex-wrap items-baseline gap-x-2 font-medium">
              {t(`steps.${item.step}.title`)}
              <span
                className={cn(
                  'text-xs font-normal',
                  item.state === 'current'
                    ? 'text-sky-800 dark:text-sky-300'
                    : 'text-muted-foreground',
                )}>
                {t(`state.${item.state}`)}
              </span>
            </p>
            <p className="text-muted-foreground text-sm">{t(`steps.${item.step}.description`)}</p>
            {item.at && (
              <p className="text-sm">
                <time dateTime={item.at}>
                  {format.dateTime(new Date(item.at), { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
              </p>
            )}
            <StepDetail
              blockedBy={blockedBy}
              item={item}
              tradingPartner={tradingPartner}
              onSwitched={() => setSwitched(true)}
            />
          </div>
        </li>
      ))}
    </ol>
  )
}
