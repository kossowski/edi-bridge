import type {
  DocumentStructure,
  LookupTableSummary,
  TradingPartner,
  Workspace,
} from '@edi-bridge/contracts'

import { channelHandlers, type ChannelRecord, createChannelStore, seedChannels } from './channel'
import { documentStructureHandler, seedDocumentStructures } from './document-structure'
import { createFlowStore, flowHandlers, seedMappings } from './flow'
import { lookupTablesHandler, seedLookupTables } from './lookup-table'
import { manualSubmissionHandler } from './manual-submission'
import {
  type MappingDraftRecord,
  mappingHandlers,
  type MappingDraftStore,
  seedMappingDrafts,
} from './mapping'
import { createMappingCatalogue, publishedMappingVersionsHandler } from './mapping-version'
import { messageTypeStructureHandler } from './message-type-structure'
import { runsHandler, seedRuns } from './run'
import { runDetailHandlers, seedReprocessed } from './run-detail'
import { createRunStore } from './run-store'
import { seedTradingPartners, tradingPartnerHandlers } from './trading-partner'
import { createWorkspaceStore, seedWorkspace, workspaceHandlers } from './workspace'

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
  flowHandlers,
  type FlowRecord,
  type FlowStore,
  seedFlows,
  seedMappings,
  toFlow,
  toFlowStore,
} from './flow'

export {
  createDocumentStructure,
  documentStructureHandler,
  documentStructureLeaves,
  seedDocumentStructureOf,
  seedDocumentStructures,
} from './document-structure'

export {
  createLookupTables,
  lookupTablesHandler,
  seedLookupTableNamed,
  seedLookupTables,
} from './lookup-table'

export { manualSubmissionHandler } from './manual-submission'

export {
  createMappingDrafts,
  createMappingDraftStore,
  mappingHandlers,
  type MappingDraftRecord,
  type MappingDraftStore,
  seedMappingDrafts,
  toMappingDraft,
  toMappingDraftStore,
  toMappingSummary,
} from './mapping'

export {
  edifactLeaves,
  messageTypeStructureHandler,
  messageTypeStructures,
} from './message-type-structure'

export {
  createMappingCatalogue,
  type MappingCatalogue,
  type MappingRecord,
  publishedMappingVersionsHandler,
} from './mapping-version'

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
  seedTradingPartners,
  tradingPartnerHandlers,
} from './trading-partner'

export {
  createWorkspace,
  createWorkspaceStore,
  currentWorkspaceHandler,
  seedWorkspace,
  workspaceHandlers,
  type WorkspaceStore,
} from './workspace'

export { createRunStore, type RunStore } from './run-store'

export function createHandlers(
  apiUrl: string,
  {
    workspace = seedWorkspace,
    tradingPartners = seedTradingPartners,
    channels = seedChannels,
    mappingDrafts = seedMappingDrafts,
    documentStructures = seedDocumentStructures,
    lookupTables = seedLookupTables,
  }: {
    workspace?: Workspace
    tradingPartners?: ReadonlyArray<TradingPartner>
    channels?: ReadonlyArray<ChannelRecord>
    mappingDrafts?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
    documentStructures?: ReadonlyArray<DocumentStructure>
    lookupTables?: ReadonlyArray<LookupTableSummary>
  } = {},
) {
  const runs = createRunStore(seedRuns())
  const workspaceStore = createWorkspaceStore(workspace)
  const channelStore = createChannelStore(channels)
  const mappings = createMappingCatalogue(seedMappings)
  const flows = createFlowStore()

  return [
    ...workspaceHandlers(apiUrl, workspaceStore),
    ...tradingPartnerHandlers(apiUrl, { tradingPartners, workspace: workspaceStore }),
    ...channelHandlers(apiUrl, { channels: channelStore }),
    ...flowHandlers(apiUrl, { flows, channels: channelStore, mappings }),
    publishedMappingVersionsHandler(apiUrl, mappings),
    runsHandler(apiUrl, runs),
    ...runDetailHandlers(apiUrl, { runs, reprocessed: seedReprocessed() }),
    manualSubmissionHandler(apiUrl, { channels: channelStore, flows, runs, tradingPartners }),
    ...mappingHandlers(apiUrl, { mappings: mappingDrafts, documentStructures }),
    documentStructureHandler(apiUrl, documentStructures),
    messageTypeStructureHandler(apiUrl),
    lookupTablesHandler(apiUrl, lookupTables),
  ]
}
