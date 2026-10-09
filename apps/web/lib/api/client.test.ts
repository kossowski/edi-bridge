import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createRun, runDetailHandlers, runsHandler } from '@edi-bridge/mocks'

import { getRun, listMappingVersions, listRuns, reprocessRun, retryRun } from './client'
import { apiUrl } from './config'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => server.resetHandlers())

afterAll(() => server.close())

const partnerA = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Partner A' }

const partnerB = { id: '00000000-0000-4000-8000-0000000000b2', name: 'Partner B' }

const partnerC = { id: '00000000-0000-4000-8000-0000000000c3', name: 'Partner C' }

const runs = [
  createRun({
    id: '00000000-0000-4000-8000-000000000001',
    receivedAt: '2026-10-03T08:00:00.000Z',
    manualSubmission: true,
    status: 'delivered',
    failureStage: null,
    tradingPartner: partnerA,
  }),
  createRun({
    id: '00000000-0000-4000-8000-000000000002',
    receivedAt: '2026-10-02T08:00:00.000Z',
    manualSubmission: false,
    status: 'failed',
    failureStage: 'parse',
    tradingPartner: partnerB,
  }),
  createRun({
    id: '00000000-0000-4000-8000-000000000003',
    receivedAt: '2026-10-01T08:00:00.000Z',
    manualSubmission: true,
    status: 'delivered',
    failureStage: null,
    tradingPartner: partnerC,
  }),
]

describe('Run detail actions', () => {
  const deliveryFailure = createRun({
    id: '00000000-0000-4000-8000-000000000011',
    messageType: 'ORDERS',
    status: 'failed',
    failureStage: 'delivery',
  })

  const mappingFailure = createRun({
    id: '00000000-0000-4000-8000-000000000012',
    messageType: 'ORDERS',
    status: 'failed',
    failureStage: 'mapping',
  })

  it('retries a delivery failure and gets the delivered Run back', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [deliveryFailure] }))

    const run = await retryRun(deliveryFailure.id)

    expect(run).toMatchObject({ id: deliveryFailure.id, status: 'delivered' })
  })

  it('reprocesses a mapping failure with the chosen Mapping Version', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [mappingFailure] }))
    const { mappingVersion } = await getRun(mappingFailure.id)
    const versions = await listMappingVersions(mappingVersion!.mappingId)

    const run = await reprocessRun(mappingFailure.id, { mappingVersionId: versions.at(-1)!.id })

    expect(run.replaces).toEqual({ id: mappingFailure.id })
    expect(run.mappingVersion).toEqual(versions.at(-1))
  })

  it('rejects with the response status when an action is not allowed', async () => {
    server.use(...runDetailHandlers(apiUrl, { runs: [mappingFailure] }))

    await expect(retryRun(mappingFailure.id)).rejects.toMatchObject({
      status: 409,
      path: `/runs/${mappingFailure.id}/retry`,
    })
  })
})

describe('listRuns', () => {
  it.each([
    [true, ['00000000-0000-4000-8000-000000000001']],
    [false, ['00000000-0000-4000-8000-000000000002']],
  ])(
    'filters by Manual Submission = %s together with multi-value filters',
    async (manualSubmission, expected) => {
      server.use(runsHandler(apiUrl, runs))

      const result = await listRuns({
        status: ['delivered', 'failed'],
        tradingPartnerId: [partnerA.id, partnerB.id],
        manualSubmission,
        page: 1,
        pageSize: 50,
      })

      expect(result.runs.map((run) => run.id)).toEqual(expected)
    },
  )
})
