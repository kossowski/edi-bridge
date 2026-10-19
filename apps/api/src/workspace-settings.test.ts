import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  aiDailyTokenLimit,
  documentRetentionDays,
  operatorWorkspaceSettingsEndpoint,
  toPath,
  updateOperatorWorkspaceSettingsEndpoint,
  updateWorkspaceSettingsEndpoint,
  workspaceSettingsEndpoint,
  type WorkspaceSettingsInput,
  workspaceSettingsSchema,
} from '@edi-bridge/contracts'
import { aiTokenUsage, workspaces } from '@edi-bridge/db'

import {
  addMember,
  type Client,
  type NewMember,
  otherWorkspace,
  ownWorkspace,
  signIn,
  startTestApi,
  type TestApi,
} from './testing.js'

const operatorOfOwnWorkspace: NewMember = {
  name: 'Settings Operator',
  email: 'operator@settings.example',
  password: 'settings-operator-password',
  workspaceId: ownWorkspace.id,
  role: 'viewer',
  operator: true,
}

const defaults = {
  documentRetentionDays: documentRetentionDays.default,
  aiTokenBudget: { dailyLimit: aiDailyTokenLimit.default, usedToday: 0 },
}

const changed: WorkspaceSettingsInput = {
  documentRetentionDays: 30,
  aiTokenBudget: { dailyLimit: 50_000 },
}

let api: TestApi

let operator: Client

beforeAll(async () => {
  api = await startTestApi()
  await addMember(api.connection.db, operatorOfOwnWorkspace)
  operator = await signIn(api.app, operatorOfOwnWorkspace)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

beforeEach(async () => {
  await api.connection.db.delete(aiTokenUsage)
  await api.connection.db.update(workspaces).set({
    documentRetentionDays: documentRetentionDays.default,
    aiDailyTokenLimit: aiDailyTokenLimit.default,
  })
})

const today = () => new Date().toISOString().slice(0, 10)

const getSettings = (target: Client = api.admin) =>
  target.inject({ method: 'GET', url: workspaceSettingsEndpoint.path })

const putSettings = (body: Partial<WorkspaceSettingsInput>, target: Client = api.admin) =>
  target.inject({ method: 'PUT', url: updateWorkspaceSettingsEndpoint.path, body })

const operatorPath = (workspaceId: string) =>
  toPath(operatorWorkspaceSettingsEndpoint.path, { workspaceId })

const getOperatorSettings = (workspaceId: string, target: Client = operator) =>
  target.inject({ method: 'GET', url: operatorPath(workspaceId) })

const putOperatorSettings = (
  workspaceId: string,
  body: Partial<WorkspaceSettingsInput>,
  target: Client = operator,
) =>
  target.inject({
    method: 'PUT',
    url: toPath(updateOperatorWorkspaceSettingsEndpoint.path, { workspaceId }),
    body,
  })

const outOfBounds: Array<[string, Partial<WorkspaceSettingsInput>]> = [
  [
    'a retention period below the minimum',
    { ...changed, documentRetentionDays: documentRetentionDays.min - 1 },
  ],
  [
    'a retention period above the maximum',
    { ...changed, documentRetentionDays: documentRetentionDays.max + 1 },
  ],
  ['a negative token limit', { ...changed, aiTokenBudget: { dailyLimit: -1 } }],
  [
    'a token limit above the maximum',
    { ...changed, aiTokenBudget: { dailyLimit: aiDailyTokenLimit.max + 1 } },
  ],
  ['no token limit', { documentRetentionDays: 30 }],
]

describe('GET /workspaces/current/settings', () => {
  it('returns the defaults of a new Workspace', async () => {
    const response = await getSettings()

    expect(response.statusCode).toBe(200)
    expect(workspaceSettingsSchema.parse(response.json())).toEqual(defaults)
  })

  it('counts the tokens used today in the Workspace', async () => {
    await api.connection.db.insert(aiTokenUsage).values([
      { workspaceId: ownWorkspace.id, day: today(), tokens: 1234 },
      { workspaceId: ownWorkspace.id, day: '2020-01-01', tokens: 99 },
      { workspaceId: otherWorkspace.id, day: today(), tokens: 5678 },
    ])

    const response = await getSettings()

    expect(response.json()).toMatchObject({ aiTokenBudget: { usedToday: 1234 } })
  })

  it('lets a Viewer read the settings', async () => {
    const response = await getSettings(api.viewer)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(defaults)
  })

  it('answers 401 without a session', async () => {
    expect((await getSettings(api.app)).statusCode).toBe(401)
  })
})

describe('PUT /workspaces/current/settings', () => {
  it('stores the retention period and the daily token limit of the Workspace', async () => {
    await api.connection.db
      .insert(aiTokenUsage)
      .values({ workspaceId: ownWorkspace.id, day: today(), tokens: 700 })

    const response = await putSettings(changed)

    const expected = {
      documentRetentionDays: 30,
      aiTokenBudget: { dailyLimit: 50_000, usedToday: 700 },
    }

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expected)
    expect((await getSettings()).json()).toEqual(expected)
    expect((await getSettings(api.otherAdmin)).json()).toEqual(defaults)
  })

  it.each([
    [documentRetentionDays.min, aiDailyTokenLimit.min],
    [documentRetentionDays.max, aiDailyTokenLimit.max],
  ])('accepts the bounds %i days and %i tokens', async (days, tokens) => {
    const response = await putSettings({
      documentRetentionDays: days,
      aiTokenBudget: { dailyLimit: tokens },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      documentRetentionDays: days,
      aiTokenBudget: { dailyLimit: tokens },
    })
  })

  it.each(outOfBounds)('rejects %s and changes nothing', async (_case, body) => {
    const response = await putSettings(body)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toHaveProperty('message')
    expect((await getSettings()).json()).toEqual(defaults)
  })

  it('answers 403 to a Viewer and changes nothing', async () => {
    expect((await putSettings(changed, api.viewer)).statusCode).toBe(403)
    expect((await getSettings()).json()).toEqual(defaults)
  })

  it('answers 401 without a session and changes nothing', async () => {
    expect((await putSettings(changed, api.app)).statusCode).toBe(401)
    expect((await getSettings()).json()).toEqual(defaults)
  })
})

describe('GET /operator/workspaces/:workspaceId/settings', () => {
  it('returns the settings of any Workspace to the Operator', async () => {
    await putSettings(changed, api.otherAdmin)
    await api.connection.db
      .insert(aiTokenUsage)
      .values({ workspaceId: otherWorkspace.id, day: today(), tokens: 42 })

    const response = await getOperatorSettings(otherWorkspace.id)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      documentRetentionDays: 30,
      aiTokenBudget: { dailyLimit: 50_000, usedToday: 42 },
    })
  })

  it('answers 403 to an Admin who is not the Operator', async () => {
    expect((await getOperatorSettings(ownWorkspace.id, api.admin)).statusCode).toBe(403)
  })

  it.each([
    ['an unknown', '00000000-0000-4000-8000-000000000000'],
    ['an invalid', 'not-a-uuid'],
  ])('answers 404 for %s Workspace', async (_case, workspaceId) => {
    expect((await getOperatorSettings(workspaceId)).statusCode).toBe(404)
  })

  it('answers 401 without a session', async () => {
    expect((await getOperatorSettings(ownWorkspace.id, api.app)).statusCode).toBe(401)
  })
})

