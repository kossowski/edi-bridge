import {
  keepPreviousData,
  mutationOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { defaultLanguage, languages, remainingAiReview } from '@edi-bridge/contracts'

import type {
  AcceptAiProposedPartsBody,
  AiBudget,
  Channel,
  DocumentStructure,
  DocumentStructureOrigin,
  Flow,
  HomeWindow,
  InterchangeListQuery,
  OrderLifecycleListQuery,
  Invite,
  Language,
  LookupTable,
  LookupTableSuggestionsQuery,
  LookupTableSummary,
  MappingComparisonQuery,
  MappingDraft,
  MappingGraph,
  MappingSummary,
  MappingVersionSummary,
  MessageType,
  RunListQuery,
  Tasks,
  TradingPartner,
  WorkspaceMember,
  WorkspaceSettings,
  WorkspaceSummary,
} from '@edi-bridge/contracts'

import { compareWorkspaceNames } from '../forms/operator'
import {
  acceptAiProposedParts,
  compareMappingVersions,
  getAiBudget,
  getChannel,
  getCurrentWorkspace,
  getDocumentStructure,
  getFirstSteps,
  getFlow,
  getHome,
  getLookupTable,
  getLookupTableSuggestions,
  getLookupTableMissingCodeHints,
  getMappingDraft,
  getMappingVersion,
  getOperatorWorkspaceSettings,
  getRun,
  getSession,
  getTasks,
  getTradingPartner,
  getTradingPartnerActivity,
  getWorkspaceSettings,
  inferDocumentStructure,
  listChannels,
  listDocumentStructures,
  listLookupTableMissingCodes,
  listLookupTables,
  listFlows,
  listInterchanges,
  listMappingSamples,
  listMappings,
  listMappingVersions,
  listOperatorWorkspaceMembers,
  listOperatorWorkspaces,
  getOrderLifecyclesOf,
  listOrderLifecycles,
  listPublishedMappingVersions,
  listRuns,
  listTradingPartnerActivities,
  listTradingPartners,
  listWorkspaceInvites,
  listWorkspaceMembers,
  previewMapping,
} from './client'

import type {
  FinishedSetup,
  SetupSummary,
} from '../../components/trading-partners/partner-wizard-finish'

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: getSession,
})

export const currentWorkspaceQuery = queryOptions({
  queryKey: ['workspaces', 'current'],
  queryFn: getCurrentWorkspace,
})

export const firstStepsQuery = queryOptions({
  queryKey: [...currentWorkspaceQuery.queryKey, 'first-steps'],
  queryFn: getFirstSteps,
})

export const workspaceSettingsQuery = queryOptions({
  queryKey: ['workspaces', 'current', 'settings'],
  queryFn: getWorkspaceSettings,
})

export const workspaceMembersQuery = queryOptions({
  queryKey: ['workspaces', 'current', 'members'],
  queryFn: listWorkspaceMembers,
})

export const operatorKeys = {
  all: () => ['operator', 'workspaces'] as const,
  list: () => [...operatorKeys.all(), 'list'] as const,
  invites: (id: string) => [...operatorKeys.all(), id, 'invites'] as const,
  members: (id: string) => [...operatorKeys.all(), id, 'members'] as const,
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

export function operatorWorkspaceMembersQuery(workspaceId: string) {
  return queryOptions({
    queryKey: operatorKeys.members(workspaceId),
    queryFn: () => listOperatorWorkspaceMembers(workspaceId),
  })
}

export function operatorWorkspaceSettingsQuery(workspaceId: string) {
  return queryOptions({
    queryKey: operatorKeys.settings(workspaceId),
    queryFn: () => getOperatorWorkspaceSettings(workspaceId),
  })
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
  void queryClient.invalidateQueries({ queryKey: operatorWorkspacesQuery.queryKey })
}

export function storeRevokedInvite(queryClient: QueryClient, revoked: Invite) {
  queryClient.setQueryData<Invite[]>(
    workspaceInvitesQuery(revoked.workspaceId).queryKey,
    (invites) => invites?.filter((invite) => invite.id !== revoked.id),
  )
  void queryClient.invalidateQueries({ queryKey: operatorWorkspacesQuery.queryKey })
}

export function storeRemovedMember(queryClient: QueryClient, workspaceId: string, userId: string) {
  queryClient.setQueryData<WorkspaceMember[]>(
    operatorWorkspaceMembersQuery(workspaceId).queryKey,
    (members) => members?.filter((member) => member.id !== userId),
  )
  void queryClient.invalidateQueries({ queryKey: operatorWorkspacesQuery.queryKey })
  void queryClient.invalidateQueries({ queryKey: workspaceMembersQuery.queryKey })
}

export function refreshOperatorWorkspaceMembers(queryClient: QueryClient, workspaceId: string) {
  void queryClient.invalidateQueries({
    queryKey: operatorWorkspaceMembersQuery(workspaceId).queryKey,
  })
  void queryClient.invalidateQueries({ queryKey: operatorWorkspacesQuery.queryKey })
  void queryClient.invalidateQueries({ queryKey: workspaceMembersQuery.queryKey })
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

export const homeKeys = {
  all: () => ['home'] as const,
  window: (window: HomeWindow) => [...homeKeys.all(), window] as const,
}

export function homeQuery(window: HomeWindow) {
  return queryOptions({
    queryKey: homeKeys.window(window),
    queryFn: () => getHome({ window }),
    placeholderData: keepPreviousData,
  })
}

export const taskKeys = {
  all: () => ['tasks'] as const,
}

export function newestTasksFirst(data: Tasks): Tasks {
  return {
    ...data,
    tasks: data.tasks.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at)),
  }
}

