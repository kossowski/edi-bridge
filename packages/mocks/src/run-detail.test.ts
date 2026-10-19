import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  interchangeEndpoint,
  mappingVersionsEndpoint,
  mappingVersionSummarySchema,
  type FailureStage,
  type ReprocessRunBody,
  reprocessRunEndpoint,
  retryRunEndpoint,
  runDetailSchema,
  runEndpoint,
  type RunSummary,
  toPath,
  waitForTradingPartnerRunEndpoint,
  endWaitingForTradingPartnerRunEndpoint,
} from '@edi-bridge/contracts'

import { seedChannels } from './channel'
import { seedFlows } from './flow'
import { seedLookupTableNamed } from './lookup-table'
import { createRun, createRuns } from './run'
import { runDetailHandlers, seedReprocessed } from './run-detail'
import { createRunStore, interchangeIdOf } from './run-store'
import { seedWorkspace } from './workspace'

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
    defect,
  }: { failureStage?: FailureStage; receivedAt?: string; defect?: boolean } = {},
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
    : createRun({ ...run, status: 'failed', failureStage, defect })
}

function defectRun() {
  return inboundOrders('00000000-0000-4000-8000-0000000000d1', {
    failureStage: 'mapping',
    defect: true,
  })
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

      const segment = body?.interchange?.raw.split("'")[position!.segment - 1]

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

  it('points a validation error at the invalid date component, counting the UNA as segment 1', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', {
      failureStage: 'validation',
    })

    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)

    expect(body?.error?.position).toEqual({ segment: 5, tag: 'DTM', element: 1, component: 2 })
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
    expect(body?.error?.position?.segment).toBe(2 + firstMessageLength + 3)
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

  it('has no Interchange for an outbound Run that failed at validation, and counts its position from the UNH as segment 1', async () => {
    const run = createRun({
      id: '00000000-0000-4000-8000-000000000002',
      tradingPartner: hansemarkt,
      messageType: 'INVOIC',
      flow: invoicFlow,
      status: 'failed',
      failureStage: 'validation',
    })

    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)
    const party = /NAD\+(\w+)/.exec(body?.error?.message ?? '')?.[1]

    expect(body?.interchange).toBeNull()
    expect(body?.message?.segments[0]?.tag).toBe('UNH')
    expect(body?.error?.position).toEqual({
      segment: party === 'BY' ? 5 : 6,
      tag: 'NAD',
      element: 2,
      component: 1,
    })
  })

  it('has no Interchange for an outbound Run that failed at delivery before building it', async () => {
    const runs = createRuns({ count: 2000 }).filter(
      (run) => run.direction === 'outbound' && run.failureStage === 'delivery',
    )

    server.use(...runDetailHandlers(apiUrl, { runs }))

    const details = await Promise.all(runs.map(async ({ id }) => (await getRun(id)).body!))

    expect(
      new Set(details.map(({ error, interchange }) => `${error?.code}:${interchange !== null}`)),
    ).toEqual(
      new Set([
        'glnMissing:false',
        'characterSetUnsupported:false',
        'channelDefect:true',
        'destinationUnreachable:true',
      ]),
    )
  })

  it('fails an outbound Run at validation with the codes of the edifact package', async () => {
    const runs = Array.from({ length: 12 }, (_, index) =>
      createRun({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        tradingPartner: hansemarkt,
        messageType: 'INVOIC',
        flow: invoicFlow,
        status: 'failed',
        failureStage: 'validation',
      }),
    )

    server.use(...runDetailHandlers(apiUrl, { runs }))

    const bodies = await Promise.all(runs.map(async ({ id }) => (await getRun(id)).body))
    const tooLong = bodies.find((body) => body?.error?.code === 'too-long-element')
    const position = tooLong?.error?.position
    const party = tooLong?.message?.segments[position!.segment - 1]

    expect(new Set(bodies.map((body) => body?.error?.code))).toEqual(
      new Set(['missing-element', 'too-long-element']),
    )
    expect(tooLong?.problem).toMatchObject({ reason: 'invalidContent', whoFixes: 'you' })
    expect(party?.tag).toBe('NAD')
    expect(
      party?.elements[position!.element! - 1]?.[position!.component! - 1]?.length,
    ).toBeGreaterThan(35)
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

describe('the problem of a failed Run', () => {
  it('leaves an unreadable inbound Interchange to the Trading Partner', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', { failureStage: 'parse' })
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)

    expect(body).toMatchObject({
      problem: {
        reason: 'unreadable',
        whoFixes: 'tradingPartner',
        fixTarget: {
          kind: 'tradingPartner',
          tradingPartnerId: hansemarkt.id,
          name: hansemarkt.name,
        },
      },
      waitingForTradingPartnerSince: null,
    })
  })

  it('leaves invalid inbound content to the Trading Partner', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', {
      failureStage: 'validation',
    })

    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)

    expect(body?.problem).toMatchObject({ reason: 'invalidContent', whoFixes: 'tradingPartner' })
  })

  it('points invalid outbound content at the Mapping field that fills the empty party', async () => {
    const partyFields = new Map([
      ['BY', 'buyer.gln'],
      ['SU', 'supplier.gln'],
    ])

    const runs = Array.from({ length: 12 }, (_, index) =>
      createRun({
        id: `00000000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`,
        tradingPartner: hansemarkt,
        messageType: 'INVOIC',
        flow: invoicFlow,
        status: 'failed',
        failureStage: 'validation',
      }),
    )

    server.use(...runDetailHandlers(apiUrl, { runs }))
    const bodies = await Promise.all(runs.map(async ({ id }) => (await getRun(id)).body!))

    for (const body of bodies) {
      const party = /NAD\+(\w+)/.exec(body.error!.message)?.[1] ?? ''

      expect(body.problem).toEqual({
        reason: 'invalidContent',
        whoFixes: 'you',
        fixTarget: {
          kind: 'mapping',
          mappingId: body.mappingVersion?.mappingId,
          name: body.mappingVersion?.mappingName,
          fieldPath: partyFields.get(party),
        },
      })
    }

    expect(
      new Set(
        bodies.map(
          ({ problem }) => problem?.fixTarget?.kind === 'mapping' && problem.fixTarget.fieldPath,
        ),
      ),
    ).toEqual(new Set(partyFields.values()))
  })

  it('points a missing unit of an outbound document at the Lookup Table that lacks it', async () => {
    const flow = seedFlows.find(({ name }) => name === invoicFlow.name)!

    const run = createRun({
      id: '00000000-0000-4000-8000-000000000001',
      tradingPartner: hansemarkt,
      messageType: 'INVOIC',
      flow: { id: flow.id, name: flow.name },
      status: 'failed',
      failureStage: 'mapping',
    })

    const units = seedLookupTableNamed('Units of measure')
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)

    expect(body?.problem).toEqual({
      reason: 'missingCode',
      whoFixes: 'you',
      fixTarget: { kind: 'lookupTable', lookupTableId: units.id, name: units.name, code: 'KRT' },
    })
  })

  it('points an inbound document without a GTIN at the Mapping field that reads it', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', { failureStage: 'mapping' })
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)
    const lin = body?.message?.segments.find(({ tag }) => tag === 'LIN')

    expect(body?.problem).toMatchObject({
      reason: 'missingField',
      fixTarget: { kind: 'mapping', fieldPath: 'lines[].gtin' },
    })
    expect(lin?.elements[2]?.[0]).toBe('')
  })

  it('points a missing ERP field at the Mapping field that reads it', async () => {
    const runs = Array.from({ length: 12 }, (_, index) =>
      createRun({
        id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
        tradingPartner: hansemarkt,
        messageType: 'INVOIC',
        flow: invoicFlow,
        status: 'failed',
        failureStage: 'mapping',
      }),
    )

    server.use(...runDetailHandlers(apiUrl, { runs }))
    const bodies = await Promise.all(runs.map(async ({ id }) => (await getRun(id)).body!))
    const missingField = bodies.find(({ problem }) => problem?.reason === 'missingField')

    expect(missingField?.error?.message).toContain('lines[')
    expect(missingField?.problem).toEqual({
      reason: 'missingField',
      whoFixes: 'you',
      fixTarget: {
        kind: 'mapping',
        mappingId: missingField?.mappingVersion?.mappingId,
        name: missingField?.mappingVersion?.mappingName,
        fieldPath: 'lines[].gtin',
      },
    })
  })

  it('offers a retry for an unreachable destination and points at its Channel', async () => {
    const run = createRun({
      id: '00000000-0000-4000-8000-000000000001',
      status: 'failed',
      failureStage: 'delivery',
    })

    const flow = seedFlows.find(({ id }) => id === run.flow.id)!
    const channel = seedChannels.find(({ id }) => id === flow.destinationChannelId)!
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)

    expect(body?.problem).toEqual({
      reason: 'unreachable',
      whoFixes: 'retry',
      fixTarget: { kind: 'channel', channelId: channel.id, name: channel.name },
    })
  })

  it('seeds every kind of fix target and everyone who fixes a problem', async () => {
    const runs = createRuns({ count: 2000 })
    server.use(...runDetailHandlers(apiUrl, { runs }))

    const problems = await Promise.all(
      runs
        .filter(({ status }) => status === 'failed')
        .map(async ({ id }) => (await getRun(id)).body!.problem!),
    )

    expect(new Set(problems.map(({ whoFixes }) => whoFixes))).toEqual(
      new Set(['you', 'retry', 'tradingPartner']),
    )
    expect(new Set(problems.map(({ fixTarget }) => fixTarget?.kind))).toEqual(
      new Set([
        'mapping',
        'lookupTable',
        'channel',
        'tradingPartner',
        'workspaceGln',
        'tradingPartnerGln',
        'channelCredential',
        undefined,
      ]),
    )
  })

  it('names the reason of its problem in every failed Run summary', async () => {
    const runs = createRuns({ count: 2000 }).filter(({ status }) => status === 'failed')
    server.use(...runDetailHandlers(apiUrl, { runs }))

    for (const run of runs) {
      const { body } = await getRun(run.id)

      expect(run.problem, run.id).toEqual({ reason: body?.problem?.reason })
    }
  })

  it('points an incomplete setup at the piece to complete before a retry', async () => {
    const runs = createRuns({ count: 2000 }).filter(
      ({ status, failureStage }) => status === 'failed' && failureStage === 'delivery',
    )

    server.use(...runDetailHandlers(apiUrl, { runs }))

    const incomplete = (
      await Promise.all(runs.map(async ({ id }) => (await getRun(id)).body!))
    ).filter(({ problem }) => problem?.reason === 'incompleteSetup')

    expect(
      new Set(incomplete.map(({ error, problem }) => `${error?.code}:${problem?.fixTarget?.kind}`)),
    ).toEqual(
      new Set([
        'glnMissing:workspaceGln',
        'glnMissing:tradingPartnerGln',
        'channelDefect:channelCredential',
        'characterSetUnsupported:tradingPartner',
      ]),
    )

    for (const run of incomplete) {
      const flow = seedFlows.find(({ id }) => id === run.flow.id)!
      const channel = seedChannels.find(({ id }) => id === flow.destinationChannelId)!

      expect(run.direction).toBe('outbound')
      expect(run.problem?.whoFixes).toBe('retry')
      expect([
        { kind: 'workspaceGln', name: seedWorkspace.name },
        {
          kind: 'tradingPartnerGln',
          tradingPartnerId: run.tradingPartner.id,
          name: run.tradingPartner.name,
        },
        { kind: 'channelCredential', channelId: channel.id, name: channel.name },
        {
          kind: 'tradingPartner',
          tradingPartnerId: run.tradingPartner.id,
          name: run.tradingPartner.name,
        },
      ]).toContainEqual(run.problem?.fixTarget)
    }
  })

  it('keeps a Run pinned without a Defect off one in its summary and detail', async () => {
    const drawn = createRuns({ count: 2000 }).filter(({ problem }) => problem?.reason === 'defect')
    const runs = drawn.map((run) => createRun({ ...run, defect: false }))

    server.use(...runDetailHandlers(apiUrl, { runs }))

    expect(runs.length).toBeGreaterThan(0)

    for (const run of runs) {
      const { body } = await getRun(run.id)

      expect(run.problem?.reason).not.toBe('defect')
      expect(body?.problem?.reason).toBe(run.problem?.reason)
    }
  })

  it('tries a Defect at mapping again without a fix target', async () => {
    const runs = createRuns({ count: 2000 }).filter(({ problem }) => problem?.reason === 'defect')

    server.use(...runDetailHandlers(apiUrl, { runs }))

    expect(runs.length).toBeGreaterThan(0)

    for (const run of runs) {
      const { body } = await getRun(run.id)

      expect(body).toMatchObject({
        failureStage: 'mapping',
        error: { code: 'processingDefect', position: null },
        problem: { reason: 'defect', whoFixes: 'retry', fixTarget: null },
      })
    }
  })

  it('leaves a delivered Run without a problem', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001')
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { body } = await getRun(run.id)

    expect(body).toMatchObject({
      problem: null,
      waitingForTradingPartnerSince: null,
      duplicateOf: null,
    })
  })
})

