import { hashPassword } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import type { LanguageModel } from 'ai'
import type { FastifyServerOptions, InjectOptions, LightMyRequestResponse } from 'fastify'

import { secretKeyBytes } from '@edi-bridge/channels'
import { signInEndpoint, type WorkspaceRole } from '@edi-bridge/contracts'
import {
  connect,
  documents,
  flows,
  members,
  runs,
  tradingPartners,
  workspaces,
} from '@edi-bridge/db'
import { startTestDatabase } from '@edi-bridge/db/testing'
import { type QueuedRun, RunNotQueued, type RunQueueService } from '@edi-bridge/pipeline'
import { type InvoiceWorkspace, seedInvoiceWorkspace } from '@edi-bridge/pipeline/testing'

import { utcDay } from './ai-budget.js'
import { buildApp } from './app.js'
import { developmentWorkspace } from './development-workspace.js'
import { addUser, storePassword } from './user.js'
import { memoryWebhookRateLimiter } from './webhook-rate-limit.js'

import type { AuthSettings } from './auth.js'
import type { ChannelSettings } from './channel.js'
import type { Database } from './db.js'

export const ownWorkspace = { ...developmentWorkspace, gln: null }

export const otherWorkspace = {
  id: '8b2d6e14-3f9a-4c57-a0d8-71e5b9c4f236',
  name: 'Sudhafen Logistik AG',
  gln: null,
}

export const today = () => utcDay(Date.now())

export const webOrigin = 'http://localhost:3000'

export const testAuth: AuthSettings = {
  secret: 'test-secret-that-is-at-least-32-characters-long',
  baseUrl: 'http://localhost:3001',
  trustedOrigins: [webOrigin],
}

export const testChannels: ChannelSettings = {
  secretKey: Buffer.alloc(secretKeyBytes, 'test-channel-secret-key'),
  apiPublicUrl: 'http://localhost:3001',
  reachTimeoutMs: 1500,
}

const up = () => Promise.resolve()

export function testRunQueue() {
  const queued: QueuedRun[] = []
  const redis = { reachable: true }

  const service: RunQueueService = {
    enqueue: (run) =>
      redis.reachable
        ? Effect.sync(() => void queued.push(run))
        : Effect.fail(new RunNotQueued({ runId: run.runId, cause: 'unreachable' })),
  }

  return { queued, redis, service }
}

export interface Credentials {
  email: string
  password: string
}

export interface Client {
  inject: (options: InjectOptions) => Promise<LightMyRequestResponse>
}

export interface NewMember extends Credentials {
  name: string
  workspaceId: string
  role: WorkspaceRole
  operator?: boolean
}

export async function addMember(database: Database, member: NewMember) {
  const userId = await addUser(database, {
    name: member.name,
    email: member.email,
    operator: member.operator ?? false,
  })

  await storePassword(database, userId, await hashPassword(member.password))
  await database
    .insert(members)
    .values({ userId, workspaceId: member.workspaceId, role: member.role })

  return userId
}

// The nightly deletion of a Document, for a Run whose Document expired.
export const documentDeletedAt = new Date('2026-09-01T02:00:00.000Z')

// Leaves the Run as the retention sweep leaves it once its Document expired.
export async function expireDocumentOf(database: Database, runId: string) {
  const [run] = await database
    .select({ documentId: runs.documentId })
    .from(runs)
    .where(eq(runs.id, runId))

  if (run === undefined || run.documentId === null) {
    throw new Error(`Run ${runId} has no Document to expire`)
  }

  await database
    .update(runs)
    .set({ documentId: null, documentDeletedAt })
    .where(eq(runs.documentId, run.documentId))
  await database.delete(documents).where(eq(documents.id, run.documentId))
}

export const failedRun = (failureStage: 'parse' | 'validation' | 'mapping' | 'delivery') => ({
  status: 'failed' as const,
  failureStage,
  error: {
    code: 'processingDefect',
    message: 'The processing failed',
    position: null,
    details: null,
  },
  problem: { reason: 'defect' as const, fixTarget: null },
})

type RunValues = Partial<typeof runs.$inferInsert> & { receivedAt: Date }

const one = async <Row>(rows: Promise<Row[]>) => {
  const [row] = await rows

  if (row === undefined) {
    throw new Error('Insert returned no row')
  }

  return row
}

