'use client'

import { Add01Icon, AlertCircleIcon, UserMultiple02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId, useState } from 'react'

import { TestModeBadge } from '@/components/trading-partners/test-mode-badge'
import { currentWorkspaceQuery, tradingPartnersQuery } from '@/lib/api/queries'
import { onboardingChecklist, type TradingPartner } from '@edi-bridge/contracts'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { Input } from '@edi-bridge/ui/components/input'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'

const columns = [
  'name',
  'gln',
  'mode',
  'onboarding',
  'characterSet',
  'acknowledgementTimeLimit',
] as const

function OnboardingProgress({
  tradingPartner,
  workspaceGln,
}: {
  tradingPartner: TradingPartner
  workspaceGln: string | null
}) {
  const t = useTranslations('TradingPartners')
  const tSteps = useTranslations('TradingPartner.onboarding.steps')

  const current = onboardingChecklist(tradingPartner, workspaceGln).find(
    ({ state }) => state === 'current',
  )

  return current ? t('nextStep', { step: tSteps(`${current.step}.title`) }) : t('complete')
}

function TradingPartnerRow({
  tradingPartner,
  workspaceGln,
}: {
  tradingPartner: TradingPartner
  workspaceGln: string | null
}) {
  const t = useTranslations('TradingPartners')

  return (
    <TableRow className="relative">
      <TableCell>
        <Link
          href={`/trading-partners/${tradingPartner.id}`}
          className="focus-visible:after:ring-ring font-medium underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:after:ring-2 focus-visible:after:ring-inset">
          {tradingPartner.name}
        </Link>
      </TableCell>
      <TableCell className="font-mono text-xs tabular-nums">{tradingPartner.gln}</TableCell>
      <TableCell>
        <TestModeBadge testMode={tradingPartner.testMode} />
      </TableCell>
      <TableCell>
        <OnboardingProgress tradingPartner={tradingPartner} workspaceGln={workspaceGln} />
      </TableCell>
      <TableCell className="font-mono text-xs">{tradingPartner.characterSet}</TableCell>
      <TableCell className="tabular-nums">
        {t('hours', { hours: tradingPartner.acknowledgementTimeLimitHours })}
      </TableCell>
    </TableRow>
  )
}

function LoadingRows({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <TableRow key={index}>
      {columns.map((column) => (
        <TableCell key={column}>
          <Skeleton className="h-4 w-full max-w-32" />
        </TableCell>
      ))}
    </TableRow>
  ))
}

function matches(tradingPartner: TradingPartner, search: string) {
  const term = search.trim().toLocaleLowerCase()

  return (
    term === '' ||
    tradingPartner.name.toLocaleLowerCase().includes(term) ||
    tradingPartner.gln.includes(term.replaceAll(/\s/g, ''))
  )
}

function TradingPartnersTable() {
  const t = useTranslations('TradingPartners')
  const searchId = useId()
  const [search, setSearch] = useState('')
  const tradingPartners = useQuery(tradingPartnersQuery)
  const workspace = useQuery(currentWorkspaceQuery)
  const workspaceGln = workspace.data?.gln ?? null

  if (tradingPartners.isError) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{t('error.title')}</EmptyTitle>
          <EmptyDescription>{t('error.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => void tradingPartners.refetch()}>
            {t('error.retry')}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  if (tradingPartners.data?.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={UserMultiple02Icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{t('empty.title')}</EmptyTitle>
          <EmptyDescription>{t('empty.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/trading-partners/new" className={buttonVariants()}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
            {t('new')}
          </Link>
        </EmptyContent>
      </Empty>
    )
  }

  const pending = tradingPartners.isPending || workspace.isPending
  const shown = (tradingPartners.data ?? []).filter((item) => matches(item, search))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-72">
          <label htmlFor={searchId} className="text-sm font-medium">
            {t('search')}
          </label>
          <Input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {pending
            ? t('loading')
            : search.trim() === ''
              ? t('count', { count: shown.length })
              : t('filteredCount', {
                  count: shown.length,
                  total: tradingPartners.data?.length ?? 0,
                })}
        </p>
      </div>
      <div className="rounded-lg border">
        <Table aria-busy={pending}>
          <TableCaption className="sr-only">{t('caption')}</TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column} scope="col">
                  {t(`columns.${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending ? (
              <LoadingRows count={6} />
            ) : shown.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground py-6 text-center">
                  {t('noMatch')}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((tradingPartner) => (
                <TradingPartnerRow
                  key={tradingPartner.id}
                  tradingPartner={tradingPartner}
                  workspaceGln={workspaceGln}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export function TradingPartnersScreen() {
  const t = useTranslations()

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Navigation.tradingPartners')}</h1>
        <Link href="/trading-partners/new" className={buttonVariants()}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
          {t('TradingPartners.new')}
        </Link>
      </div>
      <TradingPartnersTable />
    </div>
  )
}
