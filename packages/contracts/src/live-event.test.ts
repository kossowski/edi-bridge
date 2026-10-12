import { describe, expect, it } from 'vitest'

import { parseLiveEvent } from './live-event'

const run = {
  id: '6f1c2a5e-8d4b-4c3e-9a7f-1b2c3d4e5f60',
  status: 'delivered',
  failureStage: null,
  receivedAt: '2026-10-10T12:00:00.000Z',
  tradingPartner: { id: '10000000-0000-4000-8000-000000000001', name: 'Hansemarkt GmbH' },
  messageType: 'ORDERS',
  direction: 'inbound',
  flow: { id: '20000000-0000-4000-8000-000000000001', name: 'Hansemarkt ORDERS' },
  manualSubmission: false,
  businessReference: 'PO000001',
  interchange: { id: '30000000-0000-4000-8000-000000000001', controlReference: '1' },
}

describe('parseLiveEvent', () => {
  it('reads a changed Run from the data of a Server-Sent Event', () => {
    expect(parseLiveEvent(JSON.stringify({ type: 'run.changed', run }))).toEqual({
      type: 'run.changed',
      run,
    })
  })

  it('skips an event type this client does not know yet, so a newer api never breaks it', () => {
    expect(parseLiveEvent(JSON.stringify({ type: 'acknowledgement.received' }))).toBeNull()
  })

  it.each([
    ['data that is not JSON', 'run.changed'],
    ['a Run that breaks the contract', JSON.stringify({ type: 'run.changed', run: { id: 1 } })],
  ])('skips %s', (_, data) => {
    expect(parseLiveEvent(data)).toBeNull()
  })
})
