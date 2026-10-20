import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  manualSubmissionSchema,
  runDetailSchema,
  runEndpoint,
  runListSchema,
  runMappingFilterCase,
  runsEndpoint,
  submitDocumentEndpoint,
  toPath,
} from '@edi-bridge/contracts'
import { flows, mappings, mappingVersions, runs } from '@edi-bridge/db'
import { processRun } from '@edi-bridge/pipeline'
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

const day = 24 * 60 * 60 * 1000

const sevenDaysAgo = new Date(Date.now() - 7 * day).toISOString()

const invalidInvoice = JSON.stringify({
  ...z.looseObject({}).parse(JSON.parse(goldenInvoice)),
  invoiceNumber: 'INV-'.repeat(10),
})

// Received in this order: the processed Run ten days ago, then the failed one, then the received one.
let processed: string

let failed: string

let received: string

const submitted = async (content: string, as = admin, channelId = workspace.inboundChannelId) => {
  const response = await as.inject({
    method: submitDocumentEndpoint.method,
    url: submitDocumentEndpoint.path,
    body: {
      channelId,
      document: { fileName: 'invoice.json', content },
    },
  })

  expect(response.statusCode, response.body).toBe(201)

  return manualSubmissionSchema.parse(response.json()).runs[0]?.id ?? ''
}

