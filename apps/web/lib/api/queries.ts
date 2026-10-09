import { keepPreviousData, type QueryClient, queryOptions } from '@tanstack/react-query'

import type { Channel, RunListQuery, TradingPartner } from '@edi-bridge/contracts'

import {
  getChannel,
  getCurrentWorkspace,
  getInterchange,
  getRun,
  getTradingPartner,
  listChannels,
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

export const tradingPartnerKeys = {
  all: () => ['trading-partners'] as const,
  list: () => [...tradingPartnerKeys.all(), 'list'] as const,
  detail: (id: string) => [...tradingPartnerKeys.all(), 'detail', id] as const,
}

export const tradingPartnersQuery = queryOptions({
  queryKey: tradingPartnerKeys.list(),
  queryFn: listTradingPartners,
})

export function tradingPartnerQuery(id: string) {
  return queryOptions({
    queryKey: tradingPartnerKeys.detail(id),
    queryFn: () => getTradingPartner(id),
  })
}

export function storeSavedTradingPartner(queryClient: QueryClient, saved: TradingPartner) {
  queryClient.setQueryData(tradingPartnerQuery(saved.id).queryKey, saved)
  void queryClient.invalidateQueries({ queryKey: tradingPartnerKeys.list() })
}

export const channelKeys = {
  all: () => ['channels'] as const,
  list: () => [...channelKeys.all(), 'list'] as const,
  detail: (id: string) => [...channelKeys.all(), 'detail', id] as const,
}

export const channelsQuery = queryOptions({
  queryKey: channelKeys.list(),
  queryFn: listChannels,
})

export function channelQuery(id: string) {
  return queryOptions({
    queryKey: channelKeys.detail(id),
    queryFn: () => getChannel(id),
  })
}

export function storeSavedChannel(queryClient: QueryClient, saved: Channel) {
  queryClient.setQueryData(channelQuery(saved.id).queryKey, saved)
  void queryClient.invalidateQueries({ queryKey: channelKeys.list() })
}

export const flowsQuery = queryOptions({
  queryKey: ['flows', 'list'],
  queryFn: listFlows,
})
