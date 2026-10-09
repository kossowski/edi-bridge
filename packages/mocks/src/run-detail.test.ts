import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  interchangeEndpoint,
  mappingVersionsEndpoint,
  type FailureStage,
  type ReprocessRunBody,
  reprocessRunEndpoint,
  retryRunEndpoint,
  runDetailSchema,
  runEndpoint,
  type RunSummary,
  toPath,
} from '@edi-bridge/contracts'

import { createRun, createRuns } from './run'
import { runDetailHandlers } from './run-detail'

const apiUrl = 'http://api.test'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

const hansemarkt = { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' }

const ordersFlow = { id: '20000000-0000-4000-8000-000000000001', name: 'Hansemarkt ORDERS inbound' }

const invoicFlow = {
  id: '20000000-0000-4000-8000-000000000003',
  name: 'Hansemarkt INVOIC outbound',
}

function inboundOrders(
  id: string,
  {
    failureStage,
    receivedAt = '2026-10-01T08:00:00.000Z',
  }: { failureStage?: FailureStage; receivedAt?: string } = {},
) {
  const run = {
    id,
    tradingPartner: hansemarkt,
    messageType: 'ORDERS',
    flow: ordersFlow,
    receivedAt,
  } as const

  return failureStage === undefined
    ? createRun({ ...run, status: 'delivered', failureStage: null })
    : createRun({ ...run, status: 'failed', failureStage })
}

async function getRun(id: string) {
  const response = await fetch(`${apiUrl}${toPath(runEndpoint.path, { id })}`)

  return {
    status: response.status,
    body: response.ok ? runDetailSchema.parse(await response.json()) : undefined,
  }
}

describe('GET /runs/:id', () => {
  it('serves the detail of a listed Run with every step succeeded', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001')
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)

    expect(body).toMatchObject({
      id: run.id,
      status: 'delivered',
      tradingPartner: hansemarkt,
      messageType: 'ORDERS',
      direction: 'inbound',
      error: null,
      replaces: null,
      replacedBy: null,
    })
    expect(body?.steps.map(({ stage, status }) => [stage, status])).toEqual([
      ['receipt', 'succeeded'],
      ['parse', 'succeeded'],
      ['validation', 'succeeded'],
      ['mapping', 'succeeded'],
      ['delivery', 'succeeded'],
    ])
    expect(body?.message?.segments[0]?.tag).toBe('UNH')
    expect(body?.interchange?.raw).toMatch(/^UNA:\+\.\? 'UNB\+/)
    expect(body?.mappingVersion).not.toBeNull()
  })

  it('answers 404 for an unknown Run', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [] }))

    const { status } = await getRun('00000000-0000-4000-8000-0000000000ff')

    expect(status).toBe(404)
  })

  it('points a parse error at the segment, element and component it names in the raw Interchange', async () => {
    const runs = ['01', '02', '03', '04', '05', '06'].map((suffix) =>
      inboundOrders(`00000000-0000-4000-8000-0000000000${suffix}`, {
        failureStage: 'parse',
        receivedAt: `2026-10-01T08:${suffix}:00.000Z`,
      }),
    )

    server.use(...runDetailHandlers(apiUrl, { runs }))

    for (const run of runs) {
      const { body } = await getRun(run.id)
      const position = body?.error?.position

      const segment = body?.interchange?.raw.slice("UNA:+.? '".length).split("'")[
        position!.segment - 1
      ]

      expect(body?.steps.map(({ stage, status }) => [stage, status])).toEqual([
        ['receipt', 'succeeded'],
        ['parse', 'failed'],
        ['validation', 'skipped'],
        ['mapping', 'skipped'],
        ['delivery', 'skipped'],
      ])
      expect(body?.message).toBeNull()
      expect(body?.mappingVersion).toBeNull()
      expect(segment?.slice(0, 3)).toBe(position?.tag)
      expect(segment?.split('+')[position!.element!]).toBeDefined()
    }
  })

  it('points a validation error at the invalid date component', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', {
      failureStage: 'validation',
    })

    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)

    expect(body?.error?.position).toEqual({ segment: 4, tag: 'DTM', element: 1, component: 2 })
    expect(body?.interchange?.raw).toContain("'DTM+137:20261341:102'")
    expect(body?.message?.segments[2]).toEqual({
      tag: 'DTM',
      name: 'Date/time/period',
      elements: [['137', '20261341', '102']],
    })
  })

  it('counts the error position across all Messages of the Interchange', async () => {
    const first = inboundOrders('00000000-0000-4000-8000-000000000001')

    const second = inboundOrders('00000000-0000-4000-8000-000000000002', {
      failureStage: 'validation',
    })

    server.use(...runDetailHandlers(apiUrl, { runs: [first, second] }))

    const { body: firstBody } = await getRun(first.id)
    const { body } = await getRun(second.id)
    const firstMessageLength = firstBody!.message!.segments.length

    expect(body?.interchange?.id).toBe(firstBody?.interchange?.id)
    expect(body?.message?.reference).toBe('2')
    expect(body?.error?.position?.segment).toBe(1 + firstMessageLength + 3)
  })

  it('reports a delivery failure without a position after a 30 second timeout', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', {
      failureStage: 'delivery',
    })

    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)
    const delivery = body?.steps.at(-1)

    expect(body?.error).toMatchObject({ code: 'destinationUnavailable', position: null })
    expect(delivery?.status).toBe('failed')
    expect(Date.parse(delivery!.finishedAt!) - Date.parse(delivery!.startedAt!)).toBe(30_000)
  })

  it('has no Interchange for an outbound Run that failed at mapping', async () => {
    const run = createRun({
      id: '00000000-0000-4000-8000-000000000002',
      tradingPartner: hansemarkt,
      messageType: 'INVOIC',
      flow: invoicFlow,
      status: 'failed',
      failureStage: 'mapping',
    })

    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)

    expect(body).toMatchObject({ interchange: null, message: null })
    expect(body?.error?.position).toBeNull()
    expect(body?.mappingVersion).not.toBeNull()
  })

  it('orders the steps of an outbound Run as mapping before validation', async () => {
    const run = createRun({
      id: '00000000-0000-4000-8000-000000000002',
      tradingPartner: hansemarkt,
      messageType: 'INVOIC',
      flow: invoicFlow,
      status: 'delivered',
      failureStage: null,
    })

    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)

    expect(body?.direction).toBe('outbound')
    expect(body?.steps.map(({ stage }) => stage)).toEqual([
      'receipt',
      'mapping',
      'validation',
      'delivery',
    ])
  })
})

