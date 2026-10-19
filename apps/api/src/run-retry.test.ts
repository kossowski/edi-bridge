import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DeliveryFailed } from '@edi-bridge/channels'
import {
  manualSubmissionSchema,
  retryRunEndpoint,
  runDetailSchema,
  runEndpoint,
  submitDocumentEndpoint,
  toPath,
} from '@edi-bridge/contracts'
import { type DeliveryService, processRun } from '@edi-bridge/pipeline'
import {
  goldenInvoice,
  type InvoiceWorkspace,
  pipelineServices,
  seedInvoiceWorkspace,
} from '@edi-bridge/pipeline/testing'

import { addMember, type Client, signIn, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let workspace: InvoiceWorkspace

let admin: Client

let viewer: Client

beforeAll(async () => {
  api = await startTestApi()
  workspace = await seedInvoiceWorkspace(api.connection.db, 'Nordwind Foods')

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

const unreachable: DeliveryService = () =>
  Effect.fail(new DeliveryFailed({ reason: 'hostUnreachable' }))

const processQueued = async (delivery: DeliveryService) => {
  for (const queued of api.runQueue.queued.splice(0)) {
    await Effect.runPromise(
      processRun(queued).pipe(pipelineServices(api.connection.db, api.runQueue, delivery)),
    )
  }
}

const processed = async (content: string, delivery: DeliveryService) => {
  const response = await admin.inject({
    method: submitDocumentEndpoint.method,
    url: submitDocumentEndpoint.path,
    body: {
      channelId: workspace.inboundChannelId,
      document: { fileName: 'invoice.json', content },
    },
  })

  expect(response.statusCode, response.body).toBe(201)

  await processQueued(delivery)

  return manualSubmissionSchema.parse(response.json()).runs[0]?.id ?? ''
}

const retry = (id: string, as = admin) =>
  as.inject({ method: retryRunEndpoint.method, url: toPath(retryRunEndpoint.path, { id }) })

const detail = async (id: string) => {
  const response = await admin.inject({ method: 'GET', url: toPath(runEndpoint.path, { id }) })

  expect(response.statusCode, response.body).toBe(200)

  return runDetailSchema.parse(response.json())
}

describe('POST /runs/:id/retry', () => {
  it('queues a Run that failed at delivery to repeat only its delivery', async () => {
    const id = await processed(goldenInvoice, unreachable)

    const response = await retry(id)

    expect(response.statusCode, response.body).toBe(200)
    expect(runDetailSchema.parse(response.json())).toMatchObject({
      id,
      status: 'received',
      failureStage: null,
      error: null,
      problem: null,
      mappingVersion: { id: workspace.mappingVersionId },
    })
    expect(api.runQueue.queued).toEqual([{ workspaceId: workspace.id, runId: id }])

    await processQueued(() => Effect.void)

    const run = await detail(id)

    expect(run).toMatchObject({ status: 'delivered', failureStage: null })
    expect(run.steps.map(({ stage, status }) => [stage, status])).toEqual([
      ['receipt', 'succeeded'],
      ['mapping', 'succeeded'],
      ['validation', 'succeeded'],
      ['delivery', 'succeeded'],
    ])
  })

  it('answers 409 for a Run that failed before delivery and leaves it failed', async () => {
    const id = await processed('not json', unreachable)

    const response = await retry(id)

    expect(response.statusCode, response.body).toBe(409)
    expect(api.runQueue.queued).toEqual([])
    await expect(detail(id)).resolves.toMatchObject({ status: 'failed', failureStage: 'mapping' })
  })

  it('answers 409 for a delivered Run', async () => {
    const id = await processed(goldenInvoice, () => Effect.void)

    const response = await retry(id)

    expect(response.statusCode, response.body).toBe(409)
    await expect(detail(id)).resolves.toMatchObject({ status: 'delivered' })
  })

  it('answers 403 to a Viewer and leaves the Run failed', async () => {
    const id = await processed(goldenInvoice, unreachable)

    const response = await retry(id, viewer)

    expect(response.statusCode).toBe(403)
    await expect(detail(id)).resolves.toMatchObject({ status: 'failed', failureStage: 'delivery' })
  })

  it('answers 404 for a Run of another Workspace and leaves it failed', async () => {
    const id = await processed(goldenInvoice, unreachable)

    const response = await retry(id, api.admin)

    expect(response.statusCode).toBe(404)
    await expect(detail(id)).resolves.toMatchObject({ status: 'failed', failureStage: 'delivery' })
  })

  it('answers 404 for an unknown Run', async () => {
    const response = await retry(crypto.randomUUID())

    expect(response.statusCode).toBe(404)
  })
})
