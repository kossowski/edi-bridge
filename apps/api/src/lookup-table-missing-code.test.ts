import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  lookupTableEndpoint,
  lookupTableMissingCodesEndpoint,
  lookupTableSchema,
  lookupTablesEndpoint,
  lookupTableSummarySchema,
  manualSubmissionSchema,
  submitDocumentEndpoint,
  updateLookupTableEndpoint,
} from '@edi-bridge/contracts'
import { runs } from '@edi-bridge/db'
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

const invoice = z
  .looseObject({ lines: z.array(z.looseObject({})) })
  .parse(JSON.parse(goldenInvoice))

const inUnit = (unit: string) =>
  JSON.stringify({ ...invoice, lines: invoice.lines.map((line) => ({ ...line, unit })) })

const submitted = async (content: string) => {
  const response = await admin.inject({
    method: submitDocumentEndpoint.method,
    url: submitDocumentEndpoint.path,
    body: {
      channelId: workspace.inboundChannelId,
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

const receivedAt = (id: string, hoursAgo: number) =>
  api.connection.db
    .update(runs)
    .set({ receivedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000) })
    .where(eq(runs.id, id))

// Received in this order: two Runs with a unit in kilograms, then one in cartons.
let firstKilograms: string

let secondKilograms: string

let cartons: string

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

  firstKilograms = await submitted(inUnit('KG'))
  secondKilograms = await submitted(inUnit('KG'))
  cartons = await submitted(inUnit('KAR'))
  await submitted(goldenInvoice)
  await processQueued()

  await receivedAt(firstKilograms, 3)
  await receivedAt(secondKilograms, 2)
  await receivedAt(cartons, 1)
}, 60_000)

afterAll(async () => {
  await api.stop()
})

const missingCodes = async () => {
  const response = await admin.inject({
    method: 'GET',
    url: lookupTableMissingCodesEndpoint.path.replace(':id', workspace.lookupTableId),
  })

  expect(response.statusCode, response.body).toBe(200)

  return lookupTableMissingCodesEndpoint.response.parse(response.json())
}

const lookupTable = async () => {
  const response = await admin.inject({
    method: 'GET',
    url: lookupTableEndpoint.path.replace(':id', workspace.lookupTableId),
  })

  expect(response.statusCode, response.body).toBe(200)

  return lookupTableSchema.parse(response.json())
}

const failedRun = (id: string) => ({
  id,
  receivedAt: expect.any(String),
  tradingPartner: { id: workspace.tradingPartnerId, name: 'Hanse Retail' },
  messageType: 'INVOIC',
  businessReference: null,
})

describe('the missing codes of a Lookup Table', () => {
  it('lists each code missing in a failed Run once, the most recent first', async () => {
    await expect(missingCodes()).resolves.toEqual([
      {
        urgency: 'blocking',
        code: 'KAR',
        meaning: null,
        suggestions: [],
        failedRuns: [failedRun(cartons)],
      },
      {
        urgency: 'blocking',
        code: 'KG',
        meaning: null,
        suggestions: [],
        failedRuns: [failedRun(secondKilograms), failedRun(firstKilograms)],
      },
    ])
  })

  it('counts the missing codes of a Lookup Table and its summary', async () => {
    const table = await lookupTable()
    const response = await admin.inject({ method: 'GET', url: lookupTablesEndpoint.path })

    expect(table).toMatchObject({
      missingCodeCounts: { blocking: 2, upcoming: 0 },
      blockingCodes: ['KAR', 'KG'],
    })
    expect(lookupTableSummarySchema.array().parse(response.json())).toEqual([
      lookupTableSummarySchema.parse(table),
    ])
  })

  it('no longer lists a code once the Lookup Table translates it', async () => {
    const { name, kind, entries } = await lookupTable()

    const response = await admin.inject({
      method: 'PUT',
      url: updateLookupTableEndpoint.path.replace(':id', workspace.lookupTableId),
      body: {
        name,
        kind,
        scope: { kind: 'workspace' },
        entries: [...entries, { sourceCode: 'KG', targetCode: 'KGM' }],
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(lookupTableSchema.parse(response.json())).toMatchObject({
      missingCodeCounts: { blocking: 1, upcoming: 0 },
      blockingCodes: ['KAR'],
    })
    await expect(missingCodes()).resolves.toMatchObject([{ code: 'KAR' }])
  })
})
