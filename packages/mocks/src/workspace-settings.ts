import { http, HttpResponse } from 'msw'

import {
  documentRetentionDays,
  type Session,
  updateWorkspaceSettingsEndpoint,
  workspaceSettingsEndpoint,
  type WorkspaceSettings,
  workspaceSettingsSchema,
} from '@edi-bridge/contracts'

import { badRequest } from './responses'
import {
  seedSession,
  type SessionStore,
  signedIn,
  signedInOperator,
  toSessionStore,
} from './session'

export function createWorkspaceSettings(
  overrides: Partial<WorkspaceSettings> = {},
): WorkspaceSettings {
  return workspaceSettingsSchema.parse({
    documentRetentionDays: documentRetentionDays.default,
    aiTokenBudget: { dailyLimit: 200_000, usedToday: 48_350 },
    ...overrides,
  })
}

export const seedWorkspaceSettings = createWorkspaceSettings()

export type WorkspaceSettingsStore = {
  get: () => WorkspaceSettings
  set: (settings: WorkspaceSettings) => void
}

export function createWorkspaceSettingsStore(
  settings: WorkspaceSettings = seedWorkspaceSettings,
): WorkspaceSettingsStore {
  let current = settings

  return {
    get: () => current,
    set: (next) => {
      current = next
    },
  }
}

export function workspaceSettingsHandlers(
  apiUrl: string,
  {
    settings = seedWorkspaceSettings,
    session = seedSession,
  }: {
    settings?: WorkspaceSettings | WorkspaceSettingsStore
    session?: Session | null | SessionStore
  } = {},
) {
  const store = 'get' in settings ? settings : createWorkspaceSettingsStore(settings)
  const sessionStore = toSessionStore(session)

  return [
    http.get(`${apiUrl}${workspaceSettingsEndpoint.path}`, () => {
      const access = signedIn(sessionStore)

      return 'response' in access ? access.response : HttpResponse.json(store.get())
    }),
    http.put(`${apiUrl}${updateWorkspaceSettingsEndpoint.path}`, async ({ request }) => {
      const access = signedInOperator(sessionStore)

      if ('response' in access) {
        return access.response
      }

      const body = updateWorkspaceSettingsEndpoint.body.safeParse(await request.json())

      if (!body.success) {
        return badRequest(body.error.message)
      }

      const current = store.get()

      store.set({
        documentRetentionDays: body.data.documentRetentionDays,
        aiTokenBudget: { ...current.aiTokenBudget, dailyLimit: body.data.aiTokenBudget.dailyLimit },
      })

      return HttpResponse.json(store.get())
    }),
  ]
}
