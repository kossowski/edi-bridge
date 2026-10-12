'use client'

import {
  CheckmarkCircle02Icon,
  File02Icon,
  FilterRemoveIcon,
  Route01Icon,
  Search01Icon,
  SearchRemoveIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { useEffect, useId, useRef, useState } from 'react'

import {
  clearedSearchFilters,
  type DocumentFilters,
  type DocumentView,
  documentViews,
  hasSearchFilters,
  statusGroupCount,
  toRunListQuery,
} from '@/components/documents/document-filters'
import {
  type EmptyAction,
  ListEmpty,
  Pagination,
  type ResultsProps,
} from '@/components/documents/list-parts'
import { RunRow, RunRowSkeleton } from '@/components/documents/run-row'
import { TransmissionResults } from '@/components/documents/transmission-results'
import { useDocumentFilters } from '@/components/documents/use-document-filters'
import { LoadError } from '@/components/load-error'
import { usePlainNames } from '@/components/plain-names'
import { runsQuery, tradingPartnersQuery } from '@/lib/api/queries'
import { type StatusGroup, statusGroups } from '@/lib/status-groups'
import { messageTypes, type RunList } from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@edi-bridge/ui/components/input-group'
import { NativeSelect, NativeSelectOption } from '@edi-bridge/ui/components/native-select'
import { ToggleGroup, ToggleGroupItem } from '@edi-bridge/ui/components/toggle-group'
import { cn } from '@edi-bridge/ui/lib/utils'

const searchDelay = 300

function SearchField({
  value,
  label,
  onSearch,
}: {
  value: string
  label: string
  onSearch: (q: string) => void
}) {
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const searched = useRef(value)

  if (value !== shown) {
    setShown(value)
    setText(value)
  }

  useEffect(() => {
    if (value !== searched.current) {
      searched.current = value
      clearTimeout(timer.current)
    }
  }, [value])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <InputGroup className="min-w-48 flex-1 sm:max-w-sm">
      <InputGroupAddon>
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        autoComplete="off"
        placeholder={label}
        type="search"
        value={text}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value

          setText(next)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            searched.current = next
            onSearch(next)
          }, searchDelay)
        }}
      />
    </InputGroup>
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
        label={filters.view === 'transmissions' ? t('searchTransmissions') : t('search')}
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
    <div className="-m-1 max-w-[calc(100%+0.5rem)] overflow-x-auto p-1">
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
  'noDocuments' | 'nothingNeedsAttention' | 'nothingMatches' | 'emptyGroup' | 'pageOutOfRange'

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

const emptyActions: Partial<Record<EmptyKind, EmptyAction>> = {
  nothingMatches: 'clear',
  pageOutOfRange: 'firstPage',
}

function RunResults({ filters, onChange, onClear }: ResultsProps) {
  const t = useTranslations('Documents')
  const listId = useId()

  const { data, isError, isPending, isPlaceholderData, refetch } = useQuery(
    runsQuery(toRunListQuery(filters)),
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

    if (settled?.runs.length === 0) {
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

    const waiting = isPending || (isPlaceholderData && data.runs.length === 0)

    return (
      <>
        <ul
          id={listId}
          aria-busy={isPending || isPlaceholderData}
          aria-label={t('list')}
          className={cn(
            '@container flex flex-col gap-2',
            isPlaceholderData && 'opacity-60 transition-opacity',
          )}>
          {waiting
            ? Array.from({ length: 8 }, (_, index) => <RunRowSkeleton key={index} />)
            : data.runs.map((run) => <RunRow key={run.id} run={run} />)}
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
      {results()}
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
        <TransmissionResults {...resultsProps} />
      ) : (
        <RunResults {...resultsProps} />
      )}
    </div>
  )
}