describe('a Duplicate', () => {
  const original = inboundOrders('00000000-0000-4000-8000-000000000001')
  const placedOriginal = createRunStore([original]).get(original.id)!

  function duplicateOf(controlReference: string) {
    const duplicate = createRun({
      ...original,
      id: '00000000-0000-4000-8000-000000000002',
      receivedAt: '2026-10-02T08:00:00.000Z',
      status: 'duplicate',
      failureStage: null,
      problem: null,
    })

    return { ...duplicate, interchange: { id: interchangeIdOf(duplicate), controlReference } }
  }

  it('links to the original Run with the same Interchange control reference', async () => {
    const duplicate = duplicateOf(placedOriginal.interchange!.controlReference)
    server.use(...runDetailHandlers(apiUrl, { runs: [original, duplicate] }))

    const { body } = await getRun(duplicate.id)

    expect(body?.interchange?.controlReference).toBe(placedOriginal.interchange!.controlReference)
    expect(body?.duplicateOf).toEqual({ id: original.id })
  })

  it('has no original when no earlier Interchange carries its control reference', async () => {
    const duplicate = duplicateOf('99999999')
    server.use(...runDetailHandlers(apiUrl, { runs: [original, duplicate] }))

    const { body } = await getRun(duplicate.id)

    expect(body?.duplicateOf).toBeNull()
  })

  it('seeds inbound Duplicates with the control reference and Business Reference of their original', async () => {
    const runs = createRuns({ count: 2000 })
    server.use(...runDetailHandlers(apiUrl, { runs }))

    const duplicates = await Promise.all(
      runs
        .filter(({ status, direction }) => status === 'duplicate' && direction === 'inbound')
        .map(async ({ id }) => (await getRun(id)).body!),
    )

    const linked = duplicates.filter(({ duplicateOf }) => duplicateOf !== null)

    expect(linked.length).toBeGreaterThan(duplicates.length / 2)

    for (const duplicate of linked) {
      const { body: original } = await getRun(duplicate.duplicateOf!.id)

      expect(original?.status).not.toBe('duplicate')
      expect(original?.interchange?.controlReference).toBe(duplicate.interchange?.controlReference)
      expect(original?.businessReference).toBe(duplicate.businessReference)
    }
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

  return mappingVersionsEndpoint.response
    .parse(await response.json())
    .map((entry) => mappingVersionSummarySchema.parse(entry))
}

describe('POST /runs/:id/retry', () => {
  it('answers with the Run received again and its delivery pending', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', {
      failureStage: 'delivery',
    })

    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))
    const { body: before } = await getRun(run.id)

    const { status, body } = await post(toPath(retryRunEndpoint.path, { id: run.id }))

    expect(status).toBe(200)
    expect(body).toMatchObject({
      id: run.id,
      status: 'received',
      failureStage: null,
      error: null,
      problem: null,
    })
    expect(body?.steps.slice(0, -1)).toEqual(before?.steps.slice(0, -1))
    expect(body?.steps.at(-1)).toEqual({
      stage: 'delivery',
      status: 'pending',
      startedAt: null,
      finishedAt: null,
    })
  })

  it('delivers the Run again by its next read and leaves the other steps unchanged', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', {
      failureStage: 'delivery',
    })

    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))
    const { body: before } = await getRun(run.id)

    await post(toPath(retryRunEndpoint.path, { id: run.id }))
    const { body: after } = await getRun(run.id)

    expect(after).toMatchObject({ id: run.id, status: 'delivered', failureStage: null })
    expect(after?.steps.slice(0, -1)).toEqual(before?.steps.slice(0, -1))
    expect(after?.steps.at(-1)?.status).toBe('succeeded')
  })

  it('builds the Interchange when it delivers again a Run that failed before building it', async () => {
    const runs = createRuns({ count: 2000 }).filter(
      (run) => run.direction === 'outbound' && run.failureStage === 'delivery',
    )

    server.use(...runDetailHandlers(apiUrl, { runs }))

    const details = await Promise.all(runs.map(async ({ id }) => (await getRun(id)).body!))
    const run = details.find(({ error }) => error?.code === 'glnMissing')!

    await post(toPath(retryRunEndpoint.path, { id: run.id }))
    const { body: after } = await getRun(run.id)

    expect(after?.status).toBe('delivered')
    expect(after?.interchange?.id).toEqual(expect.any(String))
    expect(after?.interchange?.raw).toContain(`UNH+1+${run.messageType}`)
  })

  it('reprocesses a Defect at mapping with its own Mapping Version and answers the replaced Run', async () => {
    const run = defectRun()
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))
    const { body: before } = await getRun(run.id)

    const { status, body } = await post(toPath(retryRunEndpoint.path, { id: run.id }))
    const { body: replacing } = await getRun(body?.replacedBy?.id ?? '')

    expect(status).toBe(200)
    expect(body).toMatchObject({ id: run.id, status: 'failed', failureStage: 'mapping' })
    expect(replacing).toMatchObject({
      status: 'delivered',
      replaces: { id: run.id },
      mappingVersion: before?.mappingVersion,
    })
    expect((await post(toPath(retryRunEndpoint.path, { id: run.id }))).status).toBe(409)
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

