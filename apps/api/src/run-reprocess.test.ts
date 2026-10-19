import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { DeliveryFailed } from '@edi-bridge/channels'
import {
  manualSubmissionSchema,
  reprocessRunEndpoint,
  runDetailSchema,
  runEndpoint,
  submitDocumentEndpoint,
  toPath,
} from '@edi-bridge/contracts'
import { lookupTableEntries, lookupTables, mappingVersions } from '@edi-bridge/db'
import { type DeliveryService, processRun } from '@edi-bridge/pipeline'
import {
  goldenInvoice,
  type InvoiceWorkspace,
  pipelineServices,
  readRun,
  seedInvoiceWorkspace,
} from '@edi-bridge/pipeline/testing'

import { addMember, type Client, signIn, startTestApi, type TestApi } from './testing.js'

let api: TestApi

let workspace: InvoiceWorkspace

let admin: Client

let viewer: Client

// Version 2 of the Mapping translates the unit KG, which version 1 is missing.
let translatingVersionId: string

let otherWorkspace: InvoiceWorkspace

const one = <A>([row]: A[]) => {
  if (row === undefined) {
    throw new Error('Insert returned no row')
  }

  return row
}

beforeAll(async () => {
  api = await startTestApi()
  workspace = await seedInvoiceWorkspace(api.connection.db, 'Nordwind Foods')
  otherWorkspace = await seedInvoiceWorkspace(api.connection.db, 'Hanse Retail')

  const db = api.connection.db

  const units = one(
    await db
      .insert(lookupTables)
      .values({ workspaceId: workspace.id, name: 'Units with kilograms', kind: 'units' })
      .returning(),
  )

  await db.insert(lookupTableEntries).values([
    { lookupTableId: units.id, position: 0, sourceCode: 'ST', targetCode: 'PCE' },
    { lookupTableId: units.id, position: 1, sourceCode: 'KG', targetCode: 'KGM' },
  ])

  const first = one(
    await db
      .select()
      .from(mappingVersions)
      .where(eq(mappingVersions.id, workspace.mappingVersionId)),
  )

  const translating = one(
    await db
      .insert(mappingVersions)
      .values({
        mappingId: workspace.mappingId,
        version: 2,
        graph: {
          ...first.graph,
          transforms: first.graph.transforms.map((transform) =>
            transform.kind === 'lookupTable'
              ? { ...transform, config: { ...transform.config, lookupTableId: units.id } }
              : transform,
          ),
        },
        publishedBy: workspace.userId,
      })
      .returning(),
  )

  translatingVersionId = translating.id

  const member = (role: 'admin' | 'viewer') => ({
    name: `Nordwind Foods ${role}`,
    email: `${role}@nordwind-foods.example`,
    password: `nordwind-foods-${role}-password`,
    workspaceId: workspace.id,
    role,
  })

  await addMember(db, member('admin'))
  await addMember(db, member('viewer'))
  admin = await signIn(api.app, member('admin'))
  viewer = await signIn(api.app, member('viewer'))
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const invoice = z
  .looseObject({ lines: z.array(z.looseObject({})) })
  .parse(JSON.parse(goldenInvoice))

const inKilograms = JSON.stringify({
  ...invoice,
  lines: invoice.lines.map((line) => ({ ...line, unit: 'KG' })),
})

const delivering: DeliveryService = () => Effect.void

const unreachable: DeliveryService = () =>
  Effect.fail(new DeliveryFailed({ reason: 'hostUnreachable' }))

const processQueued = async (delivery = delivering) => {
  for (const queued of api.runQueue.queued.splice(0)) {
    await Effect.runPromise(
      processRun(queued).pipe(pipelineServices(api.connection.db, api.runQueue, delivery)),
    )
  }
}

const processed = async (content: string, delivery = delivering) => {
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

const reprocess = (id: string, mappingVersionId = translatingVersionId, as = admin) =>
  as.inject({
    method: reprocessRunEndpoint.method,
    url: toPath(reprocessRunEndpoint.path, { id }),
    body: { mappingVersionId },
  })

const reprocessed = async (id: string, mappingVersionId = translatingVersionId) => {
  const response = await reprocess(id, mappingVersionId)

  expect(response.statusCode, response.body).toBe(201)

  return runDetailSchema.parse(response.json())
}

const detail = async (id: string) => {
  const response = await admin.inject({ method: 'GET', url: toPath(runEndpoint.path, { id }) })

  expect(response.statusCode, response.body).toBe(200)

  return runDetailSchema.parse(response.json())
}

describe('POST /runs/:id/reprocess', () => {
  it('starts a new Run from the same Document with the chosen Mapping Version', async () => {
    const id = await processed(inKilograms)

    await expect(detail(id)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      problem: { reason: 'missingCode' },
    })

    const replacing = await reprocessed(id)

    expect(replacing).toMatchObject({
      status: 'received',
      replaces: { id },
      replacedBy: null,
      mappingVersion: { id: translatingVersionId, version: 2 },
    })
    expect(replacing.id).not.toBe(id)
    expect(api.runQueue.queued).toEqual([{ workspaceId: workspace.id, runId: replacing.id }])

    await processQueued()

    await expect(detail(replacing.id)).resolves.toMatchObject({
      status: 'delivered',
      replaces: { id },
      mappingVersion: { id: translatingVersionId },
    })
    await expect(detail(id)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      replaces: null,
      replacedBy: { id: replacing.id },
      mappingVersion: { id: workspace.mappingVersionId },
    })

    const [original, replacement] = await Promise.all([
      readRun(api.connection.db, id),
      readRun(api.connection.db, replacing.id),
    ])

    expect(replacement?.document).toEqual(original?.document)
  })

  it('reprocesses with the Mapping Version the Run failed with when that one is chosen', async () => {
    const id = await processed(inKilograms)

    const replacing = await reprocessed(id, workspace.mappingVersionId)

    await processQueued()

    await expect(detail(replacing.id)).resolves.toMatchObject({
      status: 'failed',
      failureStage: 'mapping',
      problem: { reason: 'missingCode' },
      replaces: { id },
      mappingVersion: { id: workspace.mappingVersionId },
    })
  })

  it('answers 409 for a Run that a new Run already replaces', async () => {
    const id = await processed(inKilograms)

    await reprocessed(id)
    api.runQueue.queued.splice(0)

    const response = await reprocess(id)

    expect(response.statusCode, response.body).toBe(409)
    expect(api.runQueue.queued).toEqual([])
  })

  it('answers 409 to the second of two Reprocesses at once', async () => {
    const id = await processed(inKilograms)

    const responses = await Promise.all([reprocess(id), reprocess(id)])

    expect(responses.map(({ statusCode }) => statusCode).toSorted()).toEqual([201, 409])
    expect(api.runQueue.queued.splice(0)).toHaveLength(1)
  })

  it('answers 409 for a Run that failed at delivery', async () => {
    const id = await processed(goldenInvoice, unreachable)

    const response = await reprocess(id)

    expect(response.statusCode, response.body).toBe(409)
    expect(api.runQueue.queued).toEqual([])
    await expect(detail(id)).resolves.toMatchObject({ failureStage: 'delivery', replacedBy: null })
  })

  it('answers 409 for a delivered Run', async () => {
    const id = await processed(goldenInvoice)

    const response = await reprocess(id)

    expect(response.statusCode, response.body).toBe(409)
    expect(api.runQueue.queued).toEqual([])
  })

  it('answers 422 for a Mapping Version of another Mapping and starts no Run', async () => {
    const id = await processed(inKilograms)

    const response = await reprocess(id, otherWorkspace.mappingVersionId)

    expect(response.statusCode, response.body).toBe(422)
    expect(api.runQueue.queued).toEqual([])
    await expect(detail(id)).resolves.toMatchObject({ status: 'failed', replacedBy: null })
  })

  it('answers 422 for an unknown Mapping Version', async () => {
    const id = await processed(inKilograms)

    const response = await reprocess(id, crypto.randomUUID())

    expect(response.statusCode, response.body).toBe(422)
  })

  it('answers 400 without a Mapping Version', async () => {
    const id = await processed(inKilograms)

    const response = await admin.inject({
      method: reprocessRunEndpoint.method,
      url: toPath(reprocessRunEndpoint.path, { id }),
      body: {},
    })

    expect(response.statusCode, response.body).toBe(400)
  })

  it('answers 403 to a Viewer and starts no Run', async () => {
    const id = await processed(inKilograms)

    const response = await reprocess(id, translatingVersionId, viewer)

    expect(response.statusCode).toBe(403)
    expect(api.runQueue.queued).toEqual([])
  })

  it('answers 404 for a Run of another Workspace', async () => {
    const id = await processed(inKilograms)

    const response = await reprocess(id, translatingVersionId, api.admin)

    expect(response.statusCode).toBe(404)
    await expect(detail(id)).resolves.toMatchObject({ replacedBy: null })
  })

  it('answers 404 for an unknown Run', async () => {
    const response = await reprocess(crypto.randomUUID())

    expect(response.statusCode).toBe(404)
  })
})
