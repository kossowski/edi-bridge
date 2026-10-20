import { and, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { secretBox } from '@edi-bridge/channels'
import {
  createTradingPartnerEndpoint,
  resetSandboxWorkspaceEndpoint,
  sessionEndpoint,
  toPath,
  workspaceSummarySchema,
} from '@edi-bridge/contracts'
import { documents, invites, runs, tradingPartners, users, workspaces } from '@edi-bridge/db'
import { processRun } from '@edi-bridge/pipeline'
import { pipelineServices } from '@edi-bridge/pipeline/testing'

import { resetSandbox } from './sandbox-reset.js'
import { ensureShowcaseAndSandbox, showcaseAdmin } from './showcase-and-sandbox.js'
import {
  addMember,
  addTradingPartnerWithFlows,
  type Client,
  one,
  otherWorkspace,
  ownOperator,
  ownWorkspace,
  seedWorkspaceWithAdmin,
  signIn,
  startTestApi,
  type TestApi,
  testChannels,
} from './testing.js'

let api: TestApi

let operator: Client

let sandboxAdmin: Client

let standardId: string

const adminPassword = 'sandbox-admin-password'

const secrets = secretBox(testChannels.secretKey)

const idOf = async (kind: 'showcase' | 'sandbox') =>
  (
    await one(
      api.connection.db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.kind, kind)),
    )
  ).id

const scopedTables = [
  'acknowledgements',
  'ai_token_usage',
  'channels',
  'document_structures',
  'documents',
  'flows',
  'invites',
  'lookup_tables',
  'mappings',
  'members',
  'runs',
  'trading_partners',
]

const childTables = [
  { table: 'lookup_table_entries', column: 'lookup_table_id', parent: 'lookup_tables' },
  { table: 'mapping_versions', column: 'mapping_id', parent: 'mappings' },
  { table: 'run_steps', column: 'run_id', parent: 'runs' },
]

const rowsOf = async (from: string, workspaceId: string) => {
  const [row] = await api.connection.db.execute<{ rows: unknown[] }>(
    sql`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') as rows from ${sql.raw(from)} where t.workspace_id = ${workspaceId}`,
  )

  return row?.rows ?? []
}

const snapshot = async (workspaceId: string) => {
  const sources = [
    ['workspaces', '(select *, id as workspace_id from workspaces) t'],
    ...scopedTables.map((table) => [table, `${table} t`]),
    ...childTables.map(({ table, column, parent }) => [
      table,
      `(select c.*, p.workspace_id from ${table} c join ${parent} p on p.id = c.${column}) t`,
    ]),
  ] as const

  return Object.fromEntries(
    await Promise.all(
      sources.map(async ([table, from]) => [table, await rowsOf(from, workspaceId)] as const),
    ),
  )
}

const countsOf = (tables: Record<string, unknown[]>) =>
  Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]))

const reset = (client: Client, workspaceId: string) =>
  client.inject({
    method: resetSandboxWorkspaceEndpoint.method,
    url: toPath(resetSandboxWorkspaceEndpoint.path, { workspaceId }),
  })

beforeAll(async () => {
  api = await startTestApi()
  await addMember(api.connection.db, ownOperator)
  operator = await signIn(api.app, ownOperator)

  await ensureShowcaseAndSandbox(api.connection.db, { secrets, adminPassword })
  sandboxAdmin = await signIn(api.app, { email: showcaseAdmin.email, password: adminPassword })

  // A standard Workspace with traffic of its own, so a reset that reaches it shows.
  const { workspace } = await seedWorkspaceWithAdmin(api, 'Alpenland Getränke GmbH')
  const partner = await addTradingPartnerWithFlows(api.connection.db, workspace, 'Rheinkauf eG')

  standardId = workspace.id

  await partner.orders({ receivedAt: new Date() })
}, 60_000)

afterAll(async () => {
  await api.stop()
})

