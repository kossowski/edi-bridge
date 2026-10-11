import { http, HttpResponse } from 'msw'

import {
  documentRetentionDays,
  operatorWorkspaceSettingsEndpoint,
  type Session,
  updateOperatorWorkspaceSettingsEndpoint,
  updateWorkspaceSettingsEndpoint,
  workspaceSettingsEndpoint,
  type WorkspaceSettings,
  workspaceSettingsSchema,
  type WorkspaceSummary,
} from '@edi-bridge/contracts'

import { type OperatorStore, seedWorkspaceSummaries, toOperatorStore } from './operator'
import { badRequest, notFound } from './responses'
import { seedSession, toSessionStore } from './session'
import { operatorOnly, type SessionStore, signedInOnly } from './session-access'

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
  get: (workspaceId: string) => WorkspaceSettings
  set: (workspaceId: string, settings: WorkspaceSettings) => void
}

export function createWorkspaceSettingsStore(
  settings: WorkspaceSettings = seedWorkspaceSettings,
): WorkspaceSettingsStore {
  const byWorkspace = new Map<string, WorkspaceSettings>()

  return {
    get: (workspaceId) => byWorkspace.get(workspaceId) ?? settings,
    set: (workspaceId, next) => {
      byWorkspace.set(workspaceId, next)
    },
  }
}

export function toWorkspaceSettingsStore(
  settings: WorkspaceSettings | WorkspaceSettingsStore = seedWorkspaceSettings,
) {
  return 'get' in settings ? settings : createWorkspaceSettingsStore(settings)
}

export function workspaceSettingsHandlers(
  apiUrl: string,
  {
    settings = seedWorkspaceSettings,
    session = seedSession,
    workspaces = seedWorkspaceSummaries,
  }: {
    settings?: WorkspaceSettings | WorkspaceSettingsStore
    session?: Session | null | SessionStore
    workspaces?: ReadonlyArray<WorkspaceSummary> | OperatorStore
  } = {},
) {
  const store = toWorkspaceSettingsStore(settings)
  const sessionStore = toSessionStore(session)
  const operatorStore = toOperatorStore(workspaces)

  async function update(workspaceId: string, request: Request) {
    const body = updateWorkspaceSettingsEndpoint.body.safeParse(await request.json())

    if (!body.success) {
      return badRequest(body.error.message)
    }

    const current = store.get(workspaceId)

    store.set(workspaceId, {
      documentRetentionDays: body.data.documentRetentionDays,
      aiTokenBudget: { ...current.aiTokenBudget, dailyLimit: body.data.aiTokenBudget.dailyLimit },
    })

    return HttpResponse.json(store.get(workspaceId))
  }

  return [
    http.get(
      `${apiUrl}${workspaceSettingsEndpoint.path}`,
      signedInOnly(sessionStore, (_, { workspace }) => HttpResponse.json(store.get(workspace.id))),
    ),
    http.put(
      `${apiUrl}${updateWorkspaceSettingsEndpoint.path}`,
      operatorOnly(sessionStore, ({ request }, { workspace }) => update(workspace.id, request)),
    ),
    http.get<{ workspaceId: string }>(
      `${apiUrl}${operatorWorkspaceSettingsEndpoint.path}`,
      operatorOnly(sessionStore, ({ params }) =>
        operatorStore.workspace(params.workspaceId)
          ? HttpResponse.json(store.get(params.workspaceId))
          : notFound(),
      ),
    ),
    http.put<{ workspaceId: string }>(
      `${apiUrl}${updateOperatorWorkspaceSettingsEndpoint.path}`,
      operatorOnly(sessionStore, ({ params, request }) =>
        operatorStore.workspace(params.workspaceId)
          ? update(params.workspaceId, request)
          : notFound(),
      ),
    ),
  ]
}