describe('PUT /operator/workspaces/:workspaceId/settings', () => {
  it('stores the settings of any Workspace', async () => {
    const response = await putOperatorSettings(otherWorkspace.id, changed)

    const expected = {
      documentRetentionDays: 30,
      aiTokenBudget: { dailyLimit: 50_000, usedToday: 0 },
    }

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(expected)
    expect((await getSettings(api.otherAdmin)).json()).toEqual(expected)
    expect((await getSettings()).json()).toEqual(defaults)
  })

  it.each(outOfBounds)('rejects %s and changes nothing', async (_case, body) => {
    expect((await putOperatorSettings(otherWorkspace.id, body)).statusCode).toBe(400)
    expect((await getSettings(api.otherAdmin)).json()).toEqual(defaults)
  })

  it('answers 403 to an Admin who is not the Operator and changes nothing', async () => {
    expect((await putOperatorSettings(otherWorkspace.id, changed, api.admin)).statusCode).toBe(403)
    expect((await getSettings(api.otherAdmin)).json()).toEqual(defaults)
  })

  it.each([
    ['an unknown', '00000000-0000-4000-8000-000000000000'],
    ['an invalid', 'not-a-uuid'],
  ])('answers 404 for %s Workspace', async (_case, workspaceId) => {
    expect((await putOperatorSettings(workspaceId, changed)).statusCode).toBe(404)
  })

  it('answers 401 without a session', async () => {
    expect((await putOperatorSettings(otherWorkspace.id, changed, api.app)).statusCode).toBe(401)
  })
})
