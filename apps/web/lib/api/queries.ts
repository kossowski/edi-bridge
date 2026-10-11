import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  useMutation,
} from '@tanstack/react-query'

import type {
  Channel,
  DocumentStructure,
  DocumentStructureOrigin,
  Flow,
  Invite,
  LookupTable,
  MappingComparisonQuery,
  MappingDraft,
  MappingGraph,
  MappingVersionSummary,
  MessageType,
  OverviewWindow,
  RunListQuery,
  TradingPartner,
  WorkspaceSettings,
  WorkspaceSummary,
} from '@edi-bridge/contracts'

import { compareWorkspaceNames } from '../forms/operator'
import {
  compareMappingVersions,
  getChannel,
  getCurrentWorkspace,
  getDocumentStructure,
  getFlow,
  getInterchange,
  getLookupTable,
  getMappingDraft,
  getMappingVersion,
  getOperatorWorkspaceSettings,
  getOverview,
  getRun,
  getSession,
  getTradingPartner,
  getWorkspaceSettings,
  inferDocumentStructure,
  listChannels,
  listDocumentStructures,
  listLookupTables,
  listFlows,
  listMappingSamples,
  listMappings,
  listMappingVersions,
  listOperatorWorkspaces,
  listOrderLifecycles,
  listPublishedMappingVersions,
  listRuns,
  listTradingPartners,
  listWorkspaceInvites,
  previewMapping,
} from './client'

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: getSession,
})

export const currentWorkspaceQuery = queryOptions({
  queryKey: ['workspaces', 'current'],
  queryFn: getCurrentWorkspace,
})

export const workspaceSettingsQuery = queryOptions({
  queryKey: ['workspaces', 'current', 'settings'],
  queryFn: getWorkspaceSettings,
})

export const operatorKeys = {
  all: () => ['operator', 'workspaces'] as const,
  list: () => [...operatorKeys.all(), 'list'] as const,
  invites: (id: string) => [...operatorKeys.all(), id, 'invites'] as const,
  settings: (id: string) => [...operatorKeys.all(), id, 'settings'] as const,
}

export const operatorWorkspacesQuery = queryOptions({
  queryKey: operatorKeys.list(),
  queryFn: listOperatorWorkspaces,
})

export function workspaceInvitesQuery(workspaceId: string) {
  return queryOptions({
    queryKey: operatorKeys.invites(workspaceId),
    queryFn: () => listWorkspaceInvites(workspaceId),
  })
}

export function operatorWorkspaceSettingsQuery(workspaceId: string) {
  return queryOptions({
    queryKey: operatorKeys.settings(workspaceId),
    queryFn: () => getOperatorWorkspaceSettings(workspaceId),
  })
}

export function storeSavedWorkspaceSettings(
  queryClient: QueryClient,
  saved: WorkspaceSettings,
  workspaceId: string | undefined,
) {
  queryClient.setQueryData(workspaceSettingsQuery.queryKey, saved)

  if (workspaceId !== undefined) {
    void queryClient.invalidateQueries({ queryKey: operatorKeys.settings(workspaceId) })
  }
}

export function storeCreatedWorkspace(queryClient: QueryClient, created: WorkspaceSummary) {
  queryClient.setQueryData<WorkspaceSummary[]>(
    operatorWorkspacesQuery.queryKey,
    (workspaces) =>
      workspaces && [...workspaces, created].sort((a, b) => compareWorkspaceNames(a.name, b.name)),
  )
  void queryClient.invalidateQueries({ queryKey: operatorWorkspacesQuery.queryKey })
}

export function storeCreatedInvite(queryClient: QueryClient, workspaceId: string, created: Invite) {
  queryClient.setQueryData<Invite[]>(
    workspaceInvitesQuery(workspaceId).queryKey,
    (invites) => invites && [created, ...invites],
  )
}

