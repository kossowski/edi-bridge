import type { DocumentStructure, TradingPartner, Workspace } from '@edi-bridge/contracts'

import { channelHandlers, type ChannelRecord, createChannelStore, seedChannels } from './channel'
import {
  documentStructureHandlers,
  type DocumentStructureStore,
  seedDocumentStructures,
  seedUnusedDocumentStructures,
  toDocumentStructureStore,
} from './document-structure'
import { createFlowStore, flowHandlers } from './flow'
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
import { runsHandler, seedRuns } from './run'
import { runDetailHandlers, seedReprocessed } from './run-detail'
import { createRunStore } from './run-store'
import {
  createTradingPartnerStore,
  seedTradingPartners,
  tradingPartnerHandlers,
} from './trading-partner'
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
    documentStructures = [...seedDocumentStructures, ...seedUnusedDocumentStructures],
    lookupTables = seedLookupTables,
    mappingSamples = seedMappingSamples,
    mappingVersions,
  }: {
    workspace?: Workspace
    tradingPartners?: ReadonlyArray<TradingPartner>
    channels?: ReadonlyArray<ChannelRecord>
    mappingDrafts?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
    documentStructures?: ReadonlyArray<DocumentStructure> | DocumentStructureStore
    lookupTables?: ReadonlyArray<LookupTableRecord>
    mappingSamples?: ReadonlyArray<MappingSampleRecord>
    mappingVersions?: ReadonlyArray<MappingVersionRecord> | MappingVersionStore
  } = {},
) {
  const runs = createRunStore(seedRuns())
  const tradingPartnerStore = createTradingPartnerStore(tradingPartners)
  const workspaceStore = createWorkspaceStore(workspace)
  const channelStore = createChannelStore(channels)
  const flows = createFlowStore()
  const mappingDraftStore = toMappingDraftStore(mappingDrafts)
  const documentStructureStore = toDocumentStructureStore(documentStructures)
  const lookupTableStore = createLookupTableStore(lookupTables)

  const mappingVersionStore = toMappingVersionStore(
    mappingVersions ?? [...seedMappingVersions, ...createMappingVersions(mappingDraftStore.all())],
  )

  return [
    ...workspaceHandlers(apiUrl, workspaceStore),
    ...tradingPartnerHandlers(apiUrl, {
      tradingPartners: tradingPartnerStore,
      workspace: workspaceStore,
    }),
    ...channelHandlers(apiUrl, { channels: channelStore }),
    ...flowHandlers(apiUrl, { flows, channels: channelStore, mappings: mappingVersionStore }),
    publishedMappingVersionsHandler(apiUrl, mappingVersionStore),
    runsHandler(apiUrl, runs),
    ...mappingVersionHandlers(apiUrl, {
      mappings: mappingDraftStore,
      versions: mappingVersionStore,
      samples: mappingSamples,
      documentStructures: documentStructureStore,
      lookupTables: lookupTableStore,
    }),
    ...runDetailHandlers(apiUrl, {
      runs,
      reprocessed: seedReprocessed(),
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
