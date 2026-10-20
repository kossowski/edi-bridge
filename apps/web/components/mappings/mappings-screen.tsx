'use client'

import {
  Add01Icon,
  AiMagicIcon,
  ArrowDownLeft01Icon,
  ArrowRight02Icon,
  ArrowUpRight01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { LoadError } from '@/components/load-error'
import { DirectionHint, ErpEnd, PartnerEnd } from '@/components/mappings/direction-path'
import { MappingCard } from '@/components/mappings/mapping-card'
import {
  byState,
  filterCounts,
  type MappingFilter,
  mappingFilters,
  matchesFilter,
} from '@/components/mappings/mapping-state'
import { NewMappingChoices, NewMappingSheet } from '@/components/mappings/new-mapping'
import { useCanChange } from '@/hooks/use-session'
import { mappingsQuery } from '@/lib/api/queries'
import { navigationItems } from '@/lib/navigation'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { Direction, MappingSummary, NewMappingMessageType } from '@edi-bridge/contracts'

const directions = ['inbound', 'outbound'] as const satisfies ReadonlyArray<Direction>

const shownPerLane = 20

function Lane({
  direction,
  mappings,
  loading,
  onAddAnother,
}: {
  direction: Direction
  mappings: ReadonlyArray<MappingSummary>
  loading: boolean
  onAddAnother: (() => void) | null
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
      {!loading && onAddAnother && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground hover:border-primary hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-ring/50 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm transition-colors outline-none focus-visible:ring-3"
          onClick={onAddAnother}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden className="size-4" />
          {t(`another.${direction}`)}
        </button>
      )}
    </section>
  )
}

function FirstMapping({
  canChange,
  messageType,
}: {
  canChange: boolean
  messageType: NewMappingMessageType | null
}) {
  const t = useTranslations('Mappings')
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      className="bg-muted/40 @container mx-auto flex w-full max-w-5xl flex-col items-center gap-6 rounded-2xl border px-4 py-10 text-center sm:px-10">
      <p aria-hidden className="flex items-center gap-3 text-sm">
        <PartnerEnd>{t('first.partners')}</PartnerEnd>
        <span className="text-muted-foreground flex flex-col items-center leading-none">
          <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} className="size-4" />
          <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} className="size-4 rotate-180" />
        </span>
        <ErpEnd>{t('lane.erp')}</ErpEnd>
      </p>
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-xl font-semibold text-balance">
          {t('first.title')}
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">
          {canChange ? t('first.description') : t('first.viewOnlyDescription')}
        </p>
      </div>
      {canChange && (
        <NewMappingChoices
          direction={null}
          messageType={messageType}
          className="w-full text-left @xl:grid-cols-2 @4xl:grid-cols-3"
        />
      )}
    </section>
  )
}

export function MappingsScreen({
  newMessageType = null,
}: {
  newMessageType?: NewMappingMessageType | null
}) {
  const t = useTranslations()
  const tMappings = useTranslations('Mappings')
  const mappings = useQuery(mappingsQuery)
  const canChange = useCanChange()
  const router = useRouter()
  const [filter, setFilter] = useState<MappingFilter>('all')
  const [sheetOpen, setSheetOpen] = useState(newMessageType !== null)
  const [sheetDirection, setSheetDirection] = useState<Direction | null>(null)
  const [sheetMessageType, setSheetMessageType] = useState(newMessageType)

  function openSheet(direction: Direction | null) {
    setSheetDirection(direction)
    setSheetMessageType(null)
    setSheetOpen(true)
  }

  // The link from elsewhere leaves the address once the sheet closes, so a reload does not open it.
  function changeSheetOpen(open: boolean) {
    setSheetOpen(open)

    if (!open && newMessageType !== null) {
      router.replace(navigationItems.mappings.href, { scroll: false })
    }
  }

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

  if (mappings.isSuccess && all.length === 0) {
    return (
      <AppPage title={t('Sidebar.items.mappings.label')}>
        <FirstMapping canChange={canChange} messageType={newMessageType} />
      </AppPage>
    )
  }

  return (
    <AppPage
      busy={mappings.isPending}
      changeActions={
        <Button onClick={() => openSheet(null)}>
          <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} data-icon="inline-start" />
          {tMappings('new.button')}
        </Button>
      }
      meta={
        mappings.isPending ? (
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
                className="text-foreground"
                onClick={() => setFilter(key)}>
                {key === 'attention' && counts.attention > 0 && (
                  <span aria-hidden className="bg-destructive size-2 rounded-full" />
                )}
                {tMappings(`filter.${key}`)}
                <span className="tabular-nums">{counts[key]}</span>
              </Button>
            ))}
          </div>
        )
      }
      title={t('Sidebar.items.mappings.label')}>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {directions.map((direction) => (
          <Lane
            key={`${direction}-${filter}`}
            direction={direction}
            loading={mappings.isPending}
            mappings={sorted.filter((mapping) => mapping.direction === direction)}
            onAddAnother={canChange ? () => openSheet(direction) : null}
          />
        ))}
      </div>
      <NewMappingSheet
        direction={sheetDirection}
        messageType={sheetMessageType}
        open={sheetOpen && canChange}
        onOpenChange={changeSheetOpen}
      />
    </AppPage>
  )
}