export function storeSavedOperatorWorkspaceSettings(
  queryClient: QueryClient,
  workspaceId: string,
  saved: WorkspaceSettings,
  currentWorkspaceId: string | undefined,
) {
  queryClient.setQueryData(operatorWorkspaceSettingsQuery(workspaceId).queryKey, saved)

  if (currentWorkspaceId === workspaceId) {
    void queryClient.invalidateQueries({ queryKey: workspaceSettingsQuery.queryKey })
  }
}

export function storeResetSandboxWorkspace(
  queryClient: QueryClient,
  reset: WorkspaceSummary,
  currentWorkspaceId: string | undefined,
) {
  queryClient.setQueryData<WorkspaceSummary[]>(operatorWorkspacesQuery.queryKey, (workspaces) =>
    workspaces?.map((workspace) => (workspace.id === reset.id ? reset : workspace)),
  )
  void queryClient.invalidateQueries({ queryKey: operatorKeys.invites(reset.id) })
  void queryClient.invalidateQueries({ queryKey: operatorKeys.settings(reset.id) })

  if (currentWorkspaceId === reset.id) {
    void queryClient.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] !== sessionQuery.queryKey[0] && queryKey[0] !== operatorKeys.all()[0],
    })
  }
}

export const overviewKeys = {
  all: () => ['overview'] as const,
  window: (window: OverviewWindow) => [...overviewKeys.all(), window] as const,
}

export function overviewQuery(window: OverviewWindow) {
  return queryOptions({
    queryKey: overviewKeys.window(window),
    queryFn: () => getOverview({ window }),
    placeholderData: keepPreviousData,
  })
}

export const orderLifecycleKeys = {
  all: () => ['order-lifecycles'] as const,
  search: (businessReference: string) => [...orderLifecycleKeys.all(), businessReference] as const,
}

export function orderLifecyclesQuery(businessReference: string) {
  return queryOptions({
    queryKey: orderLifecycleKeys.search(businessReference),
    queryFn: () => listOrderLifecycles({ businessReference }),
  })
}

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
  detail: (id: string) => [...mappingKeys.all(), 'detail', id] as const,
  draft: (id: string) => [...mappingKeys.detail(id), 'draft'] as const,
  graph: (id: string) => [...mappingKeys.draft(id), 'graph'] as const,
  versions: (id: string) => [...mappingKeys.detail(id), 'versions'] as const,
  version: (id: string, versionId: string) => [...mappingKeys.versions(id), versionId] as const,
  comparison: (id: string, query: MappingComparisonQuery) =>
    [...mappingKeys.detail(id), 'comparison', query] as const,
  samples: (id: string) => [...mappingKeys.detail(id), 'samples'] as const,
  preview: (id: string, sampleId: string, graph: MappingGraph) =>
    [...mappingKeys.detail(id), 'preview', sampleId, graph] as const,
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

export function mappingSamplesQuery(id: string) {
  return queryOptions({
    queryKey: mappingKeys.samples(id),
    queryFn: () => listMappingSamples(id),
  })
}

// The same graph and sample always give the same preview, so a result never goes stale. While
// the Mapping changes, the previous result stays visible as the next one loads; another Sample
// Document's result would show the wrong Document, so a sample switch loads from empty.
export function mappingPreviewQuery(id: string, sampleId: string, graph: MappingGraph) {
  return queryOptions({
    queryKey: mappingKeys.preview(id, sampleId, graph),
    queryFn: () => previewMapping(id, { sampleId, graph }),
    placeholderData: (previous) => (previous?.sampleId === sampleId ? previous : undefined),
    staleTime: Infinity,
  })
}

export const documentStructureKeys = {
  all: () => ['document-structures'] as const,
  list: () => [...documentStructureKeys.all(), 'list'] as const,
  detail: (id: string) => [...documentStructureKeys.all(), 'detail', id] as const,
}

export const documentStructuresQuery = queryOptions({
  queryKey: documentStructureKeys.list(),
  queryFn: listDocumentStructures,
})

