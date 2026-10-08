import { currentWorkspaceHandler } from './workspace'

export { createWorkspace, currentWorkspaceHandler, seedWorkspace } from './workspace'

export function createHandlers(apiUrl: string) {
  return [currentWorkspaceHandler(apiUrl)]
}
