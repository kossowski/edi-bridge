import {
  type InterchangeListQuery,
  type MessageType,
  messageTypeSchema,
  type RunListQuery,
  type RunStatus,
} from '@edi-bridge/contracts'

import { type DocumentView, documentViews } from '../../lib/navigation'
import { listPageSize, parsePage, type SearchParamsReader, setPage } from '../../lib/search-params'
import { groupStatuses, type StatusGroup, statusGroups } from '../../lib/status-groups'

export const defaultStatusGroup: StatusGroup = 'attention'

export type DocumentFilters = {
  view: DocumentView
  status: StatusGroup
  q: string
  tradingPartnerId: string
  messageType: MessageType | ''
  page: number
}

export type ResultsProps = {
  filters: DocumentFilters
  onChange: (change: Partial<DocumentFilters>) => void
  onClear: () => void
}

export const clearedSearchFilters = {
  q: '',
  tradingPartnerId: '',
  messageType: '',
} satisfies Partial<DocumentFilters>

export const emptyDocumentFilters: DocumentFilters = {
  view: 'documents',
  status: defaultStatusGroup,
  ...clearedSearchFilters,
  page: 1,
}

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export function parseDocumentFilters(params: SearchParamsReader): DocumentFilters {
  const view = documentViews.find((candidate) => candidate === params.get('view'))
  const status = statusGroups.find((group) => group === params.get('status'))
  const tradingPartnerId = params.get('partner') ?? ''
  const messageType = messageTypeSchema.safeParse(params.get('type'))

  return {
    view: view ?? 'documents',
    status: status ?? defaultStatusGroup,
    q: params.get('q') ?? '',
    tradingPartnerId: uuidPattern.test(tradingPartnerId) ? tradingPartnerId : '',
    messageType: messageType.success ? messageType.data : '',
    page: parsePage(params),
  }
}

export function documentFiltersSearch(filters: DocumentFilters) {
  const params = new URLSearchParams()

  if (filters.view === 'transmissions') {
    params.set('view', filters.view)
  }

  if (filters.view === 'documents' || filters.status !== defaultStatusGroup) {
    params.set('status', filters.status)
  }

  if (filters.q.trim() !== '') {
    params.set('q', filters.q)
  }

  if (filters.tradingPartnerId !== '') {
    params.set('partner', filters.tradingPartnerId)
  }

  if (filters.messageType !== '') {
    params.set('type', filters.messageType)
  }

  setPage(params, filters.page)

  return params.toString()
}

export function documentsHref(filters: Partial<DocumentFilters> = {}) {
  return `/documents?${documentFiltersSearch({ ...emptyDocumentFilters, ...filters })}`
}

export function hasSearchFilters(filters: DocumentFilters) {
  return filters.q.trim() !== '' || filters.tradingPartnerId !== '' || filters.messageType !== ''
}

export function toInterchangeListQuery(filters: DocumentFilters): InterchangeListQuery {
  const q = filters.q.trim()

  return {
    tradingPartnerId: filters.tradingPartnerId === '' ? undefined : [filters.tradingPartnerId],
    messageType: filters.messageType === '' ? undefined : [filters.messageType],
    q: q === '' ? undefined : q,
    page: filters.page,
    pageSize: listPageSize,
  }
}

export function toRunListQuery(filters: DocumentFilters): RunListQuery {
  return {
    status: filters.status === 'all' ? undefined : [...groupStatuses[filters.status]],
    ...toInterchangeListQuery(filters),
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
