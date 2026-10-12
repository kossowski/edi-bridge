import { onboardingChecklist } from '@edi-bridge/contracts'

import type { OnboardingStep, TradingPartner, TradingPartnerActivity } from '@edi-bridge/contracts'

export type PartnerSetupStep = OnboardingStep | 'connections' | 'documents'

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
  const steps = onboardingChecklist(tradingPartner, workspaceGln).flatMap(
    ({ step, state }): PartnerSetup['steps'] =>
      step === 'identity'
        ? [
            { step, done: state === 'done' },
            { step: 'connections', done: activity.channelCount > 0 },
            { step: 'documents', done: activity.flowCount > 0 },
          ]
        : [{ step, done: state === 'done' }],
  )

  return {
    steps,
    done: steps.filter(({ done }) => done).length,
    total: steps.length,
    next: steps.find(({ done }) => !done)?.step ?? null,
  }
}
