import { describe, expect, it } from 'vitest'

import { partnerSetup } from './partner-setup'

const gln = '4012345000009'

const newPartner = {
  testMode: true,
  onboarding: { testInterchangeSentAt: null, contrlReceivedAt: null },
}

const livePartner = {
  testMode: false,
  onboarding: {
    testInterchangeSentAt: '2026-09-01T08:00:00.000Z',
    contrlReceivedAt: '2026-09-01T08:05:00.000Z',
  },
}

const nothingSetUp = { channelCount: 0, flowCount: 0 }

const setUp = { channelCount: 2, flowCount: 3 }

describe('partnerSetup', () => {
  it('starts with your company identity when nothing is set up', () => {
    expect(partnerSetup(newPartner, nothingSetUp, null)).toMatchObject({
      done: 0,
      total: 6,
      next: 'identity',
    })
  })

  it('adds connections and document types to the onboarding steps after the identity', () => {
    expect(partnerSetup(newPartner, nothingSetUp, null).steps.map(({ step }) => step)).toEqual([
      'identity',
      'connections',
      'documents',
      'testInterchange',
      'contrl',
      'production',
    ])
  })

  it('asks for a connection once the company GLN is recorded', () => {
    expect(partnerSetup(newPartner, nothingSetUp, gln)).toMatchObject({
      done: 1,
      next: 'connections',
    })
  })

  it('asks for the document types once a connection exists', () => {
    expect(partnerSetup(newPartner, { channelCount: 1, flowCount: 0 }, gln)).toMatchObject({
      done: 2,
      next: 'documents',
    })
  })

  it('asks for a test document once connections and document types exist', () => {
    expect(partnerSetup(newPartner, setUp, gln)).toMatchObject({
      done: 3,
      next: 'testInterchange',
    })
  })

  it('waits for the receipt confirmation after the test document', () => {
    const sent = {
      ...newPartner,
      onboarding: { ...newPartner.onboarding, testInterchangeSentAt: '2026-10-10T08:00:00.000Z' },
    }

    expect(partnerSetup(sent, setUp, gln)).toMatchObject({ done: 4, next: 'contrl' })
  })

  it('offers going live once the receipt confirmation arrived', () => {
    expect(partnerSetup({ ...livePartner, testMode: true }, setUp, gln)).toMatchObject({
      done: 5,
      next: 'production',
    })
  })

  it('is complete for a live partner with connections and document types', () => {
    const setup = partnerSetup(livePartner, setUp, gln)

    expect(setup).toMatchObject({ done: 6, total: 6, next: null })
    expect(setup.steps.every(({ state }) => state === 'done')).toBe(true)
  })

  it('names the first missing step even when later ones are done', () => {
    expect(partnerSetup(livePartner, { channelCount: 0, flowCount: 1 }, gln)).toMatchObject({
      done: 5,
      next: 'connections',
    })
  })

  it('marks each step as done, next or open', () => {
    expect(
      partnerSetup(newPartner, { channelCount: 1, flowCount: 0 }, gln).steps.map(
        ({ state }) => state,
      ),
    ).toEqual(['done', 'done', 'next', 'open', 'open', 'open'])
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
      { kind: 'addConnection' },
      { kind: 'addDocument' },
      { kind: 'sendTest' },
      { kind: 'awaitConfirmation' },
      { kind: 'goLive' },
    ])
  })
})
