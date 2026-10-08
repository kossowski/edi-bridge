import { flowsHandler, tradingPartnersHandler } from './directory'
import { runsHandler } from './run'
import { currentWorkspaceHandler } from './workspace'

export { flowsHandler, seedFlows, seedTradingPartners, tradingPartnersHandler } from './directory'

export { createRun, createRuns, runsHandler, seedRuns } from './run'

export { createWorkspace, currentWorkspaceHandler, seedWorkspace } from './workspace'

export function createHandlers(apiUrl: string) {
  return [
    currentWorkspaceHandler(apiUrl),
    tradingPartnersHandler(apiUrl),
    flowsHandler(apiUrl),
    runsHandler(apiUrl),
  ]
}
