import { describe, expect, it } from 'vitest'

import {
  canSendTestInterchange,
  canSwitchToProduction,
  glnRequired,
  onboardingChecklist,
  testInterchangeRefusedProblem,
  testInterchangeRefusedProblemSchema,
  type TradingPartner,
  tradingPartnerInputSchema,
} from './trading-partner'

const ownGln = '4006381333931'

type OnboardingPartner = Pick<TradingPartner, 'gln' | 'testMode' | 'onboarding'>

function partner(overrides: Partial<OnboardingPartner> = {}): OnboardingPartner {
  return {
    gln: '4012345000009',
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

describe('tradingPartnerInputSchema', () => {
  const input = {
    name: 'Kieler Kontor GmbH',
    characterSet: 'UNOC',
    acknowledgementTimeLimitHours: 24,
  }

  it('accepts a Trading Partner whose GLN is added later', () => {
    expect(tradingPartnerInputSchema.parse({ ...input, gln: null })).toMatchObject({ gln: null })
  })

  it('still checks a given GLN', () => {
    expect(tradingPartnerInputSchema.safeParse({ ...input, gln: '4006381333932' }).success).toBe(
      false,
    )
  })
})

describe('onboardingChecklist', () => {
  it('waits for the first test Interchange of a new Trading Partner', () => {
    expect(states(partner(), ownGln)).toEqual([
      'identity:done',
      'partnerGln:done',
      'testInterchange:current',
      'contrl:pending',
      'production:pending',
    ])
  })

  it('keeps the identity step open while the Workspace has no GLN', () => {
    expect(states(partner(), null)).toEqual([
      'identity:current',
      'partnerGln:done',
      'testInterchange:pending',
      'contrl:pending',
      'production:pending',
    ])
  })

  it("asks for the Trading Partner's GLN when it was left for later", () => {
    expect(states(partner({ gln: null }), ownGln)).toEqual([
      'identity:done',
      'partnerGln:current',
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
      { step: 'partnerGln', state: 'done', at: null },
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
    ).toEqual([
      'identity:done',
      'partnerGln:done',
      'testInterchange:done',
      'contrl:done',
      'production:current',
    ])
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
    ).toEqual([
      'identity:done',
      'partnerGln:done',
      'testInterchange:done',
      'contrl:done',
      'production:done',
    ])
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

describe('canSendTestInterchange', () => {
  it('allows the first test Interchange of a Trading Partner in Test Mode', () => {
    expect(canSendTestInterchange(partner(), ownGln)).toBe(true)
  })

  it('allows sending again while the CONTRL is still awaited', () => {
    expect(
      canSendTestInterchange(
        partner({ onboarding: { testInterchangeSentAt: sent, contrlReceivedAt: null } }),
        ownGln,
      ),
    ).toBe(true)
  })

  it.each<[string, OnboardingPartner, string | null]>([
    ['without the Workspace GLN', partner(), null],
    ["without the Trading Partner's GLN", partner({ gln: null }), ownGln],
    [
      'once the CONTRL is received',
      partner({ onboarding: { testInterchangeSentAt: sent, contrlReceivedAt: received } }),
      ownGln,
    ],
    [
      'for a Trading Partner in production',
      partner({
        testMode: false,
        onboarding: { testInterchangeSentAt: sent, contrlReceivedAt: received },
      }),
      ownGln,
    ],
  ])('refuses %s', (_, tradingPartner, gln) => {
    expect(canSendTestInterchange(tradingPartner, gln)).toBe(false)
  })
})

describe('testInterchangeRefusedProblem', () => {
  const flow = { id: '00000000-0000-4000-8000-0000000000f1', name: 'Invoices to Hansemarkt' }

  it('says why a Trading Partner that does not await a test is refused', () => {
    expect(testInterchangeRefusedProblem({ reason: 'notAwaited' })).toEqual({
      reason: 'notAwaited',
      message: 'The Trading Partner does not await a test Interchange.',
    })
  })

  it('says that no outbound Flow leads to the Trading Partner', () => {
    expect(testInterchangeRefusedProblem({ reason: 'noOutboundFlow' })).toEqual({
      reason: 'noOutboundFlow',
      message: 'No outbound Flow leads to the Trading Partner.',
    })
  })

  it('names the Flow whose Document Structure has no sample Document', () => {
    expect(testInterchangeRefusedProblem({ reason: 'sampleMissing', flow })).toEqual({
      reason: 'sampleMissing',
      flow,
      message:
        'The Document Structure of the Flow "Invoices to Hansemarkt" has no sample Document.',
    })
  })

  it('needs the Flow for a missing sample Document', () => {
    expect(
      testInterchangeRefusedProblemSchema.safeParse({ reason: 'sampleMissing', message: 'x' })
        .success,
    ).toBe(false)
  })
})

describe('glnRequired', () => {
  it('lets a Trading Partner without traffic leave its GLN for later', () => {
    expect(glnRequired(partner())).toBe(false)
  })

  it.each<[string, OnboardingPartner]>([
    [
      'once a test Interchange was sent',
      partner({ onboarding: { testInterchangeSentAt: sent, contrlReceivedAt: null } }),
    ],
    ['for a Trading Partner in production', partner({ testMode: false })],
  ])('needs the GLN %s', (_, tradingPartner) => {
    expect(glnRequired(tradingPartner)).toBe(true)
  })
})
