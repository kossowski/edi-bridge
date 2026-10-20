'use client'

import { SearchRemoveIcon, ShoppingBasket01Icon } from '@hugeicons/core-free-icons'
import { type IconSvgElement } from '@hugeicons/react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'

import { type EmptyAction, ListEmpty, ListResults, SearchField } from '@/components/list-parts'
import {
  allOrders,
  type OrderFilters,
  orderFiltersSearch,
  orderStatusFilters,
  parseOrderFilters,
  type OrderStatusFilter,
  statusFilterCount,
  toOrderLifecycleListQuery,
} from '@/components/orders/order-filters'
import { OrderRow, OrderRowSkeleton } from '@/components/orders/order-row'
import { OrderStatusIcon } from '@/components/orders/order-status'
import { type UpdateFilters, useUrlFilters } from '@/hooks/use-url-filters'
import { orderLifecycleListQuery } from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import { ToggleGroup, ToggleGroupItem } from '@edi-bridge/ui/components/toggle-group'

import type { OrderLifecycleList } from '@edi-bridge/contracts'

function StatusFilter({
  value,
  statusCounts,
  onChange,
}: {
  value: OrderStatusFilter
  statusCounts: OrderLifecycleList['statusCounts'] | undefined
  onChange: (status: OrderStatusFilter) => void
}) {
  const t = useTranslations('Orders')
  const format = useFormatter()

  return (
    <ToggleGroup
      value={[value]}
      variant="outline"
      aria-label={t('list.statusFilter')}
      className="flex-wrap"
      onValueChange={(next) => {
        const status = orderStatusFilters.find((filter) => filter === next[0])

        if (status) {
          onChange(status)
        }
      }}>
      {orderStatusFilters.map((filter) => {
        const count = statusCounts && statusFilterCount(statusCounts, filter)

        return (
          <ToggleGroupItem key={filter} value={filter} className="gap-2">
            {filter !== 'all' && <OrderStatusIcon status={filter} className="size-4" />}
            {filter === 'all' ? t('list.all') : t(`status.${filter}`)}
            {count !== undefined && (
              <Badge
                variant={
                  filter === 'needs-attention' && count > 0 && filter !== value
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
  )
}

type EmptyKind = 'noOrders' | 'nothingMatches' | 'pageOutOfRange'

function emptyKind(filters: OrderFilters, list: OrderLifecycleList): EmptyKind {
  if (list.total > 0) {
    return 'pageOutOfRange'
  }

  if (filters.q.trim() === '' && statusFilterCount(list.statusCounts, 'all') === 0) {
    return 'noOrders'
  }

  return 'nothingMatches'
}

const emptyIcons: Record<EmptyKind, IconSvgElement> = {
  noOrders: ShoppingBasket01Icon,
  nothingMatches: SearchRemoveIcon,
  pageOutOfRange: ShoppingBasket01Icon,
}

function Results({
  query,
  filters,
  onChange,
  onShowAll,
}: {
  query: UseQueryResult<OrderLifecycleList>
  filters: OrderFilters
  onChange: UpdateFilters<OrderFilters>
  onShowAll: () => void
}) {
  const t = useTranslations('Orders.list')

  const emptyActions: Record<EmptyKind, EmptyAction | undefined> = {
    noOrders: undefined,
    nothingMatches: { label: t('showAll'), onClick: onShowAll },
    pageOutOfRange: {
      label: t('firstPage'),
      onClick: () => onChange({ page: 1 }, { replace: true }),
    },
  }

  const { data, isPending } = query

  return (
    <>
      <p aria-live="polite" className="text-muted-foreground text-sm">
        {isPending ? t('loading') : data && t('count', { count: data.total })}
      </p>
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
        entries={(list) => list.orderLifecycles}
        error={{
          title: t('error.title'),
          description: t('error.description'),
          retry: t('error.retry'),
        }}
        label={t('label')}
        page={filters.page}
        query={query}
        renderEntry={(order) => (
          <OrderRow key={`${order.businessReference} ${order.tradingPartner.id}`} order={order} />
        )}
        skeleton={<OrderRowSkeleton />}
        skeletonCount={8}
        className="@container"
        onPage={(page) => onChange({ page })}
      />
    </>
  )
}

export function OrdersList() {
  const t = useTranslations('Orders.list')
  const [filters, updateFilters] = useUrlFilters(parseOrderFilters, orderFiltersSearch)
  const [searchKey, setSearchKey] = useState(0)
  const query = useQuery(orderLifecycleListQuery(toOrderLifecycleListQuery(filters)))

  const showAll = () => {
    setSearchKey((key) => key + 1)
    updateFilters(allOrders)
  }

  return (
    <div className="flex flex-col gap-4">
      <search aria-label={t('filters')} className="flex flex-wrap items-center gap-2">
        <SearchField
          key={searchKey}
          label={t('search')}
          value={filters.q}
          onSearch={(q) => updateFilters({ q })}
        />
        <StatusFilter
          statusCounts={query.data?.statusCounts}
          value={filters.status}
          onChange={(status) => updateFilters({ status })}
        />
      </search>
      <Results filters={filters} query={query} onChange={updateFilters} onShowAll={showAll} />
    </div>
  )
}