describe('POST /runs/:id/wait-for-trading-partner', () => {
  it('marks a Run that the Trading Partner fixes as waiting for the Trading Partner', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', { failureStage: 'parse' })
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))
    const before = Date.now()

    const { status, body } = await post(
      toPath(waitForTradingPartnerRunEndpoint.path, { id: run.id }),
    )

    const { body: after } = await getRun(run.id)

    expect(status).toBe(200)
    expect(Date.parse(body!.waitingForTradingPartnerSince!)).toBeGreaterThanOrEqual(before)
    expect(after?.waitingForTradingPartnerSince).toBe(body?.waitingForTradingPartnerSince)
  })

  it('keeps the first mark when the Run is marked again', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', { failureStage: 'parse' })
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))
    const path = toPath(waitForTradingPartnerRunEndpoint.path, { id: run.id })
    const { body: first } = await post(path)

    const { body: second } = await post(path)

    expect(second?.waitingForTradingPartnerSince).toBe(first?.waitingForTradingPartnerSince)
  })

  it('refuses a delivered Run', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001')
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { status } = await post(toPath(waitForTradingPartnerRunEndpoint.path, { id: run.id }))
    const { body } = await getRun(run.id)

    expect(status).toBe(409)
    expect(body?.waitingForTradingPartnerSince).toBeNull()
  })

  it('refuses a Run that another Run replaces and leaves it unmarked', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', { failureStage: 'parse' })

    const resend = inboundOrders('00000000-0000-4000-8000-000000000002', {
      receivedAt: '2026-10-02T09:00:00.000Z',
    })

    server.use(
      ...runDetailHandlers(apiUrl, {
        runs: [run, resend],
        reprocessed: [{ replaced: run.id, replacing: resend.id }],
      }),
    )

    const { status } = await post(toPath(waitForTradingPartnerRunEndpoint.path, { id: run.id }))
    const { body } = await getRun(run.id)

    expect(status).toBe(409)
    expect(body?.waitingForTradingPartnerSince).toBeNull()
  })

  it.each(['mapping', 'delivery'] as const)(
    'refuses a Run that failed at %s, which the Trading Partner does not fix',
    async (failureStage) => {
      const run = inboundOrders('00000000-0000-4000-8000-000000000001', { failureStage })
      server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

      const { status } = await post(toPath(waitForTradingPartnerRunEndpoint.path, { id: run.id }))

      expect(status).toBe(409)
    },
  )

  it('answers 404 for an unknown Run', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [] }))

    const { status } = await post(
      toPath(waitForTradingPartnerRunEndpoint.path, { id: '00000000-0000-4000-8000-0000000000ff' }),
    )

    expect(status).toBe(404)
  })
})

