import { describe, expect, it } from 'vitest'

import { canSwitchToProduction, onboardingChecklist, type TradingPartner } from './trading-partner'

const ownGln = '4006381333931'

function partner(
  overrides: Partial<Pick<TradingPartner, 'testMode' | 'onboarding'>> = {},
): Pick<TradingPartner, 'testMode' | 'onboarding'> {
  return {
    testMode: true,
    onboarding: { testInterchangeSentAt: null, contrlReceivedAt: null },
    ...overrides,
  }
}

const sent = '2026-10-01T08:00:00.000Z'

const received = '2026-10-01T08:05:00.000Z'

function states(...args: Parameters<typeof onboardingChecklist>) {
  return onboardingChecklist(...args).map(({ step, state }) => `${step}:${state}`)
}

describe('onboardingChecklist', () => {
  it('waits for the first test Interchange of a new Trading Partner', () => {
    expect(states(partner(), ownGln)).toEqual([
      'identity:done',
      'testInterchange:current',
      'contrl:pending',
      'production:pending',
    ])
  })

  it('keeps the identity step open while the Workspace has no GLN', () => {
    expect(states(partner(), null)).toEqual([
      'identity:current',
      'testInterchange:pending',
      'contrl:pending',
      'production:pending',
    ])
  })

  it('waits for the CONTRL after the test Interchange was sent', () => {
    const checklist = onboardingChecklist(
      partner({ onboarding: { testInterchangeSentAt: sent, contrlReceivedAt: null } }),
      ownGln,
    )

    expect(checklist).toEqual([
      { step: 'identity', state: 'done', at: null },
      { step: 'testInterchange', state: 'done', at: sent },
      { step: 'contrl', state: 'current', at: null },
      { step: 'production', state: 'pending', at: null },
    ])
  })

  it('offers the production switch once the CONTRL is received', () => {
    expect(
      states(
        partner({ onboarding: { testInterchangeSentAt: sent, contrlReceivedAt: received } }),
        ownGln,
      ),
    ).toEqual(['identity:done', 'testInterchange:done', 'contrl:done', 'production:current'])
  })

  it('completes every step for a Trading Partner in production', () => {
    expect(
      states(
        partner({
          testMode: false,
          onboarding: { testInterchangeSentAt: sent, contrlReceivedAt: received },
        }),
        ownGln,
      ),
    ).toEqual(['identity:done', 'testInterchange:done', 'contrl:done', 'production:done'])
  })
})

describe('canSwitchToProduction', () => {
  it.each([
    ['before the CONTRL arrives', { testInterchangeSentAt: sent, contrlReceivedAt: null }, ownGln],
    [
      'without the Workspace GLN',
      { testInterchangeSentAt: sent, contrlReceivedAt: received },
      null,
    ],
  ])('refuses %s', (_, onboarding, gln) => {
    expect(canSwitchToProduction(partner({ onboarding }), gln)).toBe(false)
  })

  it('allows the switch once all earlier steps are done', () => {
    expect(
      canSwitchToProduction(
        partner({ onboarding: { testInterchangeSentAt: sent, contrlReceivedAt: received } }),
        ownGln,
      ),
    ).toBe(true)
  })

  it('refuses a Trading Partner that is already in production', () => {
    expect(
      canSwitchToProduction(
        partner({
          testMode: false,
          onboarding: { testInterchangeSentAt: sent, contrlReceivedAt: received },
        }),
        ownGln,
      ),
    ).toBe(false)
  })
})
