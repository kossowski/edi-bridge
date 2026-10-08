import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createRun, runsHandler } from '@edi-bridge/mocks'

import { listRuns } from './client'
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
