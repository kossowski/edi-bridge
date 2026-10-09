import type { TradingPartner, Workspace } from '@edi-bridge/contracts'

import { channelHandlers, type ChannelRecord, createChannelStore, seedChannels } from './channel'
import { createFlowStore, flowHandlers, seedMappings } from './flow'
import { createMappingCatalogue, publishedMappingVersionsHandler } from './mapping-version'
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
  }: {
    workspace?: Workspace
    tradingPartners?: ReadonlyArray<TradingPartner>
    channels?: ReadonlyArray<ChannelRecord>
  } = {},
) {
  const runs = createRunStore(seedRuns())
  const workspaceStore = createWorkspaceStore(workspace)
  const channelStore = createChannelStore(channels)
  const mappings = createMappingCatalogue(seedMappings)

  return [
    ...workspaceHandlers(apiUrl, workspaceStore),
    ...tradingPartnerHandlers(apiUrl, { tradingPartners, workspace: workspaceStore }),
    ...channelHandlers(apiUrl, { channels: channelStore }),
    ...flowHandlers(apiUrl, { flows: createFlowStore(), channels: channelStore, mappings }),
    publishedMappingVersionsHandler(apiUrl, mappings),
    runsHandler(apiUrl, runs),
    ...runDetailHandlers(apiUrl, { runs, reprocessed: seedReprocessed() }),
  ]
}
