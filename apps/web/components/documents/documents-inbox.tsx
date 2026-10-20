'use client'

import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  File02Icon,
  FilterRemoveIcon,
  Route01Icon,
  SearchRemoveIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'

import {
  clearedSearchFilters,
  type DocumentFilters,
  hasSearchFilters,
  type ResultsProps,
  statusGroupCount,
  toRunListQuery,
} from '@/components/documents/document-filters'
import { InterchangeResults } from '@/components/documents/interchange-results'
import { useEmptyActions } from '@/components/documents/list-parts'
import { RunRow, RunRowSkeleton } from '@/components/documents/run-row'
import { useDocumentFilters } from '@/components/documents/use-document-filters'
import { type EmptyAction, ListEmpty, ListResults, SearchField } from '@/components/list-parts'
import { useMappingTitle } from '@/components/mappings/mapping-card'
import { usePlainNames } from '@/components/plain-names'
import { mappingsQuery, runsQuery, tradingPartnersQuery } from '@/lib/api/queries'
import { type DocumentView, documentViews } from '@/lib/navigation'
import { type StatusGroup, statusGroups } from '@/lib/status-groups'
import { type MappingSummary, messageTypes, type RunList } from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { NativeSelect, NativeSelectOption } from '@edi-bridge/ui/components/native-select'
import { ToggleGroup, ToggleGroupItem } from '@edi-bridge/ui/components/toggle-group'

function MappingTitle({ mapping }: { mapping: MappingSummary }) {
  return useMappingTitle(mapping)
}

function MappingFilter({ mappingId, onRemove }: { mappingId: string; onRemove: () => void }) {
  const t = useTranslations('Documents.filters')
  const { data: mappings } = useQuery(mappingsQuery)
  const mapping = mappings?.find(({ id }) => id === mappingId)

  return (
    <Button variant="secondary" onClick={onRemove}>
      <span className="max-w-64 truncate">
        {t.rich('mapping', {
          name: () => (mapping ? <MappingTitle mapping={mapping} /> : '…'),
          hidden: (chunks) => <span className="sr-only">{chunks}</span>,
        })}
      </span>
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden data-icon="inline-end" />
    </Button>
  )
}

