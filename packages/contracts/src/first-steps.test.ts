import { describe, expect, it } from 'vitest'

import { firstStepsOf, firstStepsProgress, firstStepsSchema } from './first-steps'

const gln = '4012345000009'

const erpChannel = { tradingPartnerId: null }

const partnerChannel = { tradingPartnerId: '10000000-0000-4000-8000-000000000001' }

const notStarted = { testInterchangeSentAt: null, contrlReceivedAt: null }

const awaitingTest = {
  id: '10000000-0000-4000-8000-000000000001',
  testMode: true,
  onboarding: notStarted,
}

const tested = {
  id: '10000000-0000-4000-8000-000000000002',
  testMode: true,
  onboarding: { testInterchangeSentAt: '2026-10-06T14:03:00.000Z', contrlReceivedAt: null },
}

const live = {
  id: '10000000-0000-4000-8000-000000000003',
  testMode: false,
  onboarding: {
    testInterchangeSentAt: '2026-10-01T09:12:00.000Z',
    contrlReceivedAt: '2026-10-01T09:14:30.000Z',
  },
}

const fresh = { gln: null, channels: [], tradingPartners: [], publishedMappingVersions: 0 }

const doneOf = (steps: ReturnType<typeof firstStepsOf>) =>
  Object.fromEntries(steps.steps.map(({ id, done }) => [id, done]))

describe('firstStepsOf', () => {
  it('leaves every step open in a fresh Workspace', () => {
    const steps = firstStepsOf(fresh)

    expect(doneOf(steps)).toEqual({
      gln: false,
      erpConnection: false,
      tradingPartner: false,
      mapping: false,
      testInterchange: false,
      production: false,
    })
    expect(steps.steps[4].target).toEqual({ kind: 'newTradingPartner' })
    expect(firstStepsSchema.parse(steps)).toEqual(steps)
  })

  it('counts only a Channel to the own systems as the ERP connection', () => {
    expect(doneOf(firstStepsOf({ ...fresh, channels: [partnerChannel] })).erpConnection).toBe(false)
    expect(doneOf(firstStepsOf({ ...fresh, channels: [erpChannel] })).erpConnection).toBe(true)
  })

  it('sends the test and the go-live to the Trading Partner that is next in onboarding', () => {
    const steps = firstStepsOf({
      gln,
      channels: [erpChannel],
      tradingPartners: [tested, awaitingTest],
      publishedMappingVersions: 1,
    })

    expect(doneOf(steps)).toMatchObject({ testInterchange: true, production: false })
    expect(steps.steps[4].target).toEqual({
      kind: 'tradingPartner',
      tradingPartnerId: awaitingTest.id,
    })
    expect(steps.steps[5].target).toEqual({ kind: 'tradingPartner', tradingPartnerId: tested.id })
  })

  it('counts the test as sent by the same rule as the onboarding checklist', () => {
    const steps = firstStepsOf({
      gln,
      channels: [erpChannel],
      tradingPartners: [{ ...live, onboarding: notStarted }],
      publishedMappingVersions: 1,
    })

    expect(doneOf(steps)).toMatchObject({ testInterchange: false, production: true })
  })

  it('treats a live Trading Partner as tested and live', () => {
    const steps = firstStepsOf({
      gln,
      channels: [erpChannel],
      tradingPartners: [live],
      publishedMappingVersions: 2,
    })

    expect(Object.values(doneOf(steps)).every(Boolean)).toBe(true)
  })
})

describe('firstStepsProgress', () => {
  it('counts the done steps and names the next open one', () => {
    expect(
      firstStepsProgress(
        firstStepsOf({ ...fresh, gln, channels: [erpChannel], tradingPartners: [awaitingTest] }),
      ),
    ).toEqual({ done: 3, total: 6, next: 'mapping', hasTradingPartner: true })
    expect(firstStepsProgress(firstStepsOf(fresh))).toEqual({
      done: 0,
      total: 6,
      next: 'gln',
      hasTradingPartner: false,
    })
  })
})

describe('firstStepsSchema', () => {
  const steps = firstStepsOf(fresh)

  it('rejects the steps in another order', () => {
    expect(
      firstStepsSchema.safeParse({
        steps: [steps.steps[1], steps.steps[0], ...steps.steps.slice(2)],
      }).success,
    ).toBe(false)
  })

  it('rejects a free-form link instead of a typed target', () => {
    expect(
      firstStepsSchema.safeParse({
        steps: [
          { ...steps.steps[0], target: { kind: 'url', href: '/settings' } },
          ...steps.steps.slice(1),
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects a target that does not fit the step', () => {
    expect(
      firstStepsSchema.safeParse({
        steps: [{ ...steps.steps[0], target: { kind: 'mappings' } }, ...steps.steps.slice(1)],
      }).success,
    ).toBe(false)
  })
})
