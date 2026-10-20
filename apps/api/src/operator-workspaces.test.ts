import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createInviteEndpoint,
  operatorWorkspacesEndpoint,
  toPath,
  workspaceSummarySchema,
} from '@edi-bridge/contracts'

import { hourMs } from './duration.js'
import {
  addMember,
  addTradingPartnerWithFlows,
  type Client,
  otherWorkspace,
  ownOperator,
  ownWorkspace,
  seedWorkspaceWithAdmin,
  signIn,
  startTestApi,
  type TestApi,
} from './testing.js'

const summariesSchema = z.array(workspaceSummarySchema)

let api: TestApi

let operator: Client

beforeAll(async () => {
  api = await startTestApi()
  await addMember(api.connection.db, ownOperator)
  operator = await signIn(api.app, ownOperator)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const listWorkspaces = async (client: Client) => {
  const response = await client.inject({
    method: operatorWorkspacesEndpoint.method,
    url: operatorWorkspacesEndpoint.path,
  })

  expect(response.statusCode, response.body).toBe(200)

  return summariesSchema.parse(response.json())
}

describe('GET /operator/workspaces', () => {
  it('lists every Workspace by name with its Members, open invites and traffic', async () => {
    const { workspace } = await seedWorkspaceWithAdmin(api, 'Alpenland Getränke GmbH')
    const partner = await addTradingPartnerWithFlows(api.connection.db, workspace, 'Rheinkauf eG')
    const now = Date.now()

    await partner.orders({ receivedAt: new Date(now - 60_000) })
    await partner.orders({ receivedAt: new Date(now - 30 * hourMs) })
    await operator.inject({
      method: createInviteEndpoint.method,
      url: toPath(createInviteEndpoint.path, { workspaceId: otherWorkspace.id }),
      body: { email: 'new@sudhafen.example', role: 'viewer' },
    })

    const summaries = await listWorkspaces(operator)

    expect(summaries.map(({ name }) => name)).toEqual([
      'Alpenland Getränke GmbH',
      ownWorkspace.name,
      otherWorkspace.name,
    ])

    const [alpenland, own, other] = summaries

    expect(alpenland).toMatchObject({
      id: workspace.id,
      kind: 'standard',
      memberCount: 1,
      pendingInviteCount: 0,
      documentsToday: 1,
      seeded: false,
      lastResetAt: null,
    })
    expect(Date.parse(alpenland?.lastActivityAt ?? '')).toBeGreaterThanOrEqual(now - 60_000)
    expect(own).toMatchObject({ memberCount: 3, documentsToday: 0, gln: null })
    expect(other).toMatchObject({ memberCount: 1, pendingInviteCount: 1, lastActivityAt: null })
  })

  it('refuses everyone but the Operator', async () => {
    const response = await api.admin.inject({
      method: operatorWorkspacesEndpoint.method,
      url: operatorWorkspacesEndpoint.path,
    })

    expect(response.statusCode).toBe(403)
  })
})