describe('DELETE /runs/:id/wait-for-trading-partner', () => {
  async function endWaiting(id: string) {
    const response = await fetch(
      `${apiUrl}${toPath(endWaitingForTradingPartnerRunEndpoint.path, { id })}`,
      { method: 'DELETE' },
    )

    return {
      status: response.status,
      body: response.ok ? runDetailSchema.parse(await response.json()) : undefined,
    }
  }

  it('ends the mark of a waiting Run', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', { failureStage: 'parse' })
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))
    await post(toPath(waitForTradingPartnerRunEndpoint.path, { id: run.id }))

    const { status, body } = await endWaiting(run.id)
    const { body: after } = await getRun(run.id)

    expect(status).toBe(200)
    expect(body?.waitingForTradingPartnerSince).toBeNull()
    expect(after?.waitingForTradingPartnerSince).toBeNull()
  })

  it('refuses a Run that is not marked', async () => {
    const run = inboundOrders('00000000-0000-4000-8000-000000000001', { failureStage: 'parse' })
    server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

    const { status } = await endWaiting(run.id)

    expect(status).toBe(409)
  })

  it('answers 404 for an unknown Run', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [] }))

    const { status } = await endWaiting('00000000-0000-4000-8000-0000000000ff')

    expect(status).toBe(404)
  })
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

  it('accepts an outbound Run that failed at validation, which the Workspace fixes', async () => {
    const run = createRun({
      id: '00000000-0000-4000-8000-000000000004',
      tradingPartner: hansemarkt,
      messageType: 'INVOIC',
      flow: invoicFlow,
      status: 'failed',
      failureStage: 'validation',
    })

    const [latest] = await serveWithVersions(run)

    const { status, body } = await post(toPath(reprocessRunEndpoint.path, { id: run.id }), {
      // SAFETY: the seeded Mapping of the ORDERS Flow has at least one Mapping Version.
      mappingVersionId: latest!.id,
    })

    expect(status).toBe(201)
    expect(body).toMatchObject({ status: 'delivered', replaces: { id: run.id } })
  })

  it('accepts a Defect at mapping', async () => {
    const run = defectRun()
    const [latest] = await serveWithVersions(run)

    const { status, body } = await post(toPath(reprocessRunEndpoint.path, { id: run.id }), {
      // SAFETY: the seeded Mapping of the ORDERS Flow has at least one Mapping Version.
      mappingVersionId: latest!.id,
    })

    expect(status).toBe(201)
    expect(body).toMatchObject({ status: 'delivered', replaces: { id: run.id } })
  })

  it.each(['delivery', 'parse', 'validation'] as const)(
    'refuses an inbound Run that failed at %s, which the Workspace does not fix',
    async (failureStage) => {
      const run = inboundOrders('00000000-0000-4000-8000-000000000003', { failureStage })
      server.use(...runDetailHandlers(apiUrl, { runs: [run] }))

      const { status } = await post(toPath(reprocessRunEndpoint.path, { id: run.id }), {
        mappingVersionId: '00000000-0000-4000-8000-0000000000ff',
      })

      expect(status).toBe(409)
    },
  )
})

