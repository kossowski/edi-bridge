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
  type ResultsProps,
  toInterchangeListQuery,
} from '@/components/documents/document-filters'
import {
  type EmptyAction,
  ListEmpty,
  ListResults,
  useEmptyActions,
} from '@/components/documents/list-parts'
import { RunStatusBadge } from '@/components/documents/run-status'
import { usePlainNames } from '@/components/plain-names'
import { interchangesQuery } from '@/lib/api/queries'
import { documentHref } from '@/lib/navigation'
import { Badge } from '@edi-bridge/ui/components/badge'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@edi-bridge/ui/components/item'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { InterchangeList, InterchangeSummary } from '@edi-bridge/contracts'

function InterchangeRow({ interchange }: { interchange: InterchangeSummary }) {
  const t = useTranslations('Documents.interchanges.row')
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
                href={documentHref(run.id)}
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

type EmptyKind = 'noInterchanges' | 'nothingMatches' | 'pageOutOfRange'

const emptyIcons: Record<EmptyKind, IconSvgElement> = {
  noInterchanges: Route01Icon,
  nothingMatches: SearchRemoveIcon,
  pageOutOfRange: Route01Icon,
}

function emptyKind(filters: DocumentFilters, list: InterchangeList): EmptyKind {
  if (list.total > 0) {
    return 'pageOutOfRange'
  }

  return hasSearchFilters(filters) ? 'nothingMatches' : 'noInterchanges'
}

export function InterchangeResults({ filters, onChange, onClear }: ResultsProps) {
  const t = useTranslations('Documents.interchanges')

  const emptyActions: Partial<Record<EmptyKind, EmptyAction>> = useEmptyActions({
    onChange,
    onClear,
  })

  const query = useQuery(interchangesQuery(toInterchangeListQuery(filters)))
  const { data, isPending } = query

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <p className="text-muted-foreground max-w-2xl text-sm">{t('explanation')}</p>
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {isPending ? t('loading') : data && t('count', { count: data.total })}
        </p>
      </div>
      <ListResults
        empty={(list) => {
          const kind = emptyKind(filters, list)

          return (
            <ListEmpty
              action={emptyActions[kind]}
              description={t(`empty.${kind}.description`)}
              icon={emptyIcons[kind]}
              title={t(`empty.${kind}.title`)}
            />
          )
        }}
        entries={(list) => list.interchanges}
        error={{
          title: t('error.title'),
          description: t('error.description'),
          retry: t('error.retry'),
        }}
        label={t('list')}
        page={filters.page}
        query={query}
        renderEntry={(interchange) => (
          <InterchangeRow key={interchange.id} interchange={interchange} />
        )}
        skeleton={<InterchangeRowSkeleton />}
        skeletonCount={6}
        onPage={(page) => onChange({ page })}
      />
    </>
  )
}
