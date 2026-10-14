import type {
  ChannelTestFailureReason,
  DocumentStructure,
  Invite,
  Session,
  TradingPartner,
  Workspace,
  WorkspaceSettings,
} from '@edi-bridge/contracts'

import { aiDraftHandlers, type AiDraftOptions } from './ai-draft'
import {
  channelHandlers,
  type ChannelRecord,
  createChannelStore,
  seedChannels,
  seedConnectionFailures,
} from './channel'
import {
  documentStructureHandlers,
  type DocumentStructuresState,
  type DocumentStructureStore,
  seedDocumentStructures,
  seedUnusedDocumentStructures,
  toDocumentStructureStore,
} from './document-structure'
import { firstStepsHandler } from './first-steps'
import { createFlowStore, flowHandlers } from './flow'
import { homeHandler } from './home'
import { interchangesHandler } from './interchange-list'
import { liveEventsHandler, type LiveEventsOptions } from './live-event'
import {
  createLookupTableStore,
  lookupTableHandlers,
  type LookupTableRecord,
  seedLookupTables,
} from './lookup-table'
import { manualSubmissionHandler } from './manual-submission'
import {
  type MappingDraftRecord,
  mappingHandlers,
  type MappingDraftStore,
  seedMappingDrafts,
  toMappingDraftStore,
} from './mapping'
import { mappingPreviewHandlers } from './mapping-preview'
import { type MappingSampleRecord, seedMappingSamples } from './mapping-sample'
import {
  createMappingVersions,
  mappingVersionHandlers,
  type MappingVersionRecord,
  type MappingVersionStore,
  publishedMappingVersionsHandler,
  seedMappingVersions,
  toMappingVersionStore,
} from './mapping-version'
import { messageTypeStructureHandler } from './message-type-structure'
import {
  createOperatorStore,
  newWorkspaceSummary,
  operatorHandlers,
  seedInvites,
  seedWorkspaceSummaries,
  sessionWorkspaceStore,
  type WorkspaceSummaryRecord,
} from './operator'
import {
  orderLifecycleHandler,
  orderLifecycleListHandler,
  seedOrderLifecycles,
} from './order-lifecycle'
import { seedOverdueAcknowledgements } from './overdue-acknowledgement'
import { runsHandler, seedRuns } from './run'
import { runDetailHandlers, seedReprocessed } from './run-detail'
import { createRunStore } from './run-store'
import { createSessionStore, seedSession, sessionHandlers } from './session'
import { tasksHandler } from './task'
import {
  createTradingPartnerStore,
  seedTradingPartners,
  type TestInterchangeOptions,
  tradingPartnerHandlers,
} from './trading-partner'
import { tradingPartnerActivityHandlers } from './trading-partner-activity'
import { seedWorkspace, workspaceHandlers } from './workspace'
import { seedWorkspaceActivity } from './workspace-activity'
import {
  seedWorkspaceMembers,
  workspaceMemberHandlers,
  type WorkspaceMembers,
} from './workspace-member'
import {
  createWorkspaceSettingsStore,
  seedWorkspaceSettings,
  workspaceSettingsHandlers,
} from './workspace-settings'

export {
  aiDraftHandlers,
  type AiDraftOptions,
  type AiDraftState,
  aiDraftTokens,
  aiProposalFor,
  type AiProposalSize,
  withAiProposal,
} from './ai-draft'

export {
  channelHandlers,
  type ChannelRecord,
  type ChannelStore,
  createChannel,
  createChannels,
  createChannelStore,
  randomWebhookToken,
  seedChannels,
  seedConnectionFailures,
  toChannel,
} from './channel'

export {
  firstStepsHandler,
  type FirstStepsState,
  type FirstStepsWorld,
  freshFirstSteps,
  partlyDoneFirstSteps,
} from './first-steps'

export {
  createFlows,
  createFlowStore,
  createMappingCatalogue,
  flowHandlers,
  type FlowRecord,
  type FlowStore,
  type MappingCatalogue,
  type MappingRecord,
  seedFlows,
  seedMappings,
  toFlow,
  toFlowStore,
} from './flow'

export {
  createDocumentStructure,
  createDocumentStructures,
  createDocumentStructureStore,
  documentStructureHandlers,
  type DocumentStructuresState,
  type DocumentStructureStore,
  seedDocumentStructureOf,
  seedDocumentStructures,
  seedUnusedDocumentStructures,
  toDocumentStructureStore,
} from './document-structure'

