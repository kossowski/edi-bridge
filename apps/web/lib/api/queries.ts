import { keepPreviousData, queryOptions } from '@tanstack/react-query'

import type { RunListQuery } from '@edi-bridge/contracts'

import {
  getCurrentWorkspace,
  getInterchange,
  getRun,
  listFlows,
  listMappingVersions,
  listRuns,
  listTradingPartners,
} from './client'

export const currentWorkspaceQuery = queryOptions({
  queryKey: ['workspaces', 'current'],
  queryFn: getCurrentWorkspace,
})

export const runKeys = {
  lists: () => ['runs', 'list'] as const,
  list: (query: RunListQuery) => [...runKeys.lists(), query] as const,
  detail: (id: string) => ['runs', 'detail', id] as const,
}

export const interchangeKeys = {
  all: () => ['interchanges'] as const,
  detail: (id: string) => [...interchangeKeys.all(), 'detail', id] as const,
}

export function runsQuery(query: RunListQuery) {
  return queryOptions({
    queryKey: runKeys.list(query),
    queryFn: () => listRuns(query),
    placeholderData: keepPreviousData,
  })
}

export function runQuery(id: string) {
  return queryOptions({
    queryKey: runKeys.detail(id),
    queryFn: () => getRun(id),
  })
}

export function interchangeQuery(id: string) {
  return queryOptions({
    queryKey: interchangeKeys.detail(id),
    queryFn: () => getInterchange(id),
  })
}

export function mappingVersionsQuery(mappingId: string) {
  return queryOptions({
    queryKey: ['mappings', mappingId, 'versions'],
    queryFn: () => listMappingVersions(mappingId),
  })
}

export const tradingPartnersQuery = queryOptions({
  queryKey: ['trading-partners', 'list'],
  queryFn: listTradingPartners,
})

export const flowsQuery = queryOptions({
  queryKey: ['flows', 'list'],
  queryFn: listFlows,
})
