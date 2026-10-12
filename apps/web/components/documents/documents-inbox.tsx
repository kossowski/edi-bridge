'use client'

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  File02Icon,
  FilterRemoveIcon,
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
  hasSearchFilters,
  runPageSize,
  statusGroupCount,
  toRunListQuery,
} from '@/components/documents/document-filters'
import { RunRow, RunRowSkeleton } from '@/components/documents/run-row'
import { useDocumentFilters } from '@/components/documents/use-document-filters'
import { LoadError } from '@/components/load-error'
import { usePlainNames } from '@/components/plain-names'
import { runsQuery, tradingPartnersQuery } from '@/lib/api/queries'
import { type StatusGroup, statusGroups } from '@/lib/status-groups'
import { messageTypes, type RunList } from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@edi-bridge/ui/components/input-group'
import { NativeSelect, NativeSelectOption } from '@edi-bridge/ui/components/native-select'
import { ToggleGroup, ToggleGroupItem } from '@edi-bridge/ui/components/toggle-group'
import { cn } from '@edi-bridge/ui/lib/utils'

const searchDelay = 300

function SearchField({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const t = useTranslations('Documents.filters')
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
        placeholder={t('search')}
        type="search"
        value={text}
        aria-label={t('search')}
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
      <SearchField key={searchKey} value={filters.q} onSearch={(q) => onChange({ q })} />
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

function EmptyDocuments({
  kind,
  onClear,
  onFirstPage,
}: {
  kind: EmptyKind
  onClear: () => void
  onFirstPage: () => void
}) {
  const t = useTranslations('Documents')

  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={emptyIcons[kind]} strokeWidth={2} />
        </EmptyMedia>
        <EmptyTitle>{t(`empty.${kind}.title`)}</EmptyTitle>
        <EmptyDescription>{t(`empty.${kind}.description`)}</EmptyDescription>
      </EmptyHeader>
      {kind === 'nothingMatches' && (
        <EmptyContent>
          <Button variant="outline" onClick={onClear}>
            {t('filters.clear')}
          </Button>
        </EmptyContent>
      )}
      {kind === 'pageOutOfRange' && (
        <EmptyContent>
          <Button variant="outline" onClick={onFirstPage}>
            {t('pagination.first')}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

function Pagination({
  page,
  total,
  onPage,
}: {
  page: number
  total: number
  onPage: (page: number) => void
}) {
  const t = useTranslations('Documents.pagination')
  const pageCount = Math.max(1, Math.ceil(total / runPageSize))

  if (pageCount === 1) {
    return null
  }

  return (
    <nav aria-label={t('label')} className="flex items-center justify-end gap-3">
      <p className="text-sm tabular-nums">{t('page', { page, pageCount })}</p>
      <div className="flex items-center gap-1">
        <Button
          disabled={page <= 1}
          size="icon-sm"
          variant="outline"
          aria-label={t('previous')}
          onClick={() => onPage(page - 1)}>
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Button>
        <Button
          disabled={page >= pageCount}
          size="icon-sm"
          variant="outline"
          aria-label={t('next')}
          onClick={() => onPage(page + 1)}>
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
        </Button>
      </div>
    </nav>
  )
}

export function DocumentsInbox() {
  const t = useTranslations('Documents')
  const [filters, updateFilters] = useDocumentFilters()
  const listId = useId()
  const [searchKey, setSearchKey] = useState(0)

  const { data, isError, isPending, isPlaceholderData, refetch } = useQuery(
    runsQuery(toRunListQuery(filters)),
  )

  const settled = isPlaceholderData ? undefined : data

  const clearFilters = () => {
    setSearchKey((key) => key + 1)
    updateFilters(clearedSearchFilters)
  }

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
      return (
        <EmptyDocuments
          kind={emptyKind(filters, settled)}
          onClear={clearFilters}
          onFirstPage={() => updateFilters({ page: 1 })}
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
              updateFilters({ page })
              document.getElementById(listId)?.scrollIntoView({ block: 'start' })
            }}
          />
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Filters
        filters={filters}
        searchKey={searchKey}
        onChange={updateFilters}
        onClear={clearFilters}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <StatusGroupFilter
          statusCounts={data?.statusCounts}
          value={filters.status}
          onChange={(status) => updateFilters({ status })}
        />
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {isPending ? t('loading') : data && t('count', { count: data.total })}
        </p>
      </div>
      {results()}
    </div>
  )
}