export function documentStructureQuery(id: string) {
  return queryOptions({
    queryKey: documentStructureKeys.detail(id),
    queryFn: () => getDocumentStructure(id),
  })
}

export function storeSavedDocumentStructure(queryClient: QueryClient, saved: DocumentStructure) {
  queryClient.setQueryData(documentStructureQuery(saved.id).queryKey, saved)
  void queryClient.invalidateQueries({ queryKey: documentStructureKeys.list() })
  void queryClient.invalidateQueries({ queryKey: mappingKeys.list() })
}

export function useDocumentStructureInference() {
  return useMutation({
    mutationFn: (origin: DocumentStructureOrigin) => inferDocumentStructure(origin),
  })
}

export type DocumentStructureInference = ReturnType<typeof useDocumentStructureInference>

export const messageTypeKeys = {
  all: () => ['message-types'] as const,
  structure: (messageType: MessageType) =>
    [...messageTypeKeys.all(), 'detail', messageType, 'structure'] as const,
}

export function mappingVersionsQuery(mappingId: string) {
  return queryOptions({
    queryKey: mappingKeys.versions(mappingId),
    queryFn: () => listMappingVersions(mappingId),
  })
}

// A Mapping Version never changes, so neither does its graph nor a comparison of two of them.
export function mappingVersionQuery(mappingId: string, versionId: string) {
  return queryOptions({
    queryKey: mappingKeys.version(mappingId, versionId),
    queryFn: () => getMappingVersion(mappingId, versionId),
    staleTime: Infinity,
  })
}

export function mappingComparisonQuery(mappingId: string, query: MappingComparisonQuery) {
  return queryOptions({
    queryKey: mappingKeys.comparison(mappingId, query),
    queryFn: () => compareMappingVersions(mappingId, query),
    staleTime: Infinity,
  })
}

export function storePublishedMappingVersion(
  queryClient: QueryClient,
  published: MappingVersionSummary,
) {
  queryClient.setQueryData<MappingDraft>(
    mappingDraftQuery(published.mappingId).queryKey,
    (draft) => draft && { ...draft, latestVersion: published.version, unpublishedChanges: false },
  )
  void queryClient.invalidateQueries({ queryKey: mappingKeys.versions(published.mappingId) })
  void queryClient.invalidateQueries({ queryKey: mappingKeys.list() })
  void queryClient.invalidateQueries({ queryKey: publishedMappingVersionKeys.all() })
  void queryClient.invalidateQueries({ queryKey: flowKeys.all() })
}

export const lookupTableKeys = {
  all: () => ['lookup-tables'] as const,
  list: () => [...lookupTableKeys.all(), 'list'] as const,
  detail: (id: string) => [...lookupTableKeys.all(), 'detail', id] as const,
  import: (id: string) => [...lookupTableKeys.detail(id), 'import'] as const,
}

export const lookupTablesQuery = queryOptions({
  queryKey: lookupTableKeys.list(),
  queryFn: listLookupTables,
})

export function lookupTableQuery(id: string) {
  return queryOptions({
    queryKey: lookupTableKeys.detail(id),
    queryFn: () => getLookupTable(id),
  })
}

export function storeSavedLookupTable(queryClient: QueryClient, saved: LookupTable) {
  queryClient.setQueryData(lookupTableQuery(saved.id).queryKey, saved)
  void queryClient.invalidateQueries({ queryKey: lookupTableKeys.list() })
}

export function forgetDeletedLookupTable(queryClient: QueryClient, id: string) {
  queryClient.removeQueries({ queryKey: lookupTableKeys.detail(id) })
  void queryClient.invalidateQueries({ queryKey: lookupTableKeys.list() })
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

export const publishedMappingVersionKeys = {
  all: () => ['mapping-versions', 'published'] as const,
  list: (messageType: MessageType) => [...publishedMappingVersionKeys.all(), messageType] as const,
}

export function publishedMappingVersionsQuery(messageType: MessageType) {
  return queryOptions({
    queryKey: publishedMappingVersionKeys.list(messageType),
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
