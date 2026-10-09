import type { TradingPartner, Workspace } from '@edi-bridge/contracts'

import { channelsHandler } from './channel'
import { flowsHandler } from './flow'
import { runsHandler, seedRuns } from './run'
import { runDetailHandlers, seedReprocessed } from './run-detail'
import { createRunStore } from './run-store'
import { seedTradingPartners, tradingPartnerHandlers } from './trading-partner'
import { createWorkspaceStore, seedWorkspace, workspaceHandlers } from './workspace'

export { channelsHandler, seedChannels } from './channel'

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
  tradingPartnersHandler,
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
  }: { workspace?: Workspace; tradingPartners?: ReadonlyArray<TradingPartner> } = {},
) {
  const runs = createRunStore(seedRuns())
  const workspaceStore = createWorkspaceStore(workspace)

  return [
    ...workspaceHandlers(apiUrl, workspaceStore),
    ...tradingPartnerHandlers(apiUrl, { tradingPartners, workspace: workspaceStore }),
    channelsHandler(apiUrl),
    flowsHandler(apiUrl),
    runsHandler(apiUrl, runs),
    ...runDetailHandlers(apiUrl, { runs, reprocessed: seedReprocessed() }),
  ]
}
