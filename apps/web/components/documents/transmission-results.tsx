'use client'

import {
  ArrowDownLeft01Icon,
  ArrowUpRight01Icon,
  Route01Icon,
  SearchRemoveIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId } from 'react'

import {
  type DocumentFilters,
  hasSearchFilters,
  toInterchangeListQuery,
} from '@/components/documents/document-filters'
import {
  type EmptyAction,
  ListEmpty,
  Pagination,
  type ResultsProps,
} from '@/components/documents/list-parts'
import { LoadError } from '@/components/load-error'
import { usePlainNames } from '@/components/plain-names'
import { RunStatusBadge } from '@/components/runs/run-status'
import { interchangesQuery } from '@/lib/api/queries'
import { runHref } from '@/lib/navigation'
import { Badge } from '@edi-bridge/ui/components/badge'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@edi-bridge/ui/components/item'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { InterchangeList, InterchangeSummary } from '@edi-bridge/contracts'

function InterchangeRow({ interchange }: { interchange: InterchangeSummary }) {
  const t = useTranslations('Documents.transmissions.row')
  const plainNames = usePlainNames()
  const format = useFormatter()
  const now = useNow({ updateInterval: 60_000 })
  const preparedAt = new Date(interchange.preparedAt)
  const titleId = useId()

  return (
    <Item render={<li />} variant="outline" className="items-start">
      <ItemMedia className="bg-muted text-muted-foreground size-8 rounded-full">
        <HugeiconsIcon
          icon={interchange.direction === 'inbound' ? ArrowDownLeft01Icon : ArrowUpRight01Icon}
          strokeWidth={2}
          aria-hidden
          className="size-4"
        />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle id={titleId} className="line-clamp-none flex-wrap">
          {t('title', {
            direction: interchange.direction,
            tradingPartner: interchange.tradingPartner.name,
          })}
          <Badge variant="outline" className="font-mono tabular-nums">
            {t('fileNumber', { controlReference: interchange.controlReference })}
          </Badge>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          <time
            dateTime={interchange.preparedAt}
            title={format.dateTime(preparedAt, { dateStyle: 'medium', timeStyle: 'medium' })}>
            {format.relativeTime(preparedAt, now)}
          </time>
          {' · '}
          {t('documents', { count: interchange.runs.length })}
        </ItemDescription>
        <ul aria-labelledby={titleId} className="mt-1 flex flex-col gap-1.5">
          {interchange.runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <Link
                href={runHref(run.id)}
                className="focus-visible:ring-ring/50 rounded-sm underline underline-offset-2 outline-none focus-visible:ring-3">
                {plainNames.messageTypeName(run.messageType)}
                {run.businessReference !== null && ` ${run.businessReference}`}
              </Link>
              <RunStatusBadge status={run.status} />
            </li>
          ))}
        </ul>
      </ItemContent>
    </Item>
  )
}

function InterchangeRowSkeleton() {
  return (
    <Item render={<li />} variant="outline" className="items-start">
      <Skeleton className="size-8 rounded-full" />
      <ItemContent>
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-4 w-40 max-w-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </ItemContent>
    </Item>
  )
}

type EmptyKind = 'noTransmissions' | 'nothingMatches' | 'pageOutOfRange'

const emptyIcons: Record<EmptyKind, IconSvgElement> = {
  noTransmissions: Route01Icon,
  nothingMatches: SearchRemoveIcon,
  pageOutOfRange: Route01Icon,
}

const emptyActions: Partial<Record<EmptyKind, EmptyAction>> = {
  nothingMatches: 'clear',
  pageOutOfRange: 'firstPage',
}

function emptyKind(filters: DocumentFilters, list: InterchangeList): EmptyKind {
  if (list.total > 0) {
    return 'pageOutOfRange'
  }

  return hasSearchFilters(filters) ? 'nothingMatches' : 'noTransmissions'
}

export function TransmissionResults({ filters, onChange, onClear }: ResultsProps) {
  const t = useTranslations('Documents.transmissions')
  const listId = useId()

  const { data, isError, isPending, isPlaceholderData, refetch } = useQuery(
    interchangesQuery(toInterchangeListQuery(filters)),
  )

  const settled = isPlaceholderData ? undefined : data

  function results() {
    if (isError && !data) {
      return (
        <LoadError
          description={t('error.description')}
          retryLabel={t('error.retry')}
          title={t('error.title')}
          onRetry={() => void refetch()}
        />
      )
    }

    if (settled?.interchanges.length === 0) {
      const kind = emptyKind(filters, settled)

      return (
        <ListEmpty
          action={emptyActions[kind]}
          description={t(`empty.${kind}.description`)}
          icon={emptyIcons[kind]}
          title={t(`empty.${kind}.title`)}
          onClear={onClear}
          onFirstPage={() => onChange({ page: 1 })}
        />
      )
    }

    const waiting = isPending || (isPlaceholderData && data.interchanges.length === 0)

    return (
      <>
        <ul
          id={listId}
          aria-busy={isPending || isPlaceholderData}
          aria-label={t('list')}
          className={cn(
            'flex flex-col gap-2',
            isPlaceholderData && 'opacity-60 transition-opacity',
          )}>
          {waiting
            ? Array.from({ length: 6 }, (_, index) => <InterchangeRowSkeleton key={index} />)
            : data.interchanges.map((interchange) => (
                <InterchangeRow key={interchange.id} interchange={interchange} />
              ))}
        </ul>
        {data && (
          <Pagination
            page={filters.page}
            total={data.total}
            onPage={(page) => {
              onChange({ page })
              document.getElementById(listId)?.scrollIntoView({ block: 'start' })
            }}
          />
        )}
      </>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <p className="text-muted-foreground max-w-2xl text-sm">{t('explanation')}</p>
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {isPending ? t('loading') : data && t('count', { count: data.total })}
        </p>
      </div>
      {results()}
    </>
  )
}