const processQueued = async () => {
  for (const queued of api.runQueue.queued.splice(0)) {
    await Effect.runPromise(
      processRun(queued).pipe(pipelineServices(api.connection.db, api.runQueue, () => Effect.void)),
    )
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

  processed = await submitted(goldenInvoice)
  failed = await submitted(invalidInvoice)
  await processQueued()
  received = await submitted(goldenInvoice)

  await api.connection.db
    .update(runs)
    .set({ receivedAt: new Date(Date.now() - 10 * day) })
    .where(eq(runs.id, processed))
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const listed = async (query = '', as = admin) => {
  const response = await as.inject({ method: 'GET', url: `${runsEndpoint.path}?${query}` })

  expect(response.statusCode, response.body).toBe(200)

  return runListSchema.parse(response.json())
}

const ids = (list: z.infer<typeof runListSchema>) => list.runs.map(({ id }) => id)

const noRuns = { received: 0, processing: 0, delivered: 0, failed: 0, duplicate: 0 }

describe('GET /runs', () => {
  it('lists the Runs of the Workspace newest first with their status counts', async () => {
    const list = await listed()

    expect(ids(list)).toEqual([received, failed, processed])
    expect(list).toMatchObject({
      statusCounts: { ...noRuns, received: 1, delivered: 1, failed: 1 },
      total: 3,
      page: 1,
      pageSize: 50,
    })
    expect(list.runs[1]).toMatchObject({
      status: 'failed',
      failureStage: 'validation',
      tradingPartner: { id: workspace.tradingPartnerId, name: 'Hanse Retail' },
      messageType: 'INVOIC',
      direction: 'outbound',
      flow: { id: workspace.flowId, name: 'Invoices to Hanse Retail' },
      manualSubmission: true,
      problem: { reason: 'invalidContent' },
    })
    expect(list.runs[0]?.problem).toBeNull()
    expect(list.runs[2]?.businessReference).toBe('4711')
  })

  it('answers the failed Documents of a Mapping in the last 7 days, counting every status', async () => {
    const list = await listed(
      `mappingId=${workspace.mappingId}&status=failed&receivedFrom=${sevenDaysAgo}&pageSize=5`,
    )

    expect(ids(list)).toEqual([failed])
    expect(list).toMatchObject({
      statusCounts: { ...noRuns, received: 1, failed: 1 },
      total: 1,
      pageSize: 5,
    })
  })

  it.each([
    ['another Mapping', () => `mappingId=${crypto.randomUUID()}`, () => []],
    ['the Flow', () => `flowId=${workspace.flowId}`, () => [received, failed, processed]],
    ['another Flow', () => `flowId=${crypto.randomUUID()}`, () => []],
    [
      'the Trading Partner',
      () => `tradingPartnerId=${workspace.tradingPartnerId}`,
      () => [received, failed, processed],
    ],
    ['another Trading Partner', () => `tradingPartnerId=${crypto.randomUUID()}`, () => []],
    ['another Message Type', () => 'messageType=ORDERS', () => []],
    ['the Failure Stage', () => 'failureStage=validation', () => [failed]],
    ['another Failure Stage', () => 'failureStage=mapping', () => []],
    ['several statuses', () => 'status=received&status=delivered', () => [received, processed]],
    ['channel traffic', () => 'manualSubmission=false', () => []],
    ['manual Submissions', () => 'manualSubmission=true', () => [received, failed, processed]],
    ['a time range', () => `receivedTo=${sevenDaysAgo}`, () => [processed]],
    ['a Business Reference', () => 'q=471', () => [processed]],
    ['a Trading Partner name in any case', () => 'q=hanse', () => [received, failed, processed]],
    ['a text no Run contains', () => 'q=nordwind', () => []],
  ])('filters by %s', async (_, query, expected) => {
    expect(ids(await listed(query()))).toEqual(expected())
  })

  it('counts only the Runs the filters keep', async () => {
    const list = await listed(`messageType=INVOIC&q=4711&receivedTo=${sevenDaysAgo}`)

    expect(ids(list)).toEqual([processed])
    expect(list).toMatchObject({ statusCounts: { ...noRuns, delivered: 1 }, total: 1 })
  })

  it('pages the Runs', async () => {
    const list = await listed('page=2&pageSize=1')

    expect(ids(list)).toEqual([failed])
    expect(list).toMatchObject({ total: 3, page: 2, pageSize: 1 })
  })

  it('lists no Runs of another Workspace', async () => {
    expect(await listed('', api.admin)).toEqual({
      runs: [],
      statusCounts: noRuns,
      total: 0,
      page: 1,
      pageSize: 50,
    })
  })

  it('answers 400 for an unknown status', async () => {
    const response = await admin.inject({ method: 'GET', url: `${runsEndpoint.path}?status=lost` })

    expect(response.statusCode).toBe(400)
  })
})

const detail = async (id: string, as = admin) => {
  const response = await as.inject({ method: 'GET', url: toPath(runEndpoint.path, { id }) })

  expect(response.statusCode, response.body).toBe(200)

  return runDetailSchema.parse(response.json())
}

describe('GET /runs/:id', () => {
  it('shows a processed Run with its steps and Mapping Version', async () => {
    const run = await detail(processed)

    expect(run).toMatchObject({
      id: processed,
      status: 'delivered',
      failureStage: null,
      businessReference: '4711',
      mappingVersion: {
        id: workspace.mappingVersionId,
        mappingId: workspace.mappingId,
        version: 1,
      },
      error: null,
      problem: null,
      interchange: null,
      message: null,
      replaces: null,
      replacedBy: null,
      duplicateOf: null,
    })
    expect(run.steps.map(({ stage, status }) => [stage, status])).toEqual([
      ['receipt', 'succeeded'],
      ['mapping', 'succeeded'],
      ['validation', 'succeeded'],
      ['delivery', 'succeeded'],
    ])
    expect(run.steps.every(({ startedAt, finishedAt }) => startedAt && finishedAt)).toBe(true)
  })

  it('shows a failed Run with its error and who fixes it', async () => {
    const run = await detail(failed)

    expect(run).toMatchObject({
      status: 'failed',
      failureStage: 'validation',
      error: {
        code: 'too-long-element',
        position: { segment: 2, tag: 'BGM', element: 2, component: null },
        details: null,
      },
      problem: {
        reason: 'invalidContent',
        whoFixes: 'you',
        fixTarget: { kind: 'mapping', mappingId: workspace.mappingId, fieldPath: 'BGM/1004' },
      },
      waitingForTradingPartnerSince: null,
    })
    expect(run.steps.map(({ status }) => status)).toEqual([
      'succeeded',
      'succeeded',
      'failed',
      'skipped',
    ])
  })

  it('shows a received Run before it has a Mapping Version', async () => {
    const run = await detail(received)

    expect(run).toMatchObject({ status: 'received', mappingVersion: null })
    expect(run.steps.map(({ status }) => status)).toEqual([
      'succeeded',
      'pending',
      'pending',
      'pending',
    ])
  })

  it.each([
    ['a Run of another Workspace', () => api.admin, () => processed],
    ['an id that is no uuid', () => admin, () => 'not-a-run'],
    ['an unknown Run', () => admin, () => crypto.randomUUID()],
  ])('answers 404 for %s', async (_, as, id) => {
    const response = await as().inject({
      method: 'GET',
      url: toPath(runEndpoint.path, { id: id() }),
    })

    expect(response.statusCode).toBe(404)
  })
})

describe('a Run that stopped on a defect', () => {
  let defect: string

  beforeAll(async () => {
    defect = await submitted(invalidInvoice)
    await processQueued()

    // The pipeline fails a Run on a defect only when processing breaks; this stands in for one.
    await api.connection.db
      .update(runs)
      .set({
        failureStage: 'mapping',
        error: {
          code: 'processingDefect',
          message: 'The processing stopped on an unexpected error',
          position: null,
          details: null,
        },
        problem: { reason: 'defect', fixTarget: null },
      })
      .where(eq(runs.id, defect))
  })

  it('names the defect reason of a failed Run in the Run list', async () => {
    const list = await listed('status=failed')

    expect(list.runs.find(({ id }) => id === defect)).toMatchObject({
      failureStage: 'mapping',
      problem: { reason: 'defect' },
    })
  })

  it('offers trying again for a defect in the Run detail', async () => {
    await expect(detail(defect)).resolves.toMatchObject({
      failureStage: 'mapping',
      problem: { reason: 'defect', whoFixes: 'retry', fixTarget: null },
    })
  })
})

describe('the shared mappingId filter case', () => {
  const seeded = new Map<string, string>()

  let caseAdmin: Client

  const seededId = (key: string) => {
    const id = seeded.get(key)

    if (id === undefined) {
      throw new Error(`The filter case seeded no ${key}`)
    }

    return id
  }

  const inserted = ([row]: { id: string }[]) => {
    if (row === undefined) {
      throw new Error('Insert returned no row')
    }

    return row.id
  }

  beforeAll(async () => {
    const { db } = api.connection
    // Its own Workspace keeps the case's Runs out of the exact lists the other tests assert.
    const caseWorkspace = await seedInvoiceWorkspace(db, 'Filter case Foods')

    const member = {
      name: 'Filter case Foods admin',
      email: 'admin@filter-case-foods.example',
      password: 'filter-case-foods-admin-password',
      workspaceId: caseWorkspace.id,
      role: 'admin' as const,
    }

    await addMember(db, member)
    caseAdmin = await signIn(api.app, member)

    const [workspaceMapping] = await db
      .select()
      .from(mappings)
      .where(eq(mappings.id, caseWorkspace.mappingId))

    const [flow] = await db.select().from(flows).where(eq(flows.id, caseWorkspace.flowId))

    if (workspaceMapping === undefined || flow === undefined) {
      throw new Error('The Workspace has no Mapping or Flow to copy')
    }

    // Submitted before the case Flow exists, so the Workspace's Flow alone takes each Document.
    for (const { key } of runMappingFilterCase.runs) {
      seeded.set(key, await submitted(goldenInvoice, caseAdmin, caseWorkspace.inboundChannelId))
    }

    // Processing would record a Mapping Version on the Run that is not yet processed.
    const othersQueued = api.runQueue.queued.filter(
      ({ workspaceId }) => workspaceId !== caseWorkspace.id,
    )

    api.runQueue.queued.splice(0, api.runQueue.queued.length, ...othersQueued)

    for (const key of runMappingFilterCase.mappings) {
      const id = inserted(
        await db
          .insert(mappings)
          .values({
            workspaceId: caseWorkspace.id,
            documentStructureId: workspaceMapping.documentStructureId,
            messageType: workspaceMapping.messageType,
            name: `Filter case ${key}`,
            draft: workspaceMapping.draft,
          })
          .returning(),
      )

      seeded.set(key, id)
    }

    const lastVersion = new Map<string, number>()

    for (const { key, mapping } of runMappingFilterCase.mappingVersions) {
      const version = (lastVersion.get(mapping) ?? 0) + 1
      lastVersion.set(mapping, version)

      const id = inserted(
        await db
          .insert(mappingVersions)
          .values({
            mappingId: seededId(mapping),
            version,
            graph: workspaceMapping.draft,
            publishedBy: caseWorkspace.userId,
          })
          .returning(),
      )

      seeded.set(key, id)
    }

    for (const { key, pinnedMappingVersion } of runMappingFilterCase.flows) {
      const id = inserted(
        await db
          .insert(flows)
          .values({
            workspaceId: caseWorkspace.id,
            tradingPartnerId: flow.tradingPartnerId,
            messageType: flow.messageType,
            name: `Filter case ${key}`,
            inboundChannelId: flow.inboundChannelId,
            destinationChannelId: flow.destinationChannelId,
            mappingVersionId: seededId(pinnedMappingVersion),
          })
          .returning(),
      )

      seeded.set(key, id)
    }

    for (const run of runMappingFilterCase.runs) {
      await db
        .update(runs)
        .set(
          run.recordedMappingVersion === null
            ? { flowId: seededId(run.flow), status: 'received', mappingVersionId: null }
            : {
                flowId: seededId(run.flow),
                status: 'delivered',
                mappingVersionId: seededId(run.recordedMappingVersion),
              },
        )
        .where(eq(runs.id, seededId(run.key)))
    }
  })

  it.each(runMappingFilterCase.filters)(
    'lists the Runs of the Mappings $mappings',
    async (filter) => {
      const query = filter.mappings.map((key) => `mappingId=${seededId(key)}`).join('&')

      expect(new Set(ids(await listed(query, caseAdmin)))).toEqual(
        new Set(filter.runs.map(seededId)),
      )
    },
  )
})
