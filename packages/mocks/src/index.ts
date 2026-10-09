import { flowsHandler } from './flow'
import { runsHandler, seedRuns } from './run'
import { runDetailHandlers, seedReprocessed } from './run-detail'
import { createRunStore } from './run-store'
import { tradingPartnersHandler } from './trading-partner'
import { currentWorkspaceHandler } from './workspace'

export { flowsHandler, seedFlows } from './flow'

export { createRun, createRuns, runsHandler, seedRuns } from './run'

export {
  interchangeIdOf,
  runDetailHandlers,
  type RunDetailOptions,
  seedReprocessed,
} from './run-detail'

export { seedTradingPartners, tradingPartnersHandler } from './trading-partner'

export { createWorkspace, currentWorkspaceHandler, seedWorkspace } from './workspace'

export { createRunStore, type RunStore } from './run-store'

export function createHandlers(apiUrl: string) {
  const runs = createRunStore(seedRuns())

  return [
    currentWorkspaceHandler(apiUrl),
    tradingPartnersHandler(apiUrl),
    flowsHandler(apiUrl),
    runsHandler(apiUrl, runs),
    ...runDetailHandlers(apiUrl, { runs, reprocessed: seedReprocessed() }),
  ]
}