export const tasksQuery = queryOptions({
  queryKey: taskKeys.all(),
  queryFn: getTasks,
  select: newestTasksFirst,
})

export const orderLifecycleKeys = {
  all: () => ['order-lifecycles'] as const,
  list: (query: OrderLifecycleListQuery) => [...orderLifecycleKeys.all(), 'list', query] as const,
  detail: (businessReference: string) =>
    [...orderLifecycleKeys.all(), 'detail', businessReference] as const,
}

export function orderLifecycleListQuery(query: OrderLifecycleListQuery) {
  return queryOptions({
    queryKey: orderLifecycleKeys.list(query),
    queryFn: () => listOrderLifecycles(query),
    placeholderData: keepPreviousData,
  })
}

export function orderLifecycleDetailQuery(businessReference: string) {
  return queryOptions({
    queryKey: orderLifecycleKeys.detail(businessReference),
    queryFn: () => getOrderLifecyclesOf(businessReference),
  })
}

export const runKeys = {
  lists: () => ['runs', 'list'] as const,
  list: (query: RunListQuery) => [...runKeys.lists(), query] as const,
  detail: (id: string) => ['runs', 'detail', id] as const,
}

export const interchangeKeys = {
  all: () => ['interchanges'] as const,
  list: (query: InterchangeListQuery) => [...interchangeKeys.all(), 'list', query] as const,
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

export function interchangesQuery(query: InterchangeListQuery) {
  return queryOptions({
    queryKey: interchangeKeys.list(query),
    queryFn: () => listInterchanges(query),
    placeholderData: keepPreviousData,
  })
}

export const mappingKeys = {
  all: () => ['mappings'] as const,
  list: () => [...mappingKeys.all(), 'list'] as const,
  detail: (id: string) => [...mappingKeys.all(), 'detail', id] as const,
  draft: (id: string) => [...mappingKeys.detail(id), 'draft'] as const,
  graph: (id: string) => [...mappingKeys.draft(id), 'graph'] as const,
  acceptParts: (id: string) => [...mappingKeys.draft(id), 'acceptParts'] as const,
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

export function storeCreatedMapping(queryClient: QueryClient, created: MappingSummary) {
  queryClient.setQueryData<MappingSummary[]>(
    mappingsQuery.queryKey,
    (mappings) =>
      mappings && [...mappings, created].sort((a, b) => a.name.localeCompare(b.name, 'de')),
  )
  void queryClient.invalidateQueries({ queryKey: mappingsQuery.queryKey })
}

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

export const aiKeys = {
  all: () => ['ai'] as const,
  budget: () => [...aiKeys.all(), 'budget'] as const,
}

export const aiBudgetQuery = queryOptions({
  queryKey: aiKeys.budget(),
  queryFn: getAiBudget,
})

export function storeAiBudget(queryClient: QueryClient, budget: AiBudget) {
  queryClient.setQueryData(aiBudgetQuery.queryKey, budget)
}

export function storeAcceptedAiDraft(queryClient: QueryClient, draft: MappingDraft) {
  queryClient.setQueryData(mappingDraftQuery(draft.mappingId).queryKey, draft)
}

// Graph saves and accepts of one Mapping run one after another, and only the last of them writes
// the whole answer into the cache, so no answer drops a change made after it.
export function graphChangeScope(mappingId: string) {
  return { id: mappingKeys.graph(mappingId).join('/') }
}

export function isLastGraphChange(queryClient: QueryClient, mappingId: string) {
  const { id } = graphChangeScope(mappingId)

  return queryClient.isMutating({ predicate: ({ options }) => options.scope?.id === id }) === 1
}

export function acceptAiProposedPartsMutation(queryClient: QueryClient, mappingId: string) {
  const { queryKey } = mappingDraftQuery(mappingId)

  return mutationOptions({
    mutationKey: mappingKeys.acceptParts(mappingId),
    scope: graphChangeScope(mappingId),
    mutationFn: (parts: AcceptAiProposedPartsBody) => acceptAiProposedParts(mappingId, parts),
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: (saved: MappingDraft) => {
      if (isLastGraphChange(queryClient, mappingId)) {
        storeAcceptedAiDraft(queryClient, saved)

        return
      }

      // A save waiting behind the accept already shows its change, so only the review is taken.
      queryClient.setQueryData<MappingDraft>(
        queryKey,
        (draft) =>
          draft && {
            ...draft,
            aiReview: saved.aiReview && remainingAiReview(saved.aiReview, saved, draft),
          },
      )
    },
    onError: () => {
      if (isLastGraphChange(queryClient, mappingId)) {
        void queryClient.invalidateQueries({ queryKey })
      }
    },
  })
}

export function useAcceptAiProposedParts(mappingId: string) {
  const queryClient = useQueryClient()

  return useMutation(acceptAiProposedPartsMutation(queryClient, mappingId))
}

export function storeReplacedDraft(queryClient: QueryClient, draft: MappingDraft) {
  const { queryKey } = mappingDraftQuery(draft.mappingId)

  void queryClient.cancelQueries({ queryKey })
  queryClient.setQueryData(queryKey, draft)
  void queryClient.invalidateQueries({ queryKey: mappingKeys.list() })
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
  details: (id: string) => [...lookupTableKeys.all(), 'detail', id] as const,
  detail: (id: string, language: Language) => [...lookupTableKeys.details(id), language] as const,
  import: (id: string) => [...lookupTableKeys.details(id), 'import'] as const,
  allMissingCodes: (id: string) => [...lookupTableKeys.all(), 'missing-codes', id] as const,
  missingCodes: (id: string, language: Language) =>
    [...lookupTableKeys.allMissingCodes(id), language] as const,
  allMissingCodeHints: (id: string) =>
    [...lookupTableKeys.all(), 'missing-code-hints', id] as const,
  missingCodeHints: (id: string, language: Language) =>
    [...lookupTableKeys.allMissingCodeHints(id), language] as const,
  suggestions: (query: LookupTableSuggestionsQuery) =>
    [...lookupTableKeys.all(), 'suggestions', query] as const,
}

export const lookupTablesQuery = queryOptions({
  queryKey: lookupTableKeys.list(),
  queryFn: listLookupTables,
})

export function lookupTableQuery(id: string, language: Language) {
  return queryOptions({
    queryKey: lookupTableKeys.detail(id, language),
    queryFn: () => getLookupTable(id, language),
  })
}

export function lookupTableMissingCodesQuery(id: string, language: Language) {
  return queryOptions({
    queryKey: lookupTableKeys.missingCodes(id, language),
    queryFn: () => listLookupTableMissingCodes(id, language),
  })
}

// Each fetch spends AI budget, so an AI read is fetched once and never again on its own.
const fetchedOnce = {
  staleTime: Infinity,
  gcTime: Infinity,
  retry: false,
  retryOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const

export function lookupTableSuggestionsQuery(query: LookupTableSuggestionsQuery) {
  return queryOptions({
    queryKey: lookupTableKeys.suggestions(query),
    queryFn: () => getLookupTableSuggestions(query),
    ...fetchedOnce,
  })
}

// Kept apart from the missing codes, so a save that marks them stale does not ask the AI again.
export function lookupTableMissingCodeHintsQuery(id: string, language: Language, wanted: boolean) {
  return queryOptions({
    queryKey: lookupTableKeys.missingCodeHints(id, language),
    queryFn: () => getLookupTableMissingCodeHints(id, language),
    ...fetchedOnce,
    // Once answered or failed, a screen that wants the hints anew keeps the first result.
    enabled: ({ state }) => wanted && state.dataUpdateCount + state.errorUpdateCount === 0,
  })
}

// A save answers with code meanings in the default language; other languages read theirs again.
export function storeSavedLookupTable(queryClient: QueryClient, saved: LookupTable) {
  queryClient.setQueryData(lookupTableQuery(saved.id, defaultLanguage).queryKey, saved)

  for (const language of languages.filter((other) => other !== defaultLanguage)) {
    const { queryKey } = lookupTableQuery(saved.id, language)

    queryClient.setQueryData(
      queryKey,
      (cached) => cached && { ...saved, codeMeanings: cached.codeMeanings },
    )
    void queryClient.invalidateQueries({ queryKey, exact: true })
  }

  void queryClient.invalidateQueries({ queryKey: lookupTableKeys.list() })
  void queryClient.invalidateQueries({ queryKey: lookupTableKeys.allMissingCodes(saved.id) })
}

export function forgetDeletedLookupTable(queryClient: QueryClient, id: string) {
  queryClient.removeQueries({ queryKey: lookupTableKeys.details(id) })
  queryClient.removeQueries({ queryKey: lookupTableKeys.allMissingCodes(id) })
  queryClient.removeQueries({ queryKey: lookupTableKeys.allMissingCodeHints(id) })
  queryClient.setQueryData<LookupTableSummary[]>(lookupTablesQuery.queryKey, (tables) =>
    tables?.filter((table) => table.id !== id),
  )
  void queryClient.invalidateQueries({ queryKey: lookupTableKeys.list() })
}

export const tradingPartnerKeys = {
  all: () => ['trading-partners'] as const,
  list: () => [...tradingPartnerKeys.all(), 'list'] as const,
  detail: (id: string) => [...tradingPartnerKeys.all(), 'detail', id] as const,
  activities: () => [...tradingPartnerKeys.all(), 'activities'] as const,
  activity: (id: string) => [...tradingPartnerKeys.detail(id), 'activity'] as const,
  testInterchange: (id: string) => [...tradingPartnerKeys.detail(id), 'test-interchange'] as const,
}

export const tradingPartnersQuery = queryOptions({
  queryKey: tradingPartnerKeys.list(),
  queryFn: listTradingPartners,
})

export const tradingPartnerActivitiesQuery = queryOptions({
  queryKey: tradingPartnerKeys.activities(),
  queryFn: listTradingPartnerActivities,
})

export function tradingPartnerQuery(id: string) {
  return queryOptions({
    queryKey: tradingPartnerKeys.detail(id),
    queryFn: () => getTradingPartner(id),
  })
}

export function tradingPartnerActivityQuery(id: string) {
  return queryOptions({
    queryKey: tradingPartnerKeys.activity(id),
    queryFn: () => getTradingPartnerActivity(id),
  })
}

export function storeSavedTradingPartner(queryClient: QueryClient, saved: TradingPartner) {
  queryClient.setQueryData(tradingPartnerQuery(saved.id).queryKey, saved)
  void queryClient.invalidateQueries({ queryKey: tradingPartnerKeys.list() })
  void queryClient.invalidateQueries({ queryKey: tradingPartnerKeys.activities() })
}

export const setupSummaryKeys = {
  all: () => ['setup-summaries'] as const,
  detail: (tradingPartnerId: string) => [...setupSummaryKeys.all(), tradingPartnerId] as const,
}

export function storeSetupSummary(
  queryClient: QueryClient,
  tradingPartnerId: string,
  summary: SetupSummary,
) {
  queryClient.setQueryData(setupSummaryKeys.detail(tradingPartnerId), summary)
}

export function useTakenSetupSummary(tradingPartnerId: string) {
  const queryClient = useQueryClient()

  const [summary, setSummary] = useState(
    () => queryClient.getQueryData<SetupSummary>(setupSummaryKeys.detail(tradingPartnerId)) ?? null,
  )

  useEffect(() => {
    queryClient.removeQueries({ queryKey: setupSummaryKeys.detail(tradingPartnerId), exact: true })
  }, [queryClient, tradingPartnerId])

  return [summary, () => setSummary(null)] as const
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

export function storeFinishedSetup(
  queryClient: QueryClient,
  { tradingPartner, channels, mappings, flows }: FinishedSetup,
) {
  storeSavedTradingPartner(queryClient, tradingPartner)

  for (const created of Object.values(channels)) {
    storeSavedChannel(queryClient, created.channel)
  }

  for (const mapping of Object.values(mappings)) {
    storeCreatedMapping(queryClient, mapping)
  }

  for (const flow of Object.values(flows)) {
    storeSavedFlow(queryClient, flow)
  }
}
