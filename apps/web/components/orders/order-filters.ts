import { listPageSize, parsePage, type SearchParamsReader, setPage } from '@/lib/search-params'
import {
  type OrderLifecycleListQuery,
  type OrderLifecycleStatus,
  orderLifecycleStatuses,
} from '@edi-bridge/contracts'

export type OrderStatusFilter = 'all' | OrderLifecycleStatus

export const orderStatusFilters: ReadonlyArray<OrderStatusFilter> = [
  'all',
  ...orderLifecycleStatuses,
]

export type OrderFilters = {
  q: string
  status: OrderStatusFilter
  page: number
}

export const allOrders: OrderFilters = { q: '', status: 'all', page: 1 }

export function parseOrderFilters(params: SearchParamsReader): OrderFilters {
  const status = orderLifecycleStatuses.find((candidate) => candidate === params.get('status'))

  return {
    q: params.get('q') ?? '',
    status: status ?? 'all',
    page: parsePage(params),
  }
}

export function orderFiltersSearch(filters: OrderFilters) {
  const params = new URLSearchParams()

  if (filters.q.trim() !== '') {
    params.set('q', filters.q)
  }

  if (filters.status !== 'all') {
    params.set('status', filters.status)
  }

  setPage(params, filters.page)

  return params.toString()
}

export function toOrderLifecycleListQuery(filters: OrderFilters): OrderLifecycleListQuery {
  const q = filters.q.trim()

  return {
    q: q === '' ? undefined : q,
    status: filters.status === 'all' ? undefined : [filters.status],
    page: filters.page,
    pageSize: listPageSize,
  }
}

export function statusFilterCount(
  statusCounts: Readonly<Partial<Record<OrderLifecycleStatus, number>>>,
  filter: OrderStatusFilter,
) {
  if (filter !== 'all') {
    return statusCounts[filter] ?? 0
  }

  return Object.values(statusCounts).reduce<number>((sum, count) => sum + (count ?? 0), 0)
}
