import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type Task, tasksEndpoint, tasksSchema } from '@edi-bridge/contracts'
import { documents, flows, runs, tradingPartners } from '@edi-bridge/db'
import { type InvoiceWorkspace, seedInvoiceWorkspace } from '@edi-bridge/pipeline/testing'

import { hourMs } from './duration.js'
import { addMember, type Client, signIn, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let workspace: InvoiceWorkspace

let admin: Client

type RunValues = Partial<typeof runs.$inferInsert> & { receivedAt: Date }

const now = Date.now()

const hoursAgo = (hours: number) => new Date(now - hours * hourMs)

const failure = (failureStage: 'parse' | 'validation' | 'mapping' | 'delivery') => ({
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

const one = async <Row>(rows: Promise<Row[]>) => {
  const [row] = await rows

  if (row === undefined) {
    throw new Error('Insert returned no row')
  }

  return row
}

async function addTradingPartner(target: InvoiceWorkspace, name: string) {
  const db = api.connection.db

  const tradingPartner = await one(
    db
      .insert(tradingPartners)
      .values({
        workspaceId: target.id,
        name,
        characterSet: 'UNOC',
        acknowledgementTimeLimitHours: 24,
      })
      .returning(),
  )

  const flowOf = (messageType: 'ORDERS' | 'INVOIC') =>
    one(
      db
        .insert(flows)
        .values({
          workspaceId: target.id,
          tradingPartnerId: tradingPartner.id,
          messageType,
          name: `${name} ${messageType}`,
          inboundChannelId: target.inboundChannelId,
          destinationChannelId: target.outboundChannelId,
          mappingVersionId: target.mappingVersionId,
        })
        .returning(),
    )

  const orders = await flowOf('ORDERS')
  const invoic = await flowOf('INVOIC')

  const run = async (flow: typeof orders, values: RunValues) => {
    const document = await one(
      db
        .insert(documents)
        .values({
          workspaceId: target.id,
          channelId: target.inboundChannelId,
          fileName: 'message.edi',
          content: 'UNA',
        })
        .returning(),
    )

    return one(
      db
        .insert(runs)
        .values({
          workspaceId: target.id,
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

beforeAll(async () => {
  api = await startTestApi()
  workspace = await seedInvoiceWorkspace(api.connection.db, 'Nordwind Foods')

  const member = {
    name: 'Nordwind Foods admin',
    email: 'admin@nordwind-foods.example',
    password: 'nordwind-foods-admin-password',
    workspaceId: workspace.id,
    role: 'admin' as const,
  }

  await addMember(api.connection.db, member)
  admin = await signIn(api.app, member)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const listed = async (as = admin) => {
  const response = await as.inject({ method: tasksEndpoint.method, url: tasksEndpoint.path })

  expect(response.statusCode).toBe(200)

  return tasksSchema.parse(response.json())
}

const ofTradingPartner = (tasks: readonly Task[], tradingPartnerId: string, kind: Task['kind']) =>
  tasks.filter((task) => task.tradingPartner.id === tradingPartnerId && task.kind === kind)

describe('GET /tasks', () => {
  it('lists the failed Runs of the last 24 hours by who acts, linked to the Run', async () => {
    const partner = await addTradingPartner(workspace, 'Rheinkauf eG')

    const delivery = await partner.invoic({ ...failure('delivery'), receivedAt: hoursAgo(1) })
    const mapping = await partner.orders({ ...failure('mapping'), receivedAt: hoursAgo(2) })
    const inboundParse = await partner.orders({ ...failure('parse'), receivedAt: hoursAgo(3) })

    const outboundValidation = await partner.invoic({
      ...failure('validation'),
      receivedAt: hoursAgo(4),
    })

    const waiting = await partner.orders({
      ...failure('mapping'),
      waitingForTradingPartnerSince: hoursAgo(4),
      receivedAt: hoursAgo(5),
    })

    await partner.orders({ ...failure('mapping'), receivedAt: hoursAgo(25) })
    const reprocessed = await partner.orders({ ...failure('mapping'), receivedAt: hoursAgo(6) })
    await partner.orders({ replacesRunId: reprocessed.id, receivedAt: hoursAgo(5.5) })

    const { tasks } = await listed()

    expect(ofTradingPartner(tasks, partner.tradingPartner.id, 'failedRun')).toEqual([
      {
        id: `run:${delivery.id}`,
        kind: 'failedRun',
        whoActs: 'retry',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(1).toISOString(),
        run: { id: delivery.id, messageType: 'INVOIC', failureStage: 'delivery' },
        target: { kind: 'run', runId: delivery.id },
      },
      {
        id: `run:${mapping.id}`,
        kind: 'failedRun',
        whoActs: 'you',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(2).toISOString(),
        run: { id: mapping.id, messageType: 'ORDERS', failureStage: 'mapping' },
        target: { kind: 'run', runId: mapping.id },
      },
      {
        id: `run:${inboundParse.id}`,
        kind: 'failedRun',
        whoActs: 'tradingPartner',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(3).toISOString(),
        run: { id: inboundParse.id, messageType: 'ORDERS', failureStage: 'parse' },
        target: { kind: 'run', runId: inboundParse.id },
      },
      {
        id: `run:${outboundValidation.id}`,
        kind: 'failedRun',
        whoActs: 'you',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(4).toISOString(),
        run: { id: outboundValidation.id, messageType: 'INVOIC', failureStage: 'validation' },
        target: { kind: 'run', runId: outboundValidation.id },
      },
      {
        id: `run:${waiting.id}`,
        kind: 'failedRun',
        whoActs: 'tradingPartner',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(5).toISOString(),
        run: { id: waiting.id, messageType: 'ORDERS', failureStage: 'mapping' },
        target: { kind: 'run', runId: waiting.id },
      },
    ])
  })

  it('lists the Overdue Acknowledgements, linked to the Interchange', async () => {
    const partner = await addTradingPartner(workspace, 'Ostsee Handel KG')

    const sent = { status: 'delivered' as const, receivedAt: hoursAgo(31) }

    const overdue = await partner.invoic({
      ...sent,
      handedOverAt: hoursAgo(30),
      controlReference: 17,
      acknowledgementState: 'overdue',
    })

    await partner.invoic({
      ...sent,
      handedOverAt: hoursAgo(2),
      controlReference: 18,
      acknowledgementState: 'pending',
    })
    await partner.invoic({
      ...sent,
      handedOverAt: hoursAgo(30),
      controlReference: 19,
      acknowledgementState: 'accepted',
    })

    const { tasks } = await listed()

    expect(ofTradingPartner(tasks, partner.tradingPartner.id, 'overdueAcknowledgement')).toEqual([
      {
        id: `overdue:${overdue.id}`,
        kind: 'overdueAcknowledgement',
        whoActs: 'tradingPartner',
        tradingPartner: partner.tradingPartner,
        at: hoursAgo(6).toISOString(),
        interchange: { id: overdue.id, controlReference: '17' },
        messageType: 'INVOIC',
        sentAt: hoursAgo(30).toISOString(),
        acknowledgementTimeLimitHours: 24,
        target: { kind: 'interchange', controlReference: '17' },
      },
    ])
  })

  it('lists a failing Trading Partner by who acts on most of its failed Runs', async () => {
    const failing = await addTradingPartner(workspace, 'Alpenfrisch Märkte AG')

    await failing.invoic({ receivedAt: hoursAgo(10) })
    await failing.invoic({ ...failure('delivery'), receivedAt: hoursAgo(9) })
    await failing.invoic({ ...failure('delivery'), receivedAt: hoursAgo(8) })
    await failing.orders({ ...failure('mapping'), receivedAt: hoursAgo(7) })
    await failing.orders({ ...failure('mapping'), receivedAt: hoursAgo(30) })
    await failing.orders({ receivedAt: hoursAgo(3) })

    const degraded = await addTradingPartner(workspace, 'Baltic Frische GmbH')

    await degraded.orders({ ...failure('mapping'), receivedAt: hoursAgo(5) })

    for (const hours of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      await degraded.orders({ receivedAt: hoursAgo(hours) })
    }

    const { tasks } = await listed()

    expect(ofTradingPartner(tasks, failing.tradingPartner.id, 'failingTradingPartner')).toEqual([
      {
        id: `tradingPartner:${failing.tradingPartner.id}`,
        kind: 'failingTradingPartner',
        whoActs: 'retry',
        tradingPartner: failing.tradingPartner,
        at: hoursAgo(3).toISOString(),
        delivered: 2,
        failed: 3,
        target: { kind: 'tradingPartner', tradingPartnerId: failing.tradingPartner.id },
      },
    ])
    expect(ofTradingPartner(tasks, degraded.tradingPartner.id, 'failingTradingPartner')).toEqual([])
  })

  it('lists only the tasks of the own Workspace and counts them by who acts', async () => {
    const other = await seedInvoiceWorkspace(api.connection.db, 'Sudhafen Logistik')

    const member = {
      name: 'Sudhafen Logistik admin',
      email: 'admin@sudhafen-logistik.example',
      password: 'sudhafen-logistik-admin-password',
      workspaceId: other.id,
      role: 'admin' as const,
    }

    await addMember(api.connection.db, member)

    const partner = await addTradingPartner(other, 'Elbe Großhandel GmbH')
    const failed = await partner.invoic({ ...failure('delivery'), receivedAt: hoursAgo(1) })

    const { tasks, counts } = await listed(await signIn(api.app, member))

    expect(tasks.map(({ id }) => id)).toEqual([
      `run:${failed.id}`,
      `tradingPartner:${partner.tradingPartner.id}`,
    ])
    expect(counts).toEqual({ you: 0, retry: 2, tradingPartner: 0 })
  })
})