export { createCsvDocument, documentStructureOrigins } from './document-structure-origin'

export { dayMs } from './duration'

export { liveEventsHandler, type LiveEventsMode, type LiveEventsOptions } from './live-event'

export {
  type BlockingCode,
  createLookupTables,
  createLookupTableStore,
  lookupTableHandlers,
  type LookupTableRecord,
  lookupTableListHandler,
  type LookupTablesState,
  type LookupTableStore,
  type LookupTableUsage,
  type LookupTableWorld,
  partnerScope,
  seedLookupTableNamed,
  seedLookupTables,
  toLookupTable,
  toLookupTableSummary,
  type UpcomingCode,
} from './lookup-table'

export { manualSubmissionHandler } from './manual-submission'

export {
  createMappingDrafts,
  createMappingDraftStore,
  createMappingsWithTraffic,
  incompleteDraftId,
  mappingHandlers,
  type MappingDraftRecord,
  type MappingDraftStore,
  type MappingsState,
  publishedVersionsOf,
  seedMappingDrafts,
  toMappingDraft,
  toMappingDraftStore,
  toMappingSummary,
} from './mapping'

export { mappingPreviewHandlers } from './mapping-preview'

export {
  createMappingSample,
  type MappingSampleRecord,
  seedMappingSamples,
  toMappingSample,
} from './mapping-sample'

export {
  edifactLeaves,
  messageTypeStructureHandler,
  messageTypeStructures,
} from './message-type-structure'

export {
  createMappingVersions,
  createMappingVersionStore,
  deriveMappingVersions,
  mappingDifferences,
  mappingVersionHandlers,
  type MappingVersionRecord,
  type MappingVersionStore,
  type MappingVersionsState,
  publishedMappingVersionsHandler,
  seedMappingVersions,
  toMappingVersion,
  toMappingVersionStore,
  toMappingVersionSummary,
} from './mapping-version'

export {
  createInvites,
  createOperatorStore,
  createWorkspaceSummaries,
  operatorHandlers,
  type OperatorStore,
  seedInvites,
  seedWorkspaceSummaries,
  sessionWorkspaceStore,
  toOperatorStore,
  type WorkspaceSummaryRecord,
} from './operator'

export {
  createLargeVolumeOrderLifecycles,
  orderLifecycleHandler,
  orderLifecycleListHandler,
  type OrderLifecycleListState,
  orderLifecycleReferences,
  type OrderLifecycleSeed,
  type OrderLifecycleState,
  seedOrderLifecycles,
} from './order-lifecycle'

export { homeHandler, toHome } from './home'

export {
  createOverdueAcknowledgement,
  seedOverdueAcknowledgements,
} from './overdue-acknowledgement'

export { createRun, createRuns, type RunFields, runsHandler, seedRuns, toRunSummary } from './run'

export { serializeSegment } from './interchange'

export { interchangesHandler } from './interchange-list'

export { runDetailHandlers, type RunDetailOptions, seedReprocessed } from './run-detail'

export {
  createTradingPartner,
  createTradingPartners,
  createTradingPartnerStore,
  seedTradingPartners,
  type TestInterchangeOptions,
  tradingPartnerHandlers,
  type TradingPartnerStore,
} from './trading-partner'

export {
  type TradingPartnerActivityData,
  tradingPartnerActivityHandlers,
  toTradingPartnerActivities,
  toTradingPartnerActivityDetail,
} from './trading-partner-activity'

export {
  createWorkspace,
  createWorkspaceStore,
  currentWorkspaceHandler,
  seedSandboxWorkspace,
  seedShowcaseWorkspace,
  seedWorkspace,
  workspaceHandlers,
  type WorkspaceStore,
} from './workspace'

export {
  controlReferenceOf,
  createRunStore,
  interchangeIdOf,
  type Reprocessed,
  type RunStore,
} from './run-store'

export { tasksHandler } from './task'

export {
  createWorkspaceActivity,
  emptyWorkspaceActivity,
  seedWorkspaceActivity,
  type WorkspaceActivity,
  type WorkspaceActivityState,
} from './workspace-activity'

export { type SessionStore } from './session-access'

export {
  createSessionStore,
  mockCredentials,
  seedSession,
  sessionHandlers,
  sandboxAdminSession,
  showcaseViewerSession,
  toSessionStore,
} from './session'

