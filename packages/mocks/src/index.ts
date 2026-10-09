import { flowsHandler } from './flow'
import { runsHandler } from './run'
import { runDetailHandlers } from './run-detail'
import { tradingPartnersHandler } from './trading-partner'
import { currentWorkspaceHandler } from './workspace'

export { flowsHandler, seedFlows } from './flow'

export { createRun, createRuns, runsHandler, seedRuns } from './run'

export { runDetailHandlers, type RunDetailOptions } from './run-detail'

export { seedTradingPartners, tradingPartnersHandler } from './trading-partner'

export { createWorkspace, currentWorkspaceHandler, seedWorkspace } from './workspace'

export function createHandlers(apiUrl: string) {
  return [
    currentWorkspaceHandler(apiUrl),
    tradingPartnersHandler(apiUrl),
    flowsHandler(apiUrl),
    runsHandler(apiUrl),
    ...runDetailHandlers(apiUrl),
  ]
}
