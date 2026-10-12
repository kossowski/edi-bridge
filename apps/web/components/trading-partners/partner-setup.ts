import { onboardingChecklist } from '@edi-bridge/contracts'

import type { OnboardingStep, TradingPartner, TradingPartnerActivity } from '@edi-bridge/contracts'

export type PartnerSetupStep = OnboardingStep | 'connections' | 'documents'

export type PartnerSetupStepState = 'done' | 'next' | 'open'

export type PartnerSetupAction =
  | { kind: 'link'; step: 'identity'; href: string }
  | { kind: 'addConnection' }
  | { kind: 'addDocument' }
  | { kind: 'sendTest' }
  | { kind: 'awaitConfirmation' }
  | { kind: 'goLive' }

const stepActions: Record<PartnerSetupStep, PartnerSetupAction> = {
  identity: { kind: 'link', step: 'identity', href: '/settings' },
  connections: { kind: 'addConnection' },
  documents: { kind: 'addDocument' },
  testInterchange: { kind: 'sendTest' },
  contrl: { kind: 'awaitConfirmation' },
  production: { kind: 'goLive' },
}

export type PartnerSetupItem = {
  step: PartnerSetupStep
  state: PartnerSetupStepState
  doneAt: string | null
  action: PartnerSetupAction
}

export type PartnerSetup = {
  steps: ReadonlyArray<PartnerSetupItem>
  done: number
  total: number
  next: PartnerSetupStep | null
}

export function partnerSetup(
  tradingPartner: Pick<TradingPartner, 'testMode' | 'onboarding'>,
  activity: Pick<TradingPartnerActivity, 'channelCount' | 'flowCount'>,
  workspaceGln: string | null,
): PartnerSetup {
  const checks = onboardingChecklist(tradingPartner, workspaceGln).flatMap(
    ({
      step,
      state,
      at,
    }): ReadonlyArray<{ step: PartnerSetupStep; done: boolean; at: string | null }> =>
      step === 'identity'
        ? [
            { step, done: state === 'done', at },
            { step: 'connections', done: activity.channelCount > 0, at: null },
            { step: 'documents', done: activity.flowCount > 0, at: null },
          ]
        : [{ step, done: state === 'done', at }],
  )

  const next = checks.find(({ done }) => !done)?.step ?? null

  const steps = checks.map(({ step, done, at }): PartnerSetupItem => {
    const action = stepActions[step]

    if (done) {
      return { step, state: 'done', doneAt: at, action }
    }

    return { step, state: step === next ? 'next' : 'open', doneAt: null, action }
  })

  return {
    steps,
    done: checks.filter(({ done }) => done).length,
    total: checks.length,
    next,
  }
}
