import type {
  DocumentStructure,
  Invite,
  Session,
  TradingPartner,
  Workspace,
  WorkspaceSettings,
  WorkspaceSummary,
} from '@edi-bridge/contracts'

import { channelHandlers, type ChannelRecord, createChannelStore, seedChannels } from './channel'
import {
  documentStructureHandlers,
  type DocumentStructureStore,
  seedDocumentStructures,
  seedUnusedDocumentStructures,
  toDocumentStructureStore,
} from './document-structure'
import { createFlowStore, flowHandlers } from './flow'
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
  operatorHandlers,
  seedInvites,
  seedWorkspaceSummaries,
} from './operator'
import { orderLifecycleHandler, seedOrderLifecycles } from './order-lifecycle'
import { overviewHandler, seedOverviewData } from './overview'
import { runsHandler, seedRuns } from './run'
import { runDetailHandlers, seedReprocessed } from './run-detail'
import { createRunStore } from './run-store'
import { createSessionStore, seedSession, sessionHandlers } from './session'
import {
  createTradingPartnerStore,
  seedTradingPartners,
  tradingPartnerHandlers,
} from './trading-partner'
import { createWorkspaceStore, seedWorkspace, workspaceHandlers } from './workspace'
import {
  createWorkspaceSettingsStore,
  seedWorkspaceSettings,
  workspaceSettingsHandlers,
} from './workspace-settings'

export {
  channelHandlers,
  type ChannelRecord,
  type ChannelStore,
  createChannel,
  createChannels,
  createChannelStore,
  randomWebhookToken,
  seedChannels,
  toChannel,
} from './channel'

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
  documentStructureLeaves,
  type DocumentStructureStore,
  seedDocumentStructureOf,
  seedDocumentStructures,
  seedUnusedDocumentStructures,
  toDocumentStructureStore,
} from './document-structure'

export { createCsvDocument, documentStructureOrigins } from './document-structure-origin'

export { liveEventsHandler, type LiveEventsMode, type LiveEventsOptions } from './live-event'

export {
  createLookupTables,
  createLookupTableStore,
  lookupTableHandlers,
  type LookupTableRecord,
  lookupTableListHandler,
  type LookupTableStore,
  seedLookupTableNamed,
  seedLookupTables,
  toLookupTable,
  toLookupTableSummary,
} from './lookup-table'

export { manualSubmissionHandler } from './manual-submission'

export {
  createMappingDrafts,
  createMappingDraftStore,
  incompleteDraftId,
  mappingHandlers,
  type MappingDraftRecord,
  type MappingDraftStore,
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
  toOperatorStore,
} from './operator'

export {
  orderLifecycleHandler,
  orderLifecycleReferences,
  type OrderLifecycleSeed,
  type OrderLifecycleState,
  seedOrderLifecycles,
} from './order-lifecycle'

export {
  createOverdueAcknowledgement,
  createOverviewData,
  emptyOverviewData,
  type OverviewData,
  overviewHandler,
  type OverviewState,
  seedOverdueAcknowledgements,
  seedOverviewData,
  toOverview,
} from './overview'

export { createRun, createRuns, runsHandler, seedRuns } from './run'

export {
  interchangeIdOf,
  runDetailHandlers,
  type RunDetailOptions,
  seedReprocessed,
} from './run-detail'

export {
  createTradingPartner,
  createTradingPartners,
  createTradingPartnerStore,
  seedTradingPartners,
  tradingPartnerHandlers,
  type TradingPartnerStore,
} from './trading-partner'

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

export { createRunStore, type RunStore } from './run-store'

export {
  createSessionStore,
  mockCredentials,
  seedSession,
  sessionHandlers,
  type SessionStore,
  sandboxAdminSession,
  showcaseViewerSession,
  toSessionStore,
} from './session'

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
    session = seedSession,
    workspace = seedWorkspace,
    workspaceSettings = seedWorkspaceSettings,
    operatorWorkspaces = seedWorkspaceSummaries,
    invites = seedInvites,
    tradingPartners = seedTradingPartners,
    channels = seedChannels,
    mappingDrafts = seedMappingDrafts,
    documentStructures = [...seedDocumentStructures, ...seedUnusedDocumentStructures],
    lookupTables = seedLookupTables,
    mappingSamples = seedMappingSamples,
    mappingVersions,
    liveEvents = { mode: 'quiet' },
  }: {
    session?: Session | null
    workspace?: Workspace
    workspaceSettings?: WorkspaceSettings
    operatorWorkspaces?: ReadonlyArray<WorkspaceSummary>
    invites?: ReadonlyArray<Invite>
    tradingPartners?: ReadonlyArray<TradingPartner>
    channels?: ReadonlyArray<ChannelRecord>
    mappingDrafts?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
    documentStructures?: ReadonlyArray<DocumentStructure> | DocumentStructureStore
    lookupTables?: ReadonlyArray<LookupTableRecord>
    mappingSamples?: ReadonlyArray<MappingSampleRecord>
    mappingVersions?: ReadonlyArray<MappingVersionRecord> | MappingVersionStore
    liveEvents?: Omit<LiveEventsOptions, 'runs'>
  } = {},
) {
  const orderLifecycles = seedOrderLifecycles()
  const runs = createRunStore([...seedRuns(), ...orderLifecycles.runs])
  const sessionStore = createSessionStore(session)
  const tradingPartnerStore = createTradingPartnerStore(tradingPartners)
  const workspaceStore = createWorkspaceStore(workspace)
  const workspaceSettingsStore = createWorkspaceSettingsStore(workspaceSettings)
  const operatorStore = createOperatorStore({ workspaces: operatorWorkspaces, invites })
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
    ...workspaceHandlers(apiUrl, workspaceStore),
    ...workspaceSettingsHandlers(apiUrl, {
      settings: workspaceSettingsStore,
      session: sessionStore,
      workspaces: operatorStore,
    }),
    ...operatorHandlers(apiUrl, { workspaces: operatorStore, session: sessionStore }),
    ...tradingPartnerHandlers(apiUrl, {
      tradingPartners: tradingPartnerStore,
      workspace: workspaceStore,
    }),
    ...channelHandlers(apiUrl, { channels: channelStore }),
    ...flowHandlers(apiUrl, { flows, channels: channelStore, mappings: mappingVersionStore }),
    publishedMappingVersionsHandler(apiUrl, mappingVersionStore),
    runsHandler(apiUrl, runs),
    liveEventsHandler(apiUrl, { ...liveEvents, runs }),
    overviewHandler(apiUrl, seedOverviewData(runs)),
    orderLifecycleHandler(apiUrl, orderLifecycles.orderLifecycles),
    ...mappingVersionHandlers(apiUrl, {
      mappings: mappingDraftStore,
      versions: mappingVersionStore,
      samples: mappingSamples,
      documentStructures: documentStructureStore,
      lookupTables: lookupTableStore,
    }),
    ...runDetailHandlers(apiUrl, {
      runs,
      reprocessed: [...seedReprocessed(), ...orderLifecycles.reprocessed],
      businessReferences: orderLifecycles.businessReferences,
      mappingVersions: mappingVersionStore,
    }),
    manualSubmissionHandler(apiUrl, { channels: channelStore, flows, runs, tradingPartners }),
    ...mappingHandlers(apiUrl, {
      mappings: mappingDraftStore,
      documentStructures: documentStructureStore,
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
    }),
    messageTypeStructureHandler(apiUrl),
    ...lookupTableHandlers(apiUrl, {
      lookupTables: lookupTableStore,
      tradingPartners: tradingPartnerStore,
    }),
  ]
}
