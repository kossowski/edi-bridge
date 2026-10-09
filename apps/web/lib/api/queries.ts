import { keepPreviousData, type QueryClient, queryOptions } from '@tanstack/react-query'

import type {
  Channel,
  Flow,
  MessageType,
  RunListQuery,
  TradingPartner,
} from '@edi-bridge/contracts'

import {
  getChannel,
  getCurrentWorkspace,
  getDocumentStructure,
  getFlow,
  getInterchange,
  getMappingDraft,
  getMessageTypeStructure,
  getRun,
  getTradingPartner,
  listChannels,
  listFlows,
  listMappings,
  listMappingVersions,
  listPublishedMappingVersions,
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

export const mappingKeys = {
  all: () => ['mappings'] as const,
  list: () => [...mappingKeys.all(), 'list'] as const,
  draft: (id: string) => [...mappingKeys.all(), id, 'draft'] as const,
  versions: (id: string) => [...mappingKeys.all(), id, 'versions'] as const,
}

export const mappingsQuery = queryOptions({
  queryKey: mappingKeys.list(),
  queryFn: listMappings,
})

export function mappingDraftQuery(id: string) {
  return queryOptions({
    queryKey: mappingKeys.draft(id),
    queryFn: () => getMappingDraft(id),
  })
}

export function documentStructureQuery(id: string) {
  return queryOptions({
    queryKey: ['document-structures', id],
    queryFn: () => getDocumentStructure(id),
  })
}

export function messageTypeStructureQuery(messageType: MessageType) {
  return queryOptions({
    queryKey: ['message-types', messageType, 'structure'],
    queryFn: () => getMessageTypeStructure(messageType),
  })
}

export function mappingVersionsQuery(mappingId: string) {
  return queryOptions({
    queryKey: mappingKeys.versions(mappingId),
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

export function publishedMappingVersionsQuery(messageType: MessageType) {
  return queryOptions({
    queryKey: ['mapping-versions', 'published', messageType],
    queryFn: () => listPublishedMappingVersions({ messageType }),
  })
}

export const flowKeys = {
  all: () => ['flows'] as const,
  list: () => [...flowKeys.all(), 'list'] as const,
  detail: (id: string) => [...flowKeys.all(), 'detail', id] as const,
}

export const flowsQuery = queryOptions({
  queryKey: flowKeys.list(),
  queryFn: listFlows,
})

export function flowQuery(id: string) {
  return queryOptions({
    queryKey: flowKeys.detail(id),
    queryFn: () => getFlow(id),
  })
}

export function storeSavedFlow(queryClient: QueryClient, saved: Flow) {
  queryClient.setQueryData(flowQuery(saved.id).queryKey, saved)
  void queryClient.invalidateQueries({ queryKey: flowKeys.list() })
}
