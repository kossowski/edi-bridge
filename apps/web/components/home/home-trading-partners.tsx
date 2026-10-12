'use client'

import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  TestTube01Icon,
  UserMultiple02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId } from 'react'

import { useCanChange } from '@/hooks/use-session'
import { navigationItems } from '@/lib/navigation'
import { Badge } from '@edi-bridge/ui/components/badge'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { HomeTradingPartner } from '@edi-bridge/contracts'

const shownCount = 8

function ModeBadge({ testMode }: { testMode: boolean }) {
  const t = useTranslations('Home.tradingPartners')

  return (
    <Badge
      variant="outline"
      className={cn(
        'shrink-0 gap-1',
        testMode
          ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
          : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
      )}>
      <HugeiconsIcon
        icon={testMode ? TestTube01Icon : CheckmarkCircle02Icon}
        strokeWidth={2}
        aria-hidden
      />
      {testMode ? t('testing') : t('live')}
    </Badge>
  )
}

function TradingPartnerCard({
  card: { tradingPartner, testMode, documentsToday, openProblems },
}: {
  card: HomeTradingPartner
}) {
  const t = useTranslations('Home.tradingPartners')

  return (
    <li className="min-w-0">
      <Link
        href={`${navigationItems.tradingPartners.href}/${tradingPartner.id}`}
        className="bg-card hover:bg-muted/50 focus-visible:ring-ring/50 flex h-full flex-col gap-2 rounded-xl border p-3 outline-none focus-visible:ring-3">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-sm font-medium break-words">{tradingPartner.name}</span>
          <ModeBadge testMode={testMode} />
        </span>
        <span className="text-muted-foreground text-xs">
          {t('documentsToday', { count: documentsToday })}
        </span>
        <span
          className={cn(
            'flex items-center gap-1 text-xs',
            openProblems > 0 ? 'text-destructive font-medium' : 'text-muted-foreground',
          )}>
          {openProblems > 0 && (
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden className="size-3.5" />
          )}
          {t('openProblems', { count: openProblems })}
        </span>
      </Link>
    </li>
  )
}

function NoTradingPartners() {
  const t = useTranslations('Home.tradingPartners.empty')
  const canChange = useCanChange()

  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={UserMultiple02Icon} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{t('title')}</EmptyTitle>
        <EmptyDescription>{t('description')}</EmptyDescription>
      </EmptyHeader>
      {canChange && (
        <EmptyContent className="flex-row justify-center">
          <Link
            href={`${navigationItems.tradingPartners.href}/new`}
            className={buttonVariants({ variant: 'outline' })}>
            {t('action')}
          </Link>
        </EmptyContent>
      )}
    </Empty>
  )
}

export function HomeTradingPartners({
  tradingPartners,
}: {
  tradingPartners: ReadonlyArray<HomeTradingPartner> | undefined
}) {
  const t = useTranslations('Home.tradingPartners')
  const headingId = useId()

  function content() {
    if (!tradingPartners) {
      return (
        <ul aria-hidden className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="flex flex-col gap-2 rounded-xl border p-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-28" />
            </li>
          ))}
        </ul>
      )
    }

    if (tradingPartners.length === 0) {
      return <NoTradingPartners />
    }

    return (
      <>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tradingPartners.slice(0, shownCount).map((card) => (
            <TradingPartnerCard key={card.tradingPartner.id} card={card} />
          ))}
        </ul>
        {tradingPartners.length > shownCount && (
          <Link
            href={navigationItems.tradingPartners.href}
            className={buttonVariants({ variant: 'outline', size: 'sm', className: 'self-start' })}>
            {t('showAll', { count: tradingPartners.length })}
          </Link>
        )}
      </>
    )
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-sm font-medium">
        {t('title')}
      </h2>
      {content()}
    </section>
  )
}