async function post(path: string, body?: ReprocessRunBody) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  })

  return {
    status: response.status,
    body: response.ok ? runDetailSchema.parse(await response.json()) : undefined,
  }
}

async function versionsOf(mappingId: string) {
  const response = await fetch(`${apiUrl}${toPath(mappingVersionsEndpoint.path, { mappingId })}`)

  return mappingVersionsEndpoint.response.parse(await response.json())
}

describe('POST /runs/:id/retry', () => {
  it('repeats the failed delivery and leaves the other steps unchanged', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', {
      failureStage: 'delivery',
    })

    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))
    const { body: before } = await getRun(run.id)

    const { status, body } = await post(toPath(retryRunEndpoint.path, { id: run.id }))
    const { body: after } = await getRun(run.id)

    expect(status).toBe(200)
    expect(body).toMatchObject({ id: run.id, status: 'delivered', failureStage: null, error: null })
    expect(after?.steps.slice(0, -1)).toEqual(before?.steps.slice(0, -1))
    expect(after?.steps.at(-1)?.status).toBe('succeeded')
  })

  it.each(['parse', 'validation', 'mapping'] as const)(
    'refuses a Run that failed at %s',
    async (failureStage) => {
      const run = inboundOrders('00000000-0000-4000-8000-000000000001', {
        failureStage,
      })

      server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

      const { status } = await post(toPath(retryRunEndpoint.path, { id: run.id }))

      expect(status).toBe(409)
    },
  )
})

