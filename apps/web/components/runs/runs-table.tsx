'use client'

import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
  PlayListIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'

import type { KeyboardEvent } from 'react'

import {
  hasActiveFilters,
  pageSizes,
  toRunListQuery,
  useRunFilters,
} from '@/components/runs/run-filters-store'
import { FailureStageLabel, RunStatusBadge } from '@/components/runs/run-status'
import { runsQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@edi-bridge/ui/components/select'
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
import { cn } from '@edi-bridge/ui/lib/utils'

import type { RunSummary } from '@edi-bridge/contracts'

const columns = [
  'receivedAt',
  'status',
  'failureStage',
  'tradingPartner',
  'messageType',
  'flow',
  'source',
] as const

function RunRows({ runs }: { runs: RunSummary[] }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const tabStop = Math.min(activeIndex, runs.length - 1)

  function moveFocus(event: KeyboardEvent<HTMLTableSectionElement>) {
    const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[data-run-link]')]
    const index = links.findIndex((link) => link === event.target)
    const last = links.length - 1

    const next = {
      ArrowDown: Math.min(index + 1, last),
      ArrowUp: Math.max(index - 1, 0),
      Home: 0,
      End: last,
    }[event.key]

    if (index === -1 || next === undefined) {
      return
    }

    event.preventDefault()
    links[next]?.focus()
  }

  return (
    <TableBody onKeyDown={moveFocus}>
      {runs.map((run, index) => (
        <RunRow
          key={run.id}
          run={run}
          tabIndex={index === tabStop ? 0 : -1}
          onFocus={() => setActiveIndex(index)}
        />
      ))}
    </TableBody>
  )
}

function RunRow({
  run,
  tabIndex,
  onFocus,
}: {
  run: RunSummary
  tabIndex: number
  onFocus: () => void
}) {
  const t = useTranslations('Runs')
  const format = useFormatter()

  return (
    <TableRow className="relative">
      <TableCell>
        <Link
          href={`/runs/${run.id}`}
          tabIndex={tabIndex}
          className="focus-visible:after:ring-ring font-medium tabular-nums underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:underline focus-visible:after:ring-2 focus-visible:after:ring-inset"
          data-run-link
          onFocus={onFocus}>
          <time dateTime={run.receivedAt}>
            {format.dateTime(new Date(run.receivedAt), {
              dateStyle: 'medium',
              timeStyle: 'medium',
            })}
          </time>
          <span className="sr-only">
            {' '}
            {t('openRun', {
              tradingPartner: run.tradingPartner.name,
              messageType: run.messageType,
            })}
          </span>
        </Link>
      </TableCell>
      <TableCell>
        <RunStatusBadge status={run.status} />
      </TableCell>
      <TableCell>
        <FailureStageLabel failureStage={run.failureStage} />
      </TableCell>
      <TableCell>{run.tradingPartner.name}</TableCell>
      <TableCell className="font-mono text-xs">{run.messageType}</TableCell>
      <TableCell>{run.flow.name}</TableCell>
      <TableCell>
        {run.manualSubmission ? t('manualSubmission.manual') : t('manualSubmission.channel')}
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

function RunsPagination({ total }: { total: number }) {
  const t = useTranslations('Runs.pagination')
  const { page, pageSize, setPage, setPageSize } = useRunFilters()
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <nav
      aria-label={t('label')}
      className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2">
      <Select
        items={pageSizes.map((size) => ({ value: String(size), label: String(size) }))}
        value={String(pageSize)}
        onValueChange={(value) => setPageSize(Number(value))}>
        <div className="flex items-center gap-2 text-sm">
          <span aria-hidden>{t('pageSize')}</span>
          <SelectTrigger size="sm" aria-label={t('pageSize')}>
            <SelectValue />
          </SelectTrigger>
        </div>
        <SelectContent>
          {pageSizes.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-sm tabular-nums">{t('page', { page, pageCount })}</p>
      <div className="flex items-center gap-1">
        <Button
          disabled={page <= 1}
          size="icon-sm"
          variant="outline"
          aria-label={t('first')}
          onClick={() => setPage(1)}>
          <HugeiconsIcon icon={ArrowLeftDoubleIcon} strokeWidth={2} />
        </Button>
        <Button
          disabled={page <= 1}
          size="icon-sm"
          variant="outline"
          aria-label={t('previous')}
          onClick={() => setPage(page - 1)}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <Button
          disabled={page >= pageCount}
          size="icon-sm"
          variant="outline"
          aria-label={t('next')}
          onClick={() => setPage(page + 1)}>
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
        </Button>
        <Button
          disabled={page >= pageCount}
          size="icon-sm"
          variant="outline"
          aria-label={t('last')}
          onClick={() => setPage(pageCount)}>
          <HugeiconsIcon icon={ArrowRightDoubleIcon} strokeWidth={2} />
        </Button>
      </div>
    </nav>
  )
}

export function RunsTable() {
  const t = useTranslations('Runs')
  const filters = useRunFilters()

  const { data, isError, isPending, isPlaceholderData, refetch } = useQuery(
    runsQuery(toRunListQuery(filters)),
  )

  if (isError && !data) {
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
          <Button variant="outline" onClick={() => void refetch()}>
            {t('error.retry')}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  if (data?.total === 0) {
    const filtered = hasActiveFilters(filters)

    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={PlayListIcon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{filtered ? t('empty.filteredTitle') : t('empty.title')}</EmptyTitle>
          <EmptyDescription>
            {filtered ? t('empty.filteredDescription') : t('empty.description')}
          </EmptyDescription>
        </EmptyHeader>
        {filtered && (
          <EmptyContent>
            <Button variant="outline" onClick={filters.clearFilters}>
              {t('filters.clearAll')}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p aria-live="polite" className="text-muted-foreground text-sm">
        {isPending ? t('loading') : t('count', { count: data.total })}
      </p>
      <div className="rounded-lg border">
        <Table
          aria-busy={isPending || isPlaceholderData}
          className={cn(isPlaceholderData && 'opacity-60 transition-opacity')}>
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
          {isPending ? (
            <TableBody>
              <LoadingRows count={10} />
            </TableBody>
          ) : (
            <RunRows runs={data.runs} />
          )}
        </Table>
      </div>
      {data && <RunsPagination total={data.total} />}
    </div>
  )
}
