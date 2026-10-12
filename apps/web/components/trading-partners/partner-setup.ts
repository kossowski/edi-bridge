import type { TradingPartner, TradingPartnerActivity } from '@edi-bridge/contracts'

export const partnerSetupSteps = [
  'identity',
  'connections',
  'documents',
  'testInterchange',
  'contrl',
  'production',
] as const

export type PartnerSetupStep = (typeof partnerSetupSteps)[number]

export type PartnerSetup = {
  steps: ReadonlyArray<{ step: PartnerSetupStep; done: boolean }>
  done: number
  total: number
  next: PartnerSetupStep | null
}

export function partnerSetup(
  tradingPartner: Pick<TradingPartner, 'testMode' | 'onboarding'>,
  activity: Pick<TradingPartnerActivity, 'channelCount' | 'flowCount'>,
  workspaceGln: string | null,
): PartnerSetup {
  const { testInterchangeSentAt, contrlReceivedAt } = tradingPartner.onboarding

  const steps = [
    { step: 'identity', done: workspaceGln !== null },
    { step: 'connections', done: activity.channelCount > 0 },
    { step: 'documents', done: activity.flowCount > 0 },
    { step: 'testInterchange', done: testInterchangeSentAt !== null },
    { step: 'contrl', done: contrlReceivedAt !== null },
    { step: 'production', done: !tradingPartner.testMode },
  ] as const satisfies ReadonlyArray<{ step: PartnerSetupStep; done: boolean }>

  return {
    steps,
    done: steps.filter(({ done }) => done).length,
    total: steps.length,
    next: steps.find(({ done }) => !done)?.step ?? null,
  }
}
