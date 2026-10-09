import { faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  currentWorkspaceEndpoint,
  updateCompanyIdentityEndpoint,
  withCheckDigit,
  type Workspace,
  workspaceSchema,
} from '@edi-bridge/contracts'

export function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  const workspace: Workspace = {
    id: faker.string.uuid(),
    name: faker.company.name(),
    gln: withCheckDigit(`02${faker.string.numeric({ length: 10, allowLeadingZeros: true })}`),
    ...overrides,
  }

  return workspaceSchema.parse(workspace)
}

export const seedWorkspace = createWorkspace({
  id: '5f0c3a52-7d1e-4b8a-9c61-2e4f8d9a1b07',
  name: 'Nordwind Handel GmbH',
  gln: withCheckDigit('021234500000'),
})

export type WorkspaceStore = {
  get: () => Workspace
  set: (workspace: Workspace) => void
}

export function createWorkspaceStore(workspace: Workspace = seedWorkspace): WorkspaceStore {
  let current = workspace

  return {
    get: () => current,
    set: (next) => {
      current = next
    },
  }
}

export function toWorkspaceStore(workspace: Workspace | WorkspaceStore = seedWorkspace) {
  return 'get' in workspace ? workspace : createWorkspaceStore(workspace)
}

export function currentWorkspaceHandler(
  apiUrl: string,
  workspace: Workspace | WorkspaceStore = seedWorkspace,
) {
  const store = toWorkspaceStore(workspace)

  return http.get<never, never, Workspace>(`${apiUrl}${currentWorkspaceEndpoint.path}`, () =>
    HttpResponse.json(store.get()),
  )
}

export function workspaceHandlers(
  apiUrl: string,
  workspace: Workspace | WorkspaceStore = seedWorkspace,
) {
  const store = toWorkspaceStore(workspace)

  return [
    currentWorkspaceHandler(apiUrl, store),
    http.put(`${apiUrl}${updateCompanyIdentityEndpoint.path}`, async ({ request }) => {
      const body = updateCompanyIdentityEndpoint.body.safeParse(await request.json())

      if (!body.success) {
        return HttpResponse.json({ message: body.error.message }, { status: 400 })
      }

      store.set({ ...store.get(), gln: body.data.gln })

      return HttpResponse.json(store.get())
    }),
  ]
}
