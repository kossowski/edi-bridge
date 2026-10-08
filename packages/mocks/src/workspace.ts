import { faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import { currentWorkspaceEndpoint, type Workspace, workspaceSchema } from '@edi-bridge/contracts'

export function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  const workspace: Workspace = {
    id: faker.string.uuid(),
    name: faker.company.name(),
    ...overrides,
  }

  return workspaceSchema.parse(workspace)
}

export const seedWorkspace = createWorkspace({
  id: '5f0c3a52-7d1e-4b8a-9c61-2e4f8d9a1b07',
  name: 'Nordwind Handel GmbH',
})

export function currentWorkspaceHandler(apiUrl: string, workspace: Workspace = seedWorkspace) {
  return http.get<never, never, Workspace>(`${apiUrl}${currentWorkspaceEndpoint.path}`, () =>
    HttpResponse.json(workspace),
  )
}