function Filters({
  filters,
  searchKey,
  onChange,
  onClear,
}: {
  filters: DocumentFilters
  searchKey: number
  onChange: (change: Partial<DocumentFilters>) => void
  onClear: () => void
}) {
  const t = useTranslations('Documents.filters')
  const plainNames = usePlainNames()
  const { data: tradingPartners = [] } = useQuery(tradingPartnersQuery)

  return (
    <search aria-label={t('label')} className="flex flex-wrap items-center gap-2">
      <SearchField
        key={searchKey}
        label={filters.view === 'transmissions' ? t('searchInterchanges') : t('search')}
        value={filters.q}
        onSearch={(q) => onChange({ q })}
      />
      <NativeSelect
        value={filters.tradingPartnerId}
        aria-label={t('tradingPartner')}
        onChange={(event) => onChange({ tradingPartnerId: event.target.value })}>
        <NativeSelectOption value="">{t('allTradingPartners')}</NativeSelectOption>
        {tradingPartners.map((tradingPartner) => (
          <NativeSelectOption key={tradingPartner.id} value={tradingPartner.id}>
            {tradingPartner.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect
        value={filters.messageType}
        aria-label={t('messageType')}
        onChange={(event) =>
          onChange({
            messageType: messageTypes.find((type) => type === event.target.value) ?? '',
          })
        }>
        <NativeSelectOption value="">{t('allMessageTypes')}</NativeSelectOption>
        {messageTypes.map((messageType) => (
          <NativeSelectOption key={messageType} value={messageType}>
            {plainNames.messageTypeName(messageType, true)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {filters.mappingId !== '' && (
        <MappingFilter mappingId={filters.mappingId} onRemove={() => onChange({ mappingId: '' })} />
      )}
      {hasSearchFilters(filters) && (
        <Button variant="ghost" onClick={onClear}>
          <HugeiconsIcon icon={FilterRemoveIcon} strokeWidth={2} data-icon="inline-start" />
          {t('clear')}
        </Button>
      )}
    </search>
  )
}

function StatusGroupFilter({
  value,
  statusCounts,
  onChange,
}: {
  value: StatusGroup
  statusCounts: RunList['statusCounts'] | undefined
  onChange: (status: StatusGroup) => void
}) {
  const t = useTranslations('Documents')
  const plainNames = usePlainNames()
  const format = useFormatter()

  return (
    <div className="max-w-full overflow-x-auto">
      <ToggleGroup
        spacing={0}
        value={[value]}
        variant="outline"
        aria-label={t('statusGroups')}
        onValueChange={(next) => {
          const status = statusGroups.find((group) => group === next[0])

          if (status) {
            onChange(status)
          }
        }}>
        {statusGroups.map((group) => {
          const count = statusCounts && statusGroupCount(statusCounts, group)

          return (
            <ToggleGroupItem key={group} value={group} className="gap-2">
              {plainNames.statusGroup(group)}
              {count !== undefined && (
                <Badge
                  variant={
                    group === 'attention' && count > 0 && group !== value
                      ? 'destructive'
                      : 'secondary'
                  }
                  className="tabular-nums">
                  {format.number(count)}
                </Badge>
              )}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
    </div>
  )
}

type EmptyKind =
  | 'noDocuments'
  | 'nothingNeedsAttention'
  | 'nothingMatches'
  | 'emptyGroup'
  | 'pageOutOfRange'

const emptyIcons: Record<EmptyKind, IconSvgElement> = {
  noDocuments: File02Icon,
  nothingNeedsAttention: CheckmarkCircle02Icon,
  nothingMatches: SearchRemoveIcon,
  emptyGroup: File02Icon,
  pageOutOfRange: File02Icon,
}

function emptyKind(filters: DocumentFilters, list: RunList): EmptyKind {
  if (list.total > 0) {
    return 'pageOutOfRange'
  }

  if (hasSearchFilters(filters)) {
    return 'nothingMatches'
  }

  if (statusGroupCount(list.statusCounts, 'all') === 0) {
    return 'noDocuments'
  }

  return filters.status === 'attention' ? 'nothingNeedsAttention' : 'emptyGroup'
}

function RunResults({ filters, onChange, onClear }: ResultsProps) {
  const t = useTranslations('Documents')

  const emptyActions: Partial<Record<EmptyKind, EmptyAction>> = useEmptyActions({
    onChange,
    onClear,
  })

  const query = useQuery(runsQuery(toRunListQuery(filters)))
  const { data, isPending } = query

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <StatusGroupFilter
          statusCounts={data?.statusCounts}
          value={filters.status}
          onChange={(status) => onChange({ status })}
        />
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
        entries={(list) => list.runs}
        error={{
          title: t('error.title'),
          description: t('error.description'),
          retry: t('error.retry'),
        }}
        label={t('list')}
        page={filters.page}
        query={query}
        renderEntry={(run) => <RunRow key={run.id} run={run} />}
        skeleton={<RunRowSkeleton />}
        skeletonCount={8}
        className="@container"
        onPage={(page) => onChange({ page })}
      />
    </>
  )
}

const viewIcons: Record<DocumentView, IconSvgElement> = {
  documents: File02Icon,
  transmissions: Route01Icon,
}

function ViewSwitch({
  value,
  onChange,
}: {
  value: DocumentView
  onChange: (view: DocumentView) => void
}) {
  const t = useTranslations('Documents.views')

  return (
    <ToggleGroup
      size="sm"
      spacing={1}
      value={[value]}
      aria-label={t('label')}
      onValueChange={(next) => {
        const view = documentViews.find((candidate) => candidate === next[0])

        if (view) {
          onChange(view)
        }
      }}>
      {documentViews.map((view) => (
        <ToggleGroupItem key={view} value={view}>
          <HugeiconsIcon icon={viewIcons[view]} strokeWidth={2} data-icon="inline-start" />
          {t(view)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function DocumentsInbox() {
  const [filters, updateFilters] = useDocumentFilters()
  const [searchKey, setSearchKey] = useState(0)

  const clearFilters = () => {
    setSearchKey((key) => key + 1)
    updateFilters(clearedSearchFilters)
  }

  const resultsProps = { filters, onChange: updateFilters, onClear: clearFilters }

  return (
    <div className="flex flex-col gap-4">
      <ViewSwitch value={filters.view} onChange={(view) => updateFilters({ view })} />
      <Filters
        filters={filters}
        searchKey={searchKey}
        onChange={updateFilters}
        onClear={clearFilters}
      />
      {filters.view === 'transmissions' ? (
        <InterchangeResults {...resultsProps} />
      ) : (
        <RunResults {...resultsProps} />
      )}
    </div>
  )
}
