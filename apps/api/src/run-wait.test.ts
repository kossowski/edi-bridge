import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DeliveryFailed } from '@edi-bridge/channels'
import {
  endWaitingForTradingPartnerRunEndpoint,
  manualSubmissionSchema,
  runDetailSchema,
  runEndpoint,
  submitDocumentEndpoint,
  toPath,
  waitForTradingPartnerRunEndpoint,
} from '@edi-bridge/contracts'
import { runs } from '@edi-bridge/db'
import { type DeliveryService, processRun } from '@edi-bridge/pipeline'
import {
  addOrdersFlow,
  golden,
  goldenInvoice,
  type InvoiceWorkspace,
  pipelineServices,
  seedInvoiceWorkspace,
} from '@edi-bridge/pipeline/testing'

import { markWaitingForTradingPartner } from './run.js'
import { addMember, type Client, signIn, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let workspace: InvoiceWorkspace

let admin: Client

let viewer: Client

beforeAll(async () => {
  api = await startTestApi()
  workspace = await seedInvoiceWorkspace(api.connection.db, 'Nordwind Foods')
  // No inbound Run in these tests reaches the delivery to the ERP.
  await addOrdersFlow(api.connection.db, workspace, { url: 'http://127.0.0.1:9/orders' })

  const member = (role: 'admin' | 'viewer') => ({
    name: `Nordwind Foods ${role}`,
    email: `${role}@nordwind-foods.example`,
    password: `nordwind-foods-${role}-password`,
    workspaceId: workspace.id,
    role,
  })

  await addMember(api.connection.db, member('admin'))
  await addMember(api.connection.db, member('viewer'))
  admin = await signIn(api.app, member('admin'))
  viewer = await signIn(api.app, member('viewer'))
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const ordersInterchange = golden('orders-reference.edi', 'latin1')

const invalidOrders = ordersInterchange.replace("BGM+220:::+128576+9'", "BGM+220:::+128576+99'")

const unreadableOrders = ordersInterchange.replace("UNT+22+ME0001'", "UNT+23+ME0001'")

const delivered: DeliveryService = () => Effect.void

const unreachable: DeliveryService = () =>
  Effect.fail(new DeliveryFailed({ reason: 'hostUnreachable' }))

let submitted = 0

// Each submission is a new Interchange, so a copy of an earlier one is no Duplicate.
const sentAnew = (content: string) => {
  submitted += 1

  return content.replaceAll("+00000001'", `+${String(submitted).padStart(8, '0')}'`)
}

const processed = async (fileName: string, content: string, delivery = delivered) => {
  const response = await admin.inject({
    method: submitDocumentEndpoint.method,
    url: submitDocumentEndpoint.path,
    body: {
      channelId: workspace.inboundChannelId,
      document: { fileName, content: sentAnew(content) },
    },
  })

  expect(response.statusCode, response.body).toBe(201)

  for (const queued of api.runQueue.queued.splice(0)) {
    await Effect.runPromise(
      processRun(queued).pipe(pipelineServices(api.connection.db, api.runQueue, delivery)),
    )
  }

  const [run] = manualSubmissionSchema.parse(response.json()).runs

  if (!run) {
    throw new Error(`The submission of ${fileName} created no Run`)
  }

  return run.id
}

const markWaiting = (id: string, as = admin) =>
  as.inject({
    method: waitForTradingPartnerRunEndpoint.method,
    url: toPath(waitForTradingPartnerRunEndpoint.path, { id }),
  })

const endWaiting = (id: string, as = admin) =>
  as.inject({
    method: endWaitingForTradingPartnerRunEndpoint.method,
    url: toPath(endWaitingForTradingPartnerRunEndpoint.path, { id }),
  })

const detail = async (id: string) => {
  const response = await admin.inject({ method: 'GET', url: toPath(runEndpoint.path, { id }) })

  expect(response.statusCode, response.body).toBe(200)

  return runDetailSchema.parse(response.json())
}

describe('a failed inbound Run', () => {
  it('awaits a resend from the Trading Partner after a parse failure', async () => {
    const id = await processed('orders.edi', unreadableOrders)

    await expect(detail(id)).resolves.toMatchObject({
      status: 'failed',
      direction: 'inbound',
      failureStage: 'parse',
      problem: {
        whoFixes: 'tradingPartner',
        fixTarget: { kind: 'tradingPartner', tradingPartnerId: workspace.tradingPartnerId },
      },
      waitingForTradingPartnerSince: null,
    })
  })

  it('awaits a resend from the Trading Partner after a validation failure', async () => {
    const id = await processed('orders.edi', invalidOrders)

    await expect(detail(id)).resolves.toMatchObject({
      status: 'failed',
      direction: 'inbound',
      failureStage: 'validation',
      problem: {
        whoFixes: 'tradingPartner',
        fixTarget: { kind: 'tradingPartner', tradingPartnerId: workspace.tradingPartnerId },
      },
      waitingForTradingPartnerSince: null,
    })
  })
})

// The live events published for the Run since the given count of them.
const announcedSince = (id: string, count = 0) =>
  api.liveEvents.published.filter(({ event }) => event.run.id === id).slice(count)

describe('POST /runs/:id/wait-for-trading-partner', () => {
  it('announces the change of the marked Run to its Workspace', async () => {
    const id = await processed('orders.edi', invalidOrders)
    const count = announcedSince(id).length

    await markWaiting(id)

    expect(announcedSince(id, count)).toEqual([
      {
        workspaceId: workspace.id,
        event: { type: 'run.changed', run: expect.objectContaining({ id, status: 'failed' }) },
      },
    ])
  })

  it('marks a Run that the Trading Partner fixes as waiting for the Trading Partner', async () => {
    const id = await processed('orders.edi', invalidOrders)
    const before = Date.now()

    const response = await markWaiting(id)

    expect(response.statusCode, response.body).toBe(200)

    const marked = runDetailSchema.parse(response.json())
    const since = Date.parse(marked.waitingForTradingPartnerSince ?? '')

    expect(marked).toMatchObject({ id, status: 'failed', failureStage: 'validation' })
    expect(since).toBeGreaterThanOrEqual(before - 1000)
    expect(since).toBeLessThanOrEqual(Date.now() + 1000)
    await expect(detail(id)).resolves.toEqual(marked)
  })

  it('keeps the time of the first mark when the Run is marked again', async () => {
    const id = await processed('orders.edi', unreadableOrders)

    const first = runDetailSchema.parse((await markWaiting(id)).json())
    const again = await markWaiting(id)

    expect(again.statusCode, again.body).toBe(200)
    expect(runDetailSchema.parse(again.json()).waitingForTradingPartnerSince).toBe(
      first.waitingForTradingPartnerSince,
    )
  })

  it('leaves a Run unmarked that is no longer failed when the mark is written', async () => {
    const id = await processed('orders.edi', invalidOrders)
    // A Retry claims the Run between the read and the write of the mark.
    await api.connection.db
      .update(runs)
      .set({ status: 'processing', failureStage: null, error: null, problem: null })
      .where(eq(runs.id, id))

    await expect(markWaitingForTradingPartner(api.connection.db, workspace.id, id)).resolves.toBe(
      false,
    )

    const [row] = await api.connection.db
      .select({ since: runs.waitingForTradingPartnerSince })
      .from(runs)
      .where(eq(runs.id, id))

    expect(row).toEqual({ since: null })
  })

  it('answers 409 for a Run that the Workspace fixes and leaves it unmarked', async () => {
    const id = await processed('invoice.json', 'not json')

    const response = await markWaiting(id)

    expect(response.statusCode, response.body).toBe(409)
    await expect(detail(id)).resolves.toMatchObject({
      status: 'failed',
      problem: { whoFixes: 'you' },
      waitingForTradingPartnerSince: null,
    })
  })

  it('answers 409 for a Run that failed at delivery and leaves it unmarked', async () => {
    const id = await processed('invoice.json', goldenInvoice, unreachable)

    const response = await markWaiting(id)

    expect(response.statusCode, response.body).toBe(409)
    await expect(detail(id)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'delivery',
      problem: { whoFixes: 'retry' },
      waitingForTradingPartnerSince: null,
    })
  })

  it('answers 409 for a delivered Run', async () => {
    const id = await processed('invoice.json', goldenInvoice)

    const response = await markWaiting(id)

    expect(response.statusCode, response.body).toBe(409)
    await expect(detail(id)).resolves.toMatchObject({ status: 'delivered' })
  })

  it('answers 409 for a Run that a resend replaces and leaves it unmarked', async () => {
    const id = await processed('orders.edi', invalidOrders)
    const resend = await processed('orders.edi', ordersInterchange)

    const response = await markWaiting(id)

    expect(response.statusCode, response.body).toBe(409)
    await expect(detail(id)).resolves.toMatchObject({
      replacedBy: { id: resend },
      waitingForTradingPartnerSince: null,
    })
  })

  it('answers 403 to a Viewer and leaves the Run unmarked', async () => {
    const id = await processed('orders.edi', invalidOrders)

    const response = await markWaiting(id, viewer)

    expect(response.statusCode).toBe(403)
    await expect(detail(id)).resolves.toMatchObject({ waitingForTradingPartnerSince: null })
  })

  it('answers 404 for a Run of another Workspace and leaves it unmarked', async () => {
    const id = await processed('orders.edi', invalidOrders)

    const response = await markWaiting(id, api.admin)

    expect(response.statusCode).toBe(404)
    await expect(detail(id)).resolves.toMatchObject({ waitingForTradingPartnerSince: null })
  })

  it('answers 404 for an unknown Run', async () => {
    const response = await markWaiting(crypto.randomUUID())

    expect(response.statusCode).toBe(404)
  })
})

describe('DELETE /runs/:id/wait-for-trading-partner', () => {
  it('announces the change of the Run whose wait ended to its Workspace', async () => {
    const id = await processed('orders.edi', invalidOrders)

    await markWaiting(id)

    const count = announcedSince(id).length

    await endWaiting(id)

    expect(announcedSince(id, count)).toEqual([
      {
        workspaceId: workspace.id,
        event: { type: 'run.changed', run: expect.objectContaining({ id, status: 'failed' }) },
      },
    ])
  })

  it('ends the mark of a waiting Run', async () => {
    const id = await processed('orders.edi', invalidOrders)
    await markWaiting(id)

    const response = await endWaiting(id)

    expect(response.statusCode, response.body).toBe(200)

    const ended = runDetailSchema.parse(response.json())

    expect(ended).toMatchObject({ id, status: 'failed', waitingForTradingPartnerSince: null })
    await expect(detail(id)).resolves.toEqual(ended)
  })

  it('answers 409 for a Run that is not marked', async () => {
    const id = await processed('orders.edi', unreadableOrders)

    const response = await endWaiting(id)

    expect(response.statusCode, response.body).toBe(409)
  })

  it('answers 403 to a Viewer and keeps the mark', async () => {
    const id = await processed('orders.edi', invalidOrders)
    const marked = runDetailSchema.parse((await markWaiting(id)).json())

    const response = await endWaiting(id, viewer)

    expect(response.statusCode).toBe(403)
    await expect(detail(id)).resolves.toMatchObject({
      waitingForTradingPartnerSince: marked.waitingForTradingPartnerSince,
    })
  })

  it('answers 404 for a Run of another Workspace and keeps the mark', async () => {
    const id = await processed('orders.edi', invalidOrders)
    const marked = runDetailSchema.parse((await markWaiting(id)).json())

    const response = await endWaiting(id, api.admin)

    expect(response.statusCode).toBe(404)
    await expect(detail(id)).resolves.toMatchObject({
      waitingForTradingPartnerSince: marked.waitingForTradingPartnerSince,
    })
  })

  it('answers 404 for an unknown Run', async () => {
    const response = await endWaiting(crypto.randomUUID())

    expect(response.statusCode).toBe(404)
  })
})