// A Trading Partner with an ORDERS and an INVOIC Flow, to add Runs to.
export async function addTradingPartnerWithFlows(
  database: Database,
  workspace: InvoiceWorkspace,
  name: string,
) {
  const tradingPartner = await one(
    database
      .insert(tradingPartners)
      .values({
        workspaceId: workspace.id,
        name,
        characterSet: 'UNOC',
        acknowledgementTimeLimitHours: 24,
      })
      .returning(),
  )

  const flowOf = (messageType: 'ORDERS' | 'INVOIC') =>
    one(
      database
        .insert(flows)
        .values({
          workspaceId: workspace.id,
          tradingPartnerId: tradingPartner.id,
          messageType,
          name: `${name} ${messageType}`,
          inboundChannelId: workspace.inboundChannelId,
          destinationChannelId: workspace.outboundChannelId,
          mappingVersionId: workspace.mappingVersionId,
        })
        .returning(),
    )

  const orders = await flowOf('ORDERS')
  const invoic = await flowOf('INVOIC')

  const run = async (flow: typeof orders, values: RunValues) => {
    const document = await one(
      database
        .insert(documents)
        .values({
          workspaceId: workspace.id,
          channelId: workspace.inboundChannelId,
          fileName: 'message.edi',
          content: 'UNA',
        })
        .returning(),
    )

    return one(
      database
        .insert(runs)
        .values({
          workspaceId: workspace.id,
          documentId: document.id,
          flowId: flow.id,
          tradingPartnerId: tradingPartner.id,
          manualSubmission: false,
          status: 'delivered',
          ...values,
        })
        .returning(),
    )
  }

  return {
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
    orders: (values: RunValues) => run(orders, values),
    invoic: (values: RunValues) => run(invoic, values),
  }
}

// A seeded Workspace of its own, so its numbers stay apart from other tests.
export async function seedWorkspaceWithAdmin(
  api: { app: Client; connection: { db: Database } },
  name: string,
) {
  const workspace = await seedInvoiceWorkspace(api.connection.db, name)
  const slug = name.toLowerCase().replaceAll(' ', '-')

  const member = {
    name: `${name} admin`,
    email: `admin@${slug}.example`,
    password: `${slug}-admin-password`,
    workspaceId: workspace.id,
    role: 'admin' as const,
  }

  await addMember(api.connection.db, member)

  return { workspace, admin: await signIn(api.app, member) }
}

export const signInRequest = ({ email, password }: Credentials): InjectOptions => ({
  method: 'POST',
  url: signInEndpoint.path,
  headers: { origin: webOrigin },
  body: { email, password },
})

export async function signIn(app: Client, credentials: Credentials): Promise<Client> {
  const response = await app.inject(signInRequest(credentials))

  if (response.statusCode !== 200) {
    throw new Error(`Sign-in failed with status ${response.statusCode}: ${response.body}`)
  }

  const cookie = response.cookies.map(({ name, value }) => `${name}=${value}`).join('; ')

  return {
    inject: (options) =>
      app.inject({ ...options, headers: { origin: webOrigin, ...options.headers, cookie } }),
  }
}

export const ownAdmin: NewMember = {
  name: 'Nordwind Admin',
  email: 'admin@nordwind.example',
  password: 'nordwind-admin-password',
  workspaceId: ownWorkspace.id,
  role: 'admin',
}

export const ownViewer: NewMember = {
  name: 'Nordwind Viewer',
  email: 'viewer@nordwind.example',
  password: 'nordwind-viewer-password',
  workspaceId: ownWorkspace.id,
  role: 'viewer',
}

export const otherAdmin: NewMember = {
  name: 'Sudhafen Admin',
  email: 'admin@sudhafen.example',
  password: 'sudhafen-admin-password',
  workspaceId: otherWorkspace.id,
  role: 'admin',
}

export const ownOperator: NewMember = {
  name: 'Platform Operator',
  email: 'operator@platform.example',
  password: 'platform-operator-password',
  workspaceId: ownWorkspace.id,
  role: 'viewer',
  operator: true,
}

export async function startTestApi({
  aiModel = null,
  logger = false,
}: { aiModel?: LanguageModel | null; logger?: FastifyServerOptions['logger'] } = {}) {
  const testDatabase = await startTestDatabase()
  const connection = connect(testDatabase.url)

  await connection.db.insert(workspaces).values([ownWorkspace, otherWorkspace])
  await addMember(connection.db, ownAdmin)
  await addMember(connection.db, ownViewer)
  await addMember(connection.db, otherAdmin)

  const runQueue = testRunQueue()

  const app = buildApp({
    aiModel,
    auth: testAuth,
    channels: testChannels,
    database: connection.db,
    logger,
    probes: { postgres: up, redis: up },
    runQueue: runQueue.service,
    webOrigin,
    webhookRateLimiter: memoryWebhookRateLimiter(),
  })

  return {
    app,
    connection,
    runQueue,
    databaseUrl: testDatabase.url,
    admin: await signIn(app, ownAdmin),
    viewer: await signIn(app, ownViewer),
    otherAdmin: await signIn(app, otherAdmin),
    stop: async () => {
      await app.close()
      await connection.close()
      await testDatabase.stop()
    },
  }
}

export type TestApi = Awaited<ReturnType<typeof startTestApi>>