export {
  createWorkspaceMember,
  createWorkspaceMembers,
  seedWorkspaceMembers,
  toWorkspaceMemberStore,
  workspaceMemberHandlers,
  type WorkspaceMembers,
  type WorkspaceMemberStore,
} from './workspace-member'

export {
  createWorkspaceSettings,
  createWorkspaceSettingsStore,
  seedWorkspaceSettings,
  toWorkspaceSettingsStore,
  workspaceSettingsHandlers,
  type WorkspaceSettingsStore,
} from './workspace-settings'

export function createHandlers(
  apiUrl: string,
  {
    session,
    workspace,
    workspaceSettings = seedWorkspaceSettings,
    workspaceMembers = seedWorkspaceMembers,
    operatorWorkspaces = seedWorkspaceSummaries,
    invites = seedInvites,
    tradingPartners = seedTradingPartners,
    channels = seedChannels,
    connectionFailures = seedConnectionFailures,
    testInterchange = {},
    mappingDrafts = seedMappingDrafts,
    documentStructures = [...seedDocumentStructures, ...seedUnusedDocumentStructures],
    documentStructuresState,
    documentStructureInferenceState,
    lookupTables = seedLookupTables,
    mappingSamples = seedMappingSamples,
    mappingVersions,
    liveEvents = { mode: 'quiet' },
    aiDraft = {},
  }: {
    session?: Session | null
    workspace?: Workspace
    workspaceSettings?: WorkspaceSettings
    workspaceMembers?: WorkspaceMembers
    operatorWorkspaces?: ReadonlyArray<WorkspaceSummaryRecord>
    invites?: ReadonlyArray<Invite>
    tradingPartners?: ReadonlyArray<TradingPartner>
    channels?: ReadonlyArray<ChannelRecord>
    connectionFailures?: ReadonlyMap<string, ChannelTestFailureReason>
    testInterchange?: TestInterchangeOptions
    mappingDrafts?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
    documentStructures?: ReadonlyArray<DocumentStructure> | DocumentStructureStore
    documentStructuresState?: DocumentStructuresState
    documentStructureInferenceState?: DocumentStructuresState
    lookupTables?: ReadonlyArray<LookupTableRecord>
    mappingSamples?: ReadonlyArray<MappingSampleRecord>
    mappingVersions?: ReadonlyArray<MappingVersionRecord> | MappingVersionStore
    liveEvents?: Omit<LiveEventsOptions, 'runs'>
    aiDraft?: Pick<AiDraftOptions, 'state' | 'stepDelayMs' | 'signal'>
  } = {},
) {
  const orderLifecycles = seedOrderLifecycles()

  const runs = createRunStore(
    [...seedRuns(), ...orderLifecycles.runs],
    [...seedReprocessed(), ...orderLifecycles.reprocessed],
  )

  const ownWorkspace = workspace ?? seedWorkspace
  const operatorStore = createOperatorStore({ workspaces: operatorWorkspaces, invites })

  if (workspace && !operatorStore.workspace(workspace.id)) {
    operatorStore.setWorkspace(newWorkspaceSummary(workspace, { memberCount: 1, seeded: false }))
  }

  const sessionStore = createSessionStore(
    session === undefined
      ? {
          ...seedSession,
          workspace: { id: ownWorkspace.id, name: ownWorkspace.name, kind: 'standard' },
        }
      : session,
  )

  const workspaceStore = sessionWorkspaceStore({
    workspaces: operatorStore,
    session: sessionStore,
    fallback: ownWorkspace,
  })

  const tradingPartnerStore = createTradingPartnerStore(tradingPartners)
  const workspaceSettingsStore = createWorkspaceSettingsStore(workspaceSettings)
  const channelStore = createChannelStore(channels)
  const flows = createFlowStore()
  const mappingDraftStore = toMappingDraftStore(mappingDrafts)
  const documentStructureStore = toDocumentStructureStore(documentStructures)
  const lookupTableStore = createLookupTableStore(lookupTables)

  const mappingVersionStore = toMappingVersionStore(
    mappingVersions ?? [...seedMappingVersions, ...createMappingVersions(mappingDraftStore.all())],
  )

  return [
    ...sessionHandlers(apiUrl, sessionStore),
    ...workspaceHandlers(apiUrl, workspaceStore, sessionStore),
    firstStepsHandler(
      apiUrl,
      {
        workspace: workspaceStore,
        channels: channelStore,
        tradingPartners: tradingPartnerStore,
        mappingVersions: mappingVersionStore,
      },
      sessionStore,
    ),
    ...workspaceSettingsHandlers(apiUrl, {
      settings: workspaceSettingsStore,
      session: sessionStore,
      workspaces: operatorStore,
    }),
    ...workspaceMemberHandlers(apiUrl, { members: workspaceMembers, session: sessionStore }),
    ...operatorHandlers(apiUrl, {
      workspaces: operatorStore,
      members: workspaceMembers,
      session: sessionStore,
    }),
    ...tradingPartnerHandlers(apiUrl, {
      tradingPartners: tradingPartnerStore,
      workspace: workspaceStore,
      testInterchange,
    }),
    ...tradingPartnerActivityHandlers(apiUrl, {
      tradingPartners: tradingPartnerStore,
      runs,
      get overdueAcknowledgements() {
        return seedOverdueAcknowledgements(runs.all(), tradingPartnerStore.all())
      },
      flows,
      channels: channelStore,
    }),
    ...channelHandlers(apiUrl, { channels: channelStore, connectionFailures }),
    ...flowHandlers(apiUrl, { flows, channels: channelStore, mappings: mappingVersionStore }),
    publishedMappingVersionsHandler(apiUrl, mappingVersionStore),
    runsHandler(apiUrl, runs, { flows, mappings: mappingVersionStore }),
    interchangesHandler(apiUrl, runs),
    liveEventsHandler(apiUrl, { ...liveEvents, runs }),
    homeHandler(apiUrl, seedWorkspaceActivity(runs)),
    tasksHandler(apiUrl, seedWorkspaceActivity(runs)),
    orderLifecycleListHandler(apiUrl, orderLifecycles.orderLifecycles, {
      runs,
      tradingPartners: tradingPartnerStore,
      waitingForTradingPartnerSince: orderLifecycles.waitingForTradingPartnerSince,
    }),
    orderLifecycleHandler(apiUrl, orderLifecycles.orderLifecycles, {
      runs,
      tradingPartners: tradingPartnerStore,
      waitingForTradingPartnerSince: orderLifecycles.waitingForTradingPartnerSince,
    }),
    ...mappingVersionHandlers(apiUrl, {
      mappings: mappingDraftStore,
      versions: mappingVersionStore,
      flows,
      tradingPartners: tradingPartnerStore,
      session: sessionStore,
      samples: mappingSamples,
      documentStructures: documentStructureStore,
      lookupTables: lookupTableStore,
    }),
    ...runDetailHandlers(apiUrl, {
      runs,
      waitingForTradingPartnerSince: orderLifecycles.waitingForTradingPartnerSince,
      mappingVersions: mappingVersionStore,
      flows,
      channels: channelStore,
      lookupTables: lookupTableStore,
    }),
    manualSubmissionHandler(apiUrl, { channels: channelStore, flows, runs, tradingPartners }),
    ...mappingHandlers(apiUrl, {
      mappings: mappingDraftStore,
      documentStructures: documentStructureStore,
      flows,
      runs,
      tradingPartners: tradingPartnerStore,
      versions: mappingVersionStore,
    }),
    ...aiDraftHandlers(apiUrl, {
      ...aiDraft,
      mappings: mappingDraftStore,
      samples: mappingSamples,
      documentStructures: documentStructureStore,
      session: sessionStore,
      settings: workspaceSettingsStore,
    }),
    ...mappingPreviewHandlers(apiUrl, {
      mappings: mappingDraftStore,
      samples: mappingSamples,
      documentStructures: documentStructureStore,
      lookupTables: lookupTableStore,
    }),
    ...documentStructureHandlers(apiUrl, {
      documentStructures: documentStructureStore,
      mappings: mappingDraftStore,
      versions: mappingVersionStore,
      state: documentStructuresState,
      inferenceState: documentStructureInferenceState,
    }),
    messageTypeStructureHandler(apiUrl),
    ...lookupTableHandlers(apiUrl, {
      lookupTables: lookupTableStore,
      tradingPartners: tradingPartnerStore,
      mappings: mappingDraftStore,
      flows,
      channels: channelStore,
      runs,
    }),
  ]
}
