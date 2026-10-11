import { faker } from '@faker-js/faker'
import { http, HttpResponse, type HttpResponseResolver } from 'msw'

import {
  currentWorkspaceEndpoint,
  type Session,
  updateCompanyIdentityEndpoint,
  withCheckDigit,
  type Workspace,
  workspaceSchema,
} from '@edi-bridge/contracts'

import { randomGln } from './gln'
import { badRequest } from './responses'
import { adminOnly, type SessionStore, sessionStoreOf, signedInOnly } from './session-access'

export function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  const workspace: Workspace = {
    id: faker.string.uuid(),
    name: faker.company.name(),
    gln: randomGln(faker),
    ...overrides,
  }

  return workspaceSchema.parse(workspace)
}

export const seedWorkspace = createWorkspace({
  id: '5f0c3a52-7d1e-4b8a-9c61-2e4f8d9a1b07',
  name: 'Nordwind Handel GmbH',
  gln: withCheckDigit('021234500000'),
})

export const seedShowcaseWorkspace = createWorkspace({
  id: '5f0c3a52-7d1e-4b8a-9c61-2e4f8d9a1b08',
  name: 'Lindenhof Feinkost GmbH',
  gln: withCheckDigit('022345600000'),
})

export const seedSandboxWorkspace = createWorkspace({
  id: '5f0c3a52-7d1e-4b8a-9c61-2e4f8d9a1b09',
  name: 'Kranichsee Getränke GmbH',
  gln: withCheckDigit('023456700000'),
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
  session?: Session | null | SessionStore,
) {
  const store = toWorkspaceStore(workspace)
  const respond = () => HttpResponse.json(store.get())

  return http.get(
    `${apiUrl}${currentWorkspaceEndpoint.path}`,
    session === undefined ? respond : signedInOnly(sessionStoreOf(session), respond),
  )
}

export function workspaceHandlers(
  apiUrl: string,
  workspace: Workspace | WorkspaceStore = seedWorkspace,
  session?: Session | null | SessionStore,
) {
  const store = toWorkspaceStore(workspace)

  const updateIdentity: HttpResponseResolver = async ({ request }) => {
    const body = updateCompanyIdentityEndpoint.body.safeParse(await request.json())

    if (!body.success) {
      return badRequest(body.error.message)
    }

    store.set({ ...store.get(), gln: body.data.gln })

    return HttpResponse.json(store.get())
  }

  return [
    currentWorkspaceHandler(apiUrl, store, session),
    http.put(
      `${apiUrl}${updateCompanyIdentityEndpoint.path}`,
      session === undefined ? updateIdentity : adminOnly(sessionStoreOf(session), updateIdentity),
    ),
  ]
}
