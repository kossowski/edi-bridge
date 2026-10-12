'use client'

import {
  ArrowDownLeft01Icon,
  ArrowRight02Icon,
  ArrowUpRight01Icon,
  DatabaseIcon,
  Store01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { LoadError } from '@/components/load-error'
import { MappingCard } from '@/components/mappings/mapping-card'
import {
  byState,
  filterCounts,
  type MappingFilter,
  mappingFilters,
  matchesFilter,
} from '@/components/mappings/mapping-state'
import { mappingsQuery } from '@/lib/api/queries'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { Direction, MappingSummary } from '@edi-bridge/contracts'

const directions = ['inbound', 'outbound'] as const satisfies ReadonlyArray<Direction>

const shownPerLane = 20

function DirectionHint({ direction }: { direction: Direction }) {
  const t = useTranslations('Mappings')

  const partner = (
    <span className="inline-flex items-center gap-1">
      <HugeiconsIcon icon={Store01Icon} strokeWidth={2} aria-hidden className="size-3.5" />
      {t('lane.partner')}
    </span>
  )

  const erp = (
    <span className="inline-flex items-center gap-1">
      <HugeiconsIcon icon={DatabaseIcon} strokeWidth={2} aria-hidden className="size-3.5" />
      {t('lane.erp')}
    </span>
  )

  return (
    <p className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
      {direction === 'inbound' ? partner : erp}
      <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} aria-hidden className="size-3.5" />
      <span className="sr-only">{t(`path.${direction}`)}</span>
      {direction === 'inbound' ? erp : partner}
    </p>
  )
}

function Lane({
  direction,
  mappings,
  loading,
}: {
  direction: Direction
  mappings: ReadonlyArray<MappingSummary>
  loading: boolean
}) {
  const t = useTranslations('Mappings.lane')
  const headingId = useId()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? mappings : mappings.slice(0, shownPerLane)

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
          <HugeiconsIcon
            icon={direction === 'inbound' ? ArrowDownLeft01Icon : ArrowUpRight01Icon}
            strokeWidth={2}
            aria-hidden
            className="size-4"
          />
          {t(direction)}
        </h2>
        <DirectionHint direction={direction} />
      </div>
      {loading && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      )}
      {!loading && shown.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      )}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-3">
          {shown.map((mapping) => (
            <li key={mapping.id}>
              <MappingCard mapping={mapping} />
            </li>
          ))}
        </ul>
      )}
      {shown.length < mappings.length && (
        <Button variant="outline" onClick={() => setExpanded(true)}>
          {t('showAll', { count: mappings.length })}
        </Button>
      )}
    </section>
  )
}

export function MappingsScreen() {
  const t = useTranslations()
  const tMappings = useTranslations('Mappings')
  const mappings = useQuery(mappingsQuery)
  const [filter, setFilter] = useState<MappingFilter>('all')

  if (mappings.isError) {
    return (
      <AppPage title={t('Sidebar.items.mappings.label')}>
        <LoadError
          description={tMappings('error.description')}
          retryLabel={tMappings('error.retry')}
          title={tMappings('error.title')}
          onRetry={() => void mappings.refetch()}
        />
      </AppPage>
    )
  }

  const all = mappings.data ?? []
  const counts = filterCounts(all)
  const sorted = byState(all.filter((mapping) => matchesFilter(mapping, filter)))

  return (
    <AppPage busy={mappings.isPending} title={t('Sidebar.items.mappings.label')}>
      {mappings.isPending ? (
        <p role="status" className="sr-only">
          {tMappings('loading')}
        </p>
      ) : (
        <div role="group" aria-label={tMappings('filter.label')} className="flex flex-wrap gap-1">
          {mappingFilters.map((key) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? 'secondary' : 'ghost'}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}>
              {key === 'attention' && counts.attention > 0 && (
                <span aria-hidden className="bg-destructive size-2 rounded-full" />
              )}
              {tMappings(`filter.${key}`)}
              <span className="tabular-nums">{counts[key]}</span>
            </Button>
          ))}
        </div>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {directions.map((direction) => (
          <Lane
            key={`${direction}-${filter}`}
            direction={direction}
            loading={mappings.isPending}
            mappings={sorted.filter((mapping) => mapping.direction === direction)}
          />
        ))}
      </div>
    </AppPage>
  )
}
