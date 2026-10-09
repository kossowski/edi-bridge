import type { TradingPartner, Workspace } from '@edi-bridge/contracts'

import { channelHandlers, type ChannelRecord, createChannelStore, seedChannels } from './channel'
import { flowsHandler } from './flow'
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

export { flowsHandler, seedFlows } from './flow'

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

  return [
    ...workspaceHandlers(apiUrl, workspaceStore),
    ...tradingPartnerHandlers(apiUrl, { tradingPartners, workspace: workspaceStore }),
    ...channelHandlers(apiUrl, { channels: channelStore }),
    flowsHandler(apiUrl),
    runsHandler(apiUrl, runs),
    ...runDetailHandlers(apiUrl, { runs, reprocessed: seedReprocessed() }),
  ]
}