describe('seedReprocessed', () => {
  it('pairs an inbound and an outbound Run that failed at mapping with a later Run that replaced it', async () => {
    const runs = createRuns({ count: 2000 })
    const reprocessed = seedReprocessed(runs)
    server.use(...runDetailHandlers(apiUrl, { runs, reprocessed }))

    const pairs = await Promise.all(
      reprocessed.map(async ({ replaced, replacing }) => ({
        replaced: (await getRun(replaced)).body!,
        replacing: (await getRun(replacing)).body!,
      })),
    )

    expect(new Set(pairs.map(({ replaced }) => replaced.direction))).toEqual(
      new Set(['inbound', 'outbound']),
    )

    for (const { replaced, replacing } of pairs) {
      expect(replaced).toMatchObject({
        status: 'failed',
        failureStage: 'mapping',
        replacedBy: { id: replacing.id },
      })
      expect(replacing).toMatchObject({
        status: 'delivered',
        flow: replaced.flow,
        replaces: { id: replaced.id },
      })
      expect(Date.parse(replacing.receivedAt)).toBeGreaterThan(Date.parse(replaced.receivedAt))
    }
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
    expect(interchange.runs.map(({ id, messageReference }) => [id, messageReference])).toEqual([
      [first.id, '1'],
      [second.id, '2'],
      [replacing.id, '2'],
    ])
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

  it('keeps the id of an inbound Interchange when the seed is generated on another page load', async () => {
    const earlier = createRuns({ count: 50, now: new Date('2026-10-01T08:00:00.000Z') })
    const later = createRuns({ count: 50, now: new Date('2026-10-02T17:30:00.000Z') })
    const inbound = earlier.find(({ messageType }) => messageType === 'ORDERS')!
    server.use(...runDetailHandlers(apiUrl, { runs: earlier }))
    const { body } = await getRun(inbound.id)
    server.resetHandlers(...runDetailHandlers(apiUrl, { runs: later }))

    const response = await fetch(
      `${apiUrl}${toPath(interchangeEndpoint.path, { id: body!.interchange!.id })}`,
    )

    expect(response.status).toBe(200)
  })

  it('answers 404 for an unknown Interchange', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [] }))

    const response = await fetch(
      `${apiUrl}${toPath(interchangeEndpoint.path, { id: '00000000-0000-4000-8000-0000000000ff' })}`,
    )

    expect(response.status).toBe(404)
  })
})
