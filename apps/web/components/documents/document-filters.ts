import {
  type MessageType,
  messageTypeSchema,
  type RunListQuery,
  type RunStatus,
} from '@edi-bridge/contracts'

import { groupStatuses, type StatusGroup, statusGroups } from '../../lib/status-groups'

export const defaultStatusGroup: StatusGroup = 'attention'

export const runPageSize = 50

export type DocumentFilters = {
  status: StatusGroup
  q: string
  tradingPartnerId: string
  messageType: MessageType | ''
  page: number
}

export const clearedSearchFilters = {
  q: '',
  tradingPartnerId: '',
  messageType: '',
} satisfies Partial<DocumentFilters>

export const emptyDocumentFilters: DocumentFilters = {
  status: defaultStatusGroup,
  ...clearedSearchFilters,
  page: 1,
}

type SearchParamsReader = { get: (name: string) => string | null }

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

const pagePattern = /^[1-9]\d{0,5}$/

export function parseDocumentFilters(params: SearchParamsReader): DocumentFilters {
  const status = statusGroups.find((group) => group === params.get('status'))
  const tradingPartnerId = params.get('partner') ?? ''
  const messageType = messageTypeSchema.safeParse(params.get('type'))
  const page = params.get('page') ?? ''

  return {
    status: status ?? defaultStatusGroup,
    q: params.get('q') ?? '',
    tradingPartnerId: uuidPattern.test(tradingPartnerId) ? tradingPartnerId : '',
    messageType: messageType.success ? messageType.data : '',
    page: pagePattern.test(page) ? Number(page) : 1,
  }
}

export function documentFiltersSearch(filters: DocumentFilters) {
  const params = new URLSearchParams({ status: filters.status })

  if (filters.q.trim() !== '') {
    params.set('q', filters.q)
  }

  if (filters.tradingPartnerId !== '') {
    params.set('partner', filters.tradingPartnerId)
  }

  if (filters.messageType !== '') {
    params.set('type', filters.messageType)
  }

  if (filters.page > 1) {
    params.set('page', String(filters.page))
  }

  return params.toString()
}

export function documentsHref(filters: Partial<DocumentFilters> = {}) {
  return `/documents?${documentFiltersSearch({ ...emptyDocumentFilters, ...filters })}`
}

export function hasSearchFilters(filters: DocumentFilters) {
  return filters.q.trim() !== '' || filters.tradingPartnerId !== '' || filters.messageType !== ''
}

export function toRunListQuery(filters: DocumentFilters): RunListQuery {
  const q = filters.q.trim()

  return {
    status: filters.status === 'all' ? undefined : [...groupStatuses[filters.status]],
    tradingPartnerId: filters.tradingPartnerId === '' ? undefined : [filters.tradingPartnerId],
    messageType: filters.messageType === '' ? undefined : [filters.messageType],
    q: q === '' ? undefined : q,
    page: filters.page,
    pageSize: runPageSize,
  }
}

export function statusGroupCount(
  statusCounts: Readonly<Partial<Record<RunStatus, number>>>,
  group: StatusGroup,
) {
  const counts =
    group === 'all'
      ? Object.values(statusCounts)
      : groupStatuses[group].map((status) => statusCounts[status])

  return counts.reduce<number>((sum, count) => sum + (count ?? 0), 0)
}
