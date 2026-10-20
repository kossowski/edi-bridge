import { describe, expect, it } from 'vitest'

import { partnerSetup } from './partner-setup'

const gln = '4012345000009'

const id = '00000000-0000-4000-8000-000000000001'

const newPartner = {
  id,
  gln: '0234567890129',
  testMode: true,
  onboarding: {
    testInterchangeSentAt: null,
    contrlReceivedAt: null,
    testRejectedAt: null,
    testRejectedRunId: null,
  },
}

const livePartner = {
  id,
  gln: '0234567890129',
  testMode: false,
  onboarding: {
    testInterchangeSentAt: '2026-09-01T08:00:00.000Z',
    contrlReceivedAt: '2026-09-01T08:05:00.000Z',
    testRejectedAt: null,
    testRejectedRunId: null,
  },
}

const bothDirections = ['inbound', 'outbound'] as const

const nothingSetUp = {
  flowCount: 0,
  channelDirections: [],
  neededDirections: [...bothDirections],
}

const setUp = {
  flowCount: 3,
  channelDirections: [...bothDirections],
  neededDirections: [...bothDirections],
}

const oneConnection = { ...nothingSetUp, channelDirections: ['inbound' as const] }

function connectionsOf(setup: ReturnType<typeof partnerSetup>) {
  return setup.steps.find(({ step }) => step === 'connections')
}

describe('partnerSetup', () => {
  it('starts with your company identity when nothing is set up', () => {
    expect(partnerSetup({ ...newPartner, gln: null }, nothingSetUp, null)).toMatchObject({
      done: 0,
      total: 7,
      next: 'identity',
    })
  })

  it('adds connections and document types to the onboarding steps after the identity', () => {
    expect(partnerSetup(newPartner, nothingSetUp, null).steps.map(({ step }) => step)).toEqual([
      'identity',
      'partnerGln',
      'connections',
      'documents',
      'testInterchange',
      'contrl',
      'production',
    ])
  })

  it("asks for the partner's GLN when it was left for later", () => {
    expect(partnerSetup({ ...newPartner, gln: null }, setUp, gln)).toMatchObject({
      done: 3,
      next: 'partnerGln',
    })
  })

  it('asks for a connection once the company GLN is recorded', () => {
    expect(partnerSetup(newPartner, nothingSetUp, gln)).toMatchObject({
      done: 2,
      next: 'connections',
    })
  })

  it('asks for the document types once a connection exists', () => {
    expect(
      partnerSetup(newPartner, { ...oneConnection, neededDirections: ['inbound'] }, gln),
    ).toMatchObject({
      done: 3,
      next: 'documents',
    })
  })

  it('asks for a test document once connections and document types exist', () => {
    expect(partnerSetup(newPartner, setUp, gln)).toMatchObject({
      done: 4,
      next: 'testInterchange',
    })
  })

  it('waits for the receipt confirmation after the test document', () => {
    const sent = {
      ...newPartner,
      onboarding: { ...newPartner.onboarding, testInterchangeSentAt: '2026-10-10T08:00:00.000Z' },
    }

    expect(partnerSetup(sent, setUp, gln)).toMatchObject({ done: 5, next: 'contrl' })
  })

  it('offers going live once the receipt confirmation arrived', () => {
    expect(partnerSetup({ ...livePartner, testMode: true }, setUp, gln)).toMatchObject({
      done: 6,
      next: 'production',
    })
  })

  it('is complete for a live partner with connections and document types', () => {
    const setup = partnerSetup(livePartner, setUp, gln)

    expect(setup).toMatchObject({ done: 7, total: 7, next: null })
    expect(setup.steps.every(({ state }) => state === 'done')).toBe(true)
  })

  it('names the first missing step even when later ones are done', () => {
    expect(partnerSetup(livePartner, { ...nothingSetUp, flowCount: 1 }, gln)).toMatchObject({
      done: 6,
      next: 'connections',
    })
  })

  it('marks each step as done, next or open', () => {
    expect(
      partnerSetup(newPartner, { ...oneConnection, neededDirections: ['inbound'] }, gln).steps.map(
        ({ state }) => state,
      ),
    ).toEqual(['done', 'done', 'done', 'next', 'open', 'open', 'open'])
  })

  it('carries when the test document and the receipt confirmation were done', () => {
    const steps = partnerSetup({ ...livePartner, testMode: true }, setUp, gln).steps

    expect(steps.find(({ step }) => step === 'testInterchange')?.doneAt).toBe(
      livePartner.onboarding.testInterchangeSentAt,
    )
    expect(steps.find(({ step }) => step === 'contrl')?.doneAt).toBe(
      livePartner.onboarding.contrlReceivedAt,
    )
    expect(steps.find(({ step }) => step === 'production')?.doneAt).toBeNull()
  })

  it('names the action of each step', () => {
    expect(partnerSetup(newPartner, nothingSetUp, null).steps.map(({ action }) => action)).toEqual([
      { kind: 'link', step: 'identity', href: '/settings' },
      { kind: 'link', step: 'partnerGln', href: `/trading-partners/${id}?tab=settings` },
      { kind: 'addConnection' },
      { kind: 'addDocument' },
      { kind: 'sendTest' },
      { kind: 'awaitConfirmation' },
      { kind: 'goLive' },
    ])
  })

  describe('connections', () => {
    it('is done once the one needed direction has a connection', () => {
      const setup = partnerSetup(
        newPartner,
        { ...oneConnection, neededDirections: ['inbound'] },
        gln,
      )

      expect(connectionsOf(setup)).toMatchObject({ state: 'done', missingDirections: [] })
    })

    it('stays open while the one needed direction has no connection', () => {
      const setup = partnerSetup(
        newPartner,
        { ...oneConnection, neededDirections: ['outbound'] },
        gln,
      )

      expect(connectionsOf(setup)).toMatchObject({
        state: 'next',
        missingDirections: ['outbound'],
      })
    })

    it('stays open while one of both needed directions has no connection', () => {
      const setup = partnerSetup(newPartner, oneConnection, gln)

      expect(setup).toMatchObject({ done: 2, next: 'connections' })
      expect(connectionsOf(setup)?.missingDirections).toEqual(['outbound'])
    })

    it('is done once both needed directions have a connection', () => {
      expect(connectionsOf(partnerSetup(newPartner, setUp, gln))).toMatchObject({
        state: 'done',
        missingDirections: [],
      })
    })

    it('names both directions as missing without any connection', () => {
      expect(connectionsOf(partnerSetup(newPartner, nothingSetUp, gln))).toMatchObject({
        state: 'next',
        missingDirections: ['inbound', 'outbound'],
      })
    })

    it('names no missing direction for the other steps', () => {
      const others = partnerSetup(newPartner, nothingSetUp, gln).steps.filter(
        ({ step }) => step !== 'connections',
      )

      expect(others.every(({ missingDirections }) => missingDirections.length === 0)).toBe(true)
    })
  })
})
