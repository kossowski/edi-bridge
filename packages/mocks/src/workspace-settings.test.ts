import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  updateWorkspaceSettingsEndpoint,
  workspaceSettingsEndpoint,
  type WorkspaceSettingsInput,
  workspaceSettingsSchema,
} from '@edi-bridge/contracts'

import { showcaseAdminSession, showcaseViewerSession } from './session'
import { createWorkspaceSettings, workspaceSettingsHandlers } from './workspace-settings'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

async function getSettings() {
  return fetch(`${apiUrl}${workspaceSettingsEndpoint.path}`)
}

async function putSettings(body: Partial<WorkspaceSettingsInput>) {
  return fetch(`${apiUrl}${updateWorkspaceSettingsEndpoint.path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const input: WorkspaceSettingsInput = {
  documentRetentionDays: 30,
  aiTokenBudget: { dailyLimit: 50_000 },
}

describe('GET /workspaces/current/settings', () => {
  it('serves the retention period and the AI token budget with today’s usage', async () => {
    server.use(...workspaceSettingsHandlers(apiUrl))

    const settings = workspaceSettingsSchema.parse(await (await getSettings()).json())

    expect(settings.documentRetentionDays).toBe(90)
    expect(settings.aiTokenBudget.usedToday).toBeGreaterThan(0)
    expect(settings.aiTokenBudget.usedToday).toBeLessThan(settings.aiTokenBudget.dailyLimit)
  })

  it('serves an exhausted AI token budget', async () => {
    const exhausted = createWorkspaceSettings({
      aiTokenBudget: { dailyLimit: 100_000, usedToday: 100_412 },
    })

    server.use(...workspaceSettingsHandlers(apiUrl, { settings: exhausted }))

    expect(workspaceSettingsSchema.parse(await (await getSettings()).json())).toEqual(exhausted)
  })

  it('answers 401 when signed out', async () => {
    server.use(...workspaceSettingsHandlers(apiUrl, { session: null }))

    expect((await getSettings()).status).toBe(401)
  })

  it('serves the settings read-only to a Viewer', async () => {
    server.use(...workspaceSettingsHandlers(apiUrl, { session: showcaseViewerSession }))

    expect((await getSettings()).status).toBe(200)
  })
})

describe('PUT /workspaces/current/settings', () => {
  it('lets the Operator change both settings and keeps today’s usage', async () => {
    const settings = createWorkspaceSettings({
      aiTokenBudget: { dailyLimit: 200_000, usedToday: 1_234 },
    })

    server.use(...workspaceSettingsHandlers(apiUrl, { settings }))

    const response = await putSettings(input)

    const expected = {
      documentRetentionDays: 30,
      aiTokenBudget: { dailyLimit: 50_000, usedToday: 1_234 },
    }

    expect(response.status).toBe(200)
    expect(workspaceSettingsSchema.parse(await response.json())).toEqual(expected)
    expect(await (await getSettings()).json()).toEqual(expected)
  })

  it('answers 403 for an Admin who is not the Operator', async () => {
    server.use(...workspaceSettingsHandlers(apiUrl, { session: showcaseAdminSession }))

    expect((await putSettings(input)).status).toBe(403)
  })

  it('answers 401 when signed out', async () => {
    server.use(...workspaceSettingsHandlers(apiUrl, { session: null }))

    expect((await putSettings(input)).status).toBe(401)
  })

  it.each([
    ['a retention period under 7 days', { ...input, documentRetentionDays: 6 }],
    ['a retention period over 730 days', { ...input, documentRetentionDays: 731 }],
    ['a negative daily limit', { ...input, aiTokenBudget: { dailyLimit: -1 } }],
    ['a missing daily limit', { documentRetentionDays: 30 }],
  ])('answers 400 for %s', async (_, body) => {
    server.use(...workspaceSettingsHandlers(apiUrl))

    expect((await putSettings(body)).status).toBe(400)
  })
})
