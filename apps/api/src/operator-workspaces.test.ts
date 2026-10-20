import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createInviteEndpoint,
  createWorkspaceEndpoint,
  flowsEndpoint,
  glnIssue,
  lookupTablesEndpoint,
  mappingsEndpoint,
  orderLifecyclesEndpoint,
  orderLifecycleListSchema,
  runDetailSchema,
  runEndpoint,
  runListSchema,
  runsEndpoint,
  tradingPartnerSchema,
  tradingPartnersEndpoint,
  type WorkspaceInput,
  type WorkspaceSummary,
  operatorWorkspacesEndpoint,
  toPath,
  workspaceSummarySchema,
} from '@edi-bridge/contracts'
import { acknowledgements, channels, documents, runs } from '@edi-bridge/db'
import { parse, validate } from '@edi-bridge/edifact'

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

const iso7064CheckDigit = (digits: string) => {
  const product = [...digits].reduce((carry, digit) => {
    const sum = (Number(digit) + carry) % 10

    return (2 * (sum === 0 ? 10 : sum)) % 11
  }, 10)

  return (11 - product) % 10
}

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

describe('POST /operator/workspaces with seed', () => {
  let created: WorkspaceSummary

  let admin: Client

  beforeAll(async () => {
    created = await createdWorkspace({ name: 'Talblick Feinkost GmbH', seed: true })
    admin = await memberOf(created.id, 'talblick')
  })

  const restricted = /^02\d{11}$/

  it('marks the Workspace as seeded, with a GLN from the restricted prefixes', () => {
    expect(created).toMatchObject({ seeded: true, kind: 'standard', memberCount: 0 })
    expect(created.gln).toMatch(restricted)
  })

  it('counts a seeded Document of today, whatever the time of day', () => {
    expect(created.documentsToday).toBeGreaterThan(0)
  })

  it('seeds Trading Partners, Lookup Tables, Mappings and Flows', async () => {
    const partners = await read(admin, tradingPartnersEndpoint.path, z.array(tradingPartnerSchema))

    expect(partners.length).toBeGreaterThanOrEqual(2)

    for (const { gln } of partners) {
      expect(gln).toMatch(restricted)
    }

    expect(await read(admin, lookupTablesEndpoint.path, z.array(z.unknown()))).not.toEqual([])
    expect(await read(admin, mappingsEndpoint.path, z.array(z.unknown()))).not.toEqual([])
    expect(await read(admin, flowsEndpoint.path, z.array(z.unknown()))).not.toEqual([])
  })

  it('seeds Runs in end states only, each readable in full', async () => {
    const list = await read(admin, `${runsEndpoint.path}?pageSize=100`, runListSchema)

    expect(list.statusCounts).toMatchObject({ received: 0, processing: 0 })
    expect(list.statusCounts.delivered).toBeGreaterThan(0)
    expect(list.statusCounts.failed).toBeGreaterThan(0)
    expect(list.statusCounts.duplicate).toBeGreaterThan(0)

    for (const { id } of list.runs) {
      await read(admin, toPath(runEndpoint.path, { id }), runDetailSchema)
    }

    const lifecycles = await read(admin, orderLifecyclesEndpoint.path, orderLifecycleListSchema)

    expect(lifecycles.total).toBeGreaterThan(0)
  })

  it('uses GLNs and GTINs from the prefixes 020 to 029 with valid check digits', async () => {
    const db = api.connection.db

    const texts = [
      ...(await db
        .select({ text: documents.content })
        .from(documents)
        .where(eq(documents.workspaceId, created.id))),
      ...(await db
        .select({ text: runs.output })
        .from(runs)
        .where(eq(runs.workspaceId, created.id))),
      ...(await db
        .select({ text: acknowledgements.content })
        .from(acknowledgements)
        .where(eq(acknowledgements.workspaceId, created.id))),
    ].flatMap(({ text }) => (text === null ? [] : [text]))

    const numbers = texts.flatMap((text) => text.match(/(?<!\d)\d{13}(?!\d)/g) ?? [])

    expect(numbers.length).toBeGreaterThan(0)

    for (const number of numbers) {
      expect(number).toMatch(restricted)
      expect(glnIssue(number)).toBeNull()
    }
  })

  it('uses VAT IDs whose check digit fails, so no company holds them', async () => {
    const contents = await api.connection.db
      .select({ text: documents.content })
      .from(documents)
      .where(eq(documents.workspaceId, created.id))

    const vatIds = contents.flatMap(({ text }) => text.match(/DE\d{9}/g) ?? [])

    expect(vatIds.length).toBeGreaterThan(0)

    for (const vatId of vatIds) {
      expect(vatId.at(-1)).not.toBe(String(iso7064CheckDigit(vatId.slice(2, 10))))
    }
  })

  it('writes Interchanges that parse and validate', async () => {
    const db = api.connection.db

    const outputs = await db
      .select({ output: runs.output })
      .from(runs)
      .where(eq(runs.workspaceId, created.id))

    const interchanges = outputs.flatMap(({ output }) =>
      output?.startsWith('UNB') ? [output] : [],
    )

    expect(interchanges.length).toBeGreaterThan(0)

    for (const interchange of interchanges) {
      expect(() => validate(parse(interchange))).not.toThrow()
    }
  })

  it('marks every seeded Channel as seeded, on a reserved .invalid host', async () => {
    const seeded = await api.connection.db
      .select()
      .from(channels)
      .where(eq(channels.workspaceId, created.id))

    expect(seeded.length).toBeGreaterThan(0)

    for (const channel of seeded) {
      expect(channel.seeded).toBe(true)

      const address = channel.host ?? (channel.url === null ? null : new URL(channel.url).hostname)

      if (address !== null) {
        expect(address).toMatch(/\.invalid$/)
      }
    }
  })
})