describe('the tables a reset covers', () => {
  it('include every table with Workspace data', async () => {
    const found = await api.connection.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'workspace_id' order by table_name`,
    )

    expect(found.map(({ table_name }) => table_name)).toEqual(scopedTables)
  })
})

describe('POST /operator/workspaces/:workspaceId/reset', () => {
  it('restores the seed of the Sandbox and touches no other Workspace', async () => {
    const sandboxId = await idOf('sandbox')
    const showcaseId = await idOf('showcase')
    const seeded = countsOf(await snapshot(sandboxId))

    // What an Admin changed in the Sandbox, and what the Operator set, before the reset.
    const created = await sandboxAdmin.inject({
      method: createTradingPartnerEndpoint.method,
      url: createTradingPartnerEndpoint.path,
      body: {
        name: 'Besucher GmbH',
        gln: null,
        characterSet: 'UNOC',
        acknowledgementTimeLimitHours: 24,
      },
    })

    expect(created.statusCode, created.body).toBe(201)

    await api.connection.db.delete(runs).where(eq(runs.workspaceId, sandboxId))
    await api.connection.db
      .update(workspaces)
      .set({ gln: '4012345000009', documentRetentionDays: 30, aiDailyTokenLimit: 50_000 })
      .where(eq(workspaces.id, sandboxId))
    await api.connection.db.insert(invites).values({
      workspaceId: sandboxId,
      email: 'besucher@sandbox.example',
      role: 'viewer',
      token: 'sandbox-invite-token',
      expiresAt: new Date(Date.now() + 86_400_000),
    })

    const sandboxBefore = await snapshot(sandboxId)
    const others = [showcaseId, standardId, ownWorkspace.id, otherWorkspace.id]
    const othersBefore = await Promise.all(others.map(snapshot))

    const response = await reset(operator, sandboxId)

    expect(response.statusCode, response.body).toBe(200)

    const summary = workspaceSummarySchema.parse(response.json())

    expect(summary).toMatchObject({ id: sandboxId, kind: 'sandbox', seeded: true, memberCount: 1 })
    expect(summary.lastResetAt).not.toBeNull()

    expect(await Promise.all(others.map(snapshot))).toEqual(othersBefore)

    const sandboxAfter = await snapshot(sandboxId)

    expect(countsOf(sandboxAfter)).toEqual({ ...seeded, invites: 1 })
    expect(sandboxAfter.members).toEqual(sandboxBefore.members)
    expect(sandboxAfter.invites).toEqual(sandboxBefore.invites)
    expect(sandboxAfter.trading_partners).not.toContainEqual(
      expect.objectContaining({ name: 'Besucher GmbH' }),
    )

    const [workspace] = await api.connection.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, sandboxId))

    expect(workspace).toMatchObject({
      name: 'Kranichsee Getränke GmbH',
      kind: 'sandbox',
      seeded: true,
      documentRetentionDays: 30,
      aiDailyTokenLimit: 50_000,
    })
    expect(workspace?.gln).not.toBe('4012345000009')
    expect(workspace?.lastResetAt?.toISOString()).toBe(summary.lastResetAt)
  })

  it('keeps the seed publisher and the sessions of the Sandbox', async () => {
    await reset(operator, await idOf('sandbox'))

    const publishers = await api.connection.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'seed@edi-bridge.invalid'))

    expect(publishers).toHaveLength(1)

    const session = await sandboxAdmin.inject({ method: 'GET', url: sessionEndpoint.path })

    expect(session.statusCode).toBe(200)
  })

  it('refuses to reset a Workspace that is not the Sandbox', async () => {
    for (const workspaceId of [await idOf('showcase'), standardId]) {
      const response = await reset(operator, workspaceId)

      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ message: 'Only the Sandbox Workspace can be reset' })
    }
  })

  it('answers 404 for a Workspace that does not exist', async () => {
    for (const workspaceId of ['00000000-0000-4000-8000-000000000000', 'not-an-id']) {
      const response = await reset(operator, workspaceId)

      expect(response.statusCode).toBe(404)
    }
  })

  it('refuses everyone but the Operator', async () => {
    const sandboxId = await idOf('sandbox')

    expect((await reset(sandboxAdmin, sandboxId)).statusCode).toBe(403)
    expect((await reset(api.app, sandboxId)).statusCode).toBe(401)
  })
})

describe('a Run queued before the reset', () => {
  it('is dropped by the worker without bringing data back', async () => {
    const sandboxId = await idOf('sandbox')
    const { db } = api.connection

    const [seededRun] = await db
      .select({
        flowId: runs.flowId,
        tradingPartnerId: runs.tradingPartnerId,
        documentId: runs.documentId,
      })
      .from(runs)
      .innerJoin(documents, eq(documents.id, runs.documentId))
      .where(eq(runs.workspaceId, sandboxId))
      .limit(1)

    if (seededRun === undefined) {
      throw new Error('The Sandbox has no seeded Run')
    }

    const queued = await one(
      db
        .insert(runs)
        .values({ workspaceId: sandboxId, ...seededRun, manualSubmission: true })
        .returning({ id: runs.id }),
    )

    expect(await resetSandbox(db, sandboxId, { secrets })).toBe('reset')

    await Effect.runPromise(
      processRun({ workspaceId: sandboxId, runId: queued.id }).pipe(
        pipelineServices(db, api.runQueue),
      ),
    )

    expect(await db.select().from(runs).where(eq(runs.id, queued.id))).toEqual([])
    expect(
      await db
        .select({ id: tradingPartners.id })
        .from(tradingPartners)
        .where(
          and(
            eq(tradingPartners.workspaceId, sandboxId),
            eq(tradingPartners.id, seededRun.tradingPartnerId),
          ),
        ),
    ).toEqual([])
  })
})