describe('POST /runs/:id/reprocess', () => {
  const mappingFailure = inboundOrders('00000000-0000-4000-8000-000000000001', {
    failureStage: 'mapping',
  })

  async function serveWithVersions(run: RunSummary) {
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))
    const { body } = await getRun(run.id)

    return versionsOf(body!.mappingVersion!.mappingId)
  }

  it('starts a new Run with the chosen Mapping Version that links to the replaced Run', async () => {
    const versions = await serveWithVersions(mappingFailure)
    const chosen = versions.at(-1)!

    const { status, body } = await post(
      toPath(reprocessRunEndpoint.path, { id: mappingFailure.id }),
      { mappingVersionId: chosen.id },
    )

    const { body: replaced } = await getRun(mappingFailure.id)

    expect(status).toBe(201)
    expect(body).toMatchObject({
      status: 'delivered',
      mappingVersion: chosen,
      replaces: { id: mappingFailure.id },
      replacedBy: null,
    })
    expect(body?.id).not.toBe(mappingFailure.id)
    expect(body?.interchange?.id).toBe(replaced?.interchange?.id)
    expect(replaced).toMatchObject({ status: 'failed', replacedBy: { id: body?.id } })
  })

  it('gives a reprocessed outbound Run the Interchange that its mapping now produces', async () => {
    const run = createRun({
      id: '00000000-0000-4000-8000-000000000002',
      tradingPartner: hansemarkt,
      messageType: 'INVOIC',
      flow: invoicFlow,
      status: 'failed',
      failureStage: 'mapping',
    })

    const [latest] = await serveWithVersions(run)

    const { body } = await post(toPath(reprocessRunEndpoint.path, { id: run.id }), {
      mappingVersionId: latest!.id,
    })

    expect(body?.interchange?.raw).toContain("'UNH+1+INVOIC:D:96A:UN:EAN008'")
    expect(body?.message?.messageType).toBe('INVOIC')
  })

  it('refuses a Mapping Version of another Mapping', async () => {
    await serveWithVersions(mappingFailure)

    const { status } = await post(toPath(reprocessRunEndpoint.path, { id: mappingFailure.id }), {
      mappingVersionId: '00000000-0000-4000-8000-0000000000ff',
    })

    expect(status).toBe(422)
  })

  it('refuses a Run that is already replaced', async () => {
    const [latest] = await serveWithVersions(mappingFailure)
    const path = toPath(reprocessRunEndpoint.path, { id: mappingFailure.id })
    await post(path, { mappingVersionId: latest!.id })

    const { status } = await post(path, { mappingVersionId: latest!.id })

    expect(status).toBe(409)
  })

  it('refuses a Run that failed at delivery', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000003', {
      failureStage: 'delivery',
    })

    const [latest] = await serveWithVersions(run)

    const { status } = await post(toPath(reprocessRunEndpoint.path, { id: run.id }), {
      mappingVersionId: latest!.id,
    })

    expect(status).toBe(409)
  })
})

describe('GET /mappings/:mappingId/versions', () => {
  it('lists the Mapping Versions newest first and includes the one the Run used', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001')
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))
    const { body } = await getRun(run.id)

    const versions = await versionsOf(body!.mappingVersion!.mappingId)
    const numbers = versions.map(({ version }) => version)

    expect(numbers).toEqual(numbers.toSorted((a, b) => b - a))
    expect(numbers.at(-1)).toBe(1)
    expect(versions).toContainEqual(body?.mappingVersion)
  })
})

describe('GET /interchanges/:id', () => {
  it('lists every Run the Interchange produced, including a Run that replaced one of them', async () => {
    const first = inboundOrders('00000000-0000-4000-8000-000000000001')

    const second = inboundOrders('00000000-0000-4000-8000-000000000002', {
      failureStage: 'mapping',
    })

    const replacing = inboundOrders('00000000-0000-4000-8000-000000000003', {
      receivedAt: '2026-10-02T09:00:00.000Z',
    })

    const elsewhere = inboundOrders('00000000-0000-4000-8000-000000000004', {
      receivedAt: '2026-10-01T09:00:00.000Z',
    })

    server.use(
      ...runDetailHandlers(apiUrl, {
        runs: [first, second, replacing, elsewhere],
        reprocessed: [{ replaced: second.id, replacing: replacing.id }],
      }),
    )
    const { body: run } = await getRun(second.id)

    const response = await fetch(
      `${apiUrl}${toPath(interchangeEndpoint.path, { id: run!.interchange!.id })}`,
    )

    const interchange = interchangeEndpoint.response.parse(await response.json())

    expect(run?.replacedBy).toEqual({ id: replacing.id })
    expect(interchange).toMatchObject({
      direction: 'inbound',
      controlReference: run?.interchange?.controlReference,
      raw: run?.interchange?.raw,
      sender: { name: 'Hansemarkt GmbH' },
      receiver: { name: 'Nordwind Handel GmbH' },
    })
    expect(interchange.runs.map(({ id }) => id)).toEqual([first.id, second.id, replacing.id])
  })

  it('seeds inbound Interchanges that hold several Messages', async () => {
    const runs = createRuns({ count: 100 })
    server.use(...runDetailHandlers(apiUrl, { runs }))
    const interchangeIds = new Set<string>()

    for (const run of runs) {
      const { body } = await getRun(run.id)

      if (body?.direction === 'inbound') {
        interchangeIds.add(body.interchange!.id)
      }
    }

    const sizes = await Promise.all(
      [...interchangeIds].map(async (id) => {
        const response = await fetch(`${apiUrl}${toPath(interchangeEndpoint.path, { id })}`)

        return interchangeEndpoint.response.parse(await response.json()).runs.length
      }),
    )

    expect(Math.max(...sizes)).toBeGreaterThan(1)
  })

  it('answers 404 for an unknown Interchange', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [] }))

    const response = await fetch(
      `${apiUrl}${toPath(interchangeEndpoint.path, { id: '00000000-0000-4000-8000-0000000000ff' })}`,
    )

    expect(response.status).toBe(404)
  })
})
