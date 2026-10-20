import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createInviteEndpoint,
  createWorkspaceEndpoint,
  tradingPartnersEndpoint,
  type WorkspaceInput,
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

const createWorkspace = (client: Client, body: WorkspaceInput) =>
  client.inject({
    method: createWorkspaceEndpoint.method,
    url: createWorkspaceEndpoint.path,
    body,
  })

const createdWorkspace = async (body: WorkspaceInput) => {
  const response = await createWorkspace(operator, body)

  expect(response.statusCode, response.body).toBe(201)

  return workspaceSummarySchema.parse(response.json())
}

// A Member of the new Workspace, to read its data through the API.
const memberOf = async (workspaceId: string, slug: string) => {
  const member = {
    name: `${slug} admin`,
    email: `admin@${slug}.example`,
    password: `${slug}-admin-password`,
    workspaceId,
    role: 'admin' as const,
  }

  await addMember(api.connection.db, member)

  return signIn(api.app, member)
}

const read = async <A>(client: Client, url: string, schema: z.ZodType<A>) => {
  const response = await client.inject({ method: 'GET', url })

  expect(response.statusCode, response.body).toBe(200)

  return schema.parse(response.json())
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

describe('POST /operator/workspaces', () => {
  it('creates an empty Workspace without seed', async () => {
    const created = await createdWorkspace({ name: '  Weserland Mühle KG ', seed: false })

    expect(created).toMatchObject({
      name: 'Weserland Mühle KG',
      gln: null,
      kind: 'standard',
      seeded: false,
      memberCount: 0,
      pendingInviteCount: 0,
      documentsToday: 0,
      lastActivityAt: null,
      lastResetAt: null,
    })
    expect((await listWorkspaces(operator)).map(({ id }) => id)).toContain(created.id)

    const admin = await memberOf(created.id, 'weserland')

    expect(await read(admin, tradingPartnersEndpoint.path, z.array(z.unknown()))).toEqual([])
  })

  it('refuses a name another Workspace uses, ignoring case', async () => {
    const response = await createWorkspace(operator, {
      name: ownWorkspace.name.toUpperCase(),
      seed: false,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ message: 'Another Workspace already uses this name' })
  })

  it('refuses a blank name', async () => {
    const response = await createWorkspace(operator, { name: '   ', seed: false })

    expect(response.statusCode).toBe(400)
  })

  it('refuses everyone but the Operator', async () => {
    const response = await createWorkspace(api.admin, { name: 'Admin Workspace', seed: false })

    expect(response.statusCode).toBe(403)
  })
})
