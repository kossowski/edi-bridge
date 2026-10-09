import { z } from 'zod'

import { glnSchema } from './gln'

import type { Endpoint } from './endpoint'

export const tradingPartnerSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
})

export type TradingPartnerSummary = z.infer<typeof tradingPartnerSummarySchema>

export const characterSets = ['UNOA', 'UNOB', 'UNOC', 'UNOD', 'UNOE', 'UNOF'] as const

export const characterSetSchema = z.enum(characterSets)

export type CharacterSet = z.infer<typeof characterSetSchema>

export const acknowledgementTimeLimitHours = { min: 1, max: 168, default: 24 } as const

export const tradingPartnerOnboardingSchema = z.object({
  testInterchangeSentAt: z.iso.datetime().nullable(),
  contrlReceivedAt: z.iso.datetime().nullable(),
})

export type TradingPartnerOnboarding = z.infer<typeof tradingPartnerOnboardingSchema>

export const tradingPartnerInputSchema = z.object({
  name: z.string().trim().min(1).max(70),
  gln: glnSchema,
  characterSet: characterSetSchema,
  acknowledgementTimeLimitHours: z
    .number()
    .int()
    .min(acknowledgementTimeLimitHours.min)
    .max(acknowledgementTimeLimitHours.max),
})

export type TradingPartnerInput = z.infer<typeof tradingPartnerInputSchema>

export const tradingPartnerSchema = tradingPartnerInputSchema.extend({
  id: z.uuid(),
  testMode: z.boolean(),
  onboarding: tradingPartnerOnboardingSchema,
})

export type TradingPartner = z.infer<typeof tradingPartnerSchema>

export const onboardingSteps = ['identity', 'testInterchange', 'contrl', 'production'] as const

export type OnboardingStep = (typeof onboardingSteps)[number]

export type OnboardingStepState = 'done' | 'current' | 'pending'

export type OnboardingChecklistItem = {
  step: OnboardingStep
  state: OnboardingStepState
  at: string | null
}

export function onboardingChecklist(
  tradingPartner: Pick<TradingPartner, 'testMode' | 'onboarding'>,
  workspaceGln: string | null,
): OnboardingChecklistItem[] {
  const { testInterchangeSentAt, contrlReceivedAt } = tradingPartner.onboarding

  const steps: ReadonlyArray<{ step: OnboardingStep; done: boolean; at: string | null }> = [
    { step: 'identity', done: workspaceGln !== null, at: null },
    { step: 'testInterchange', done: testInterchangeSentAt !== null, at: testInterchangeSentAt },
    { step: 'contrl', done: contrlReceivedAt !== null, at: contrlReceivedAt },
    { step: 'production', done: !tradingPartner.testMode, at: null },
  ]

  const current = steps.findIndex(({ done }) => !done)

  return steps.map(({ step, done, at }, index) => ({
    step,
    state: done ? 'done' : index === current ? 'current' : 'pending',
    at,
  }))
}

export function canSwitchToProduction(
  tradingPartner: Pick<TradingPartner, 'testMode' | 'onboarding'>,
  workspaceGln: string | null,
) {
  return onboardingChecklist(tradingPartner, workspaceGln).at(-1)?.state === 'current'
}

export const tradingPartnersEndpoint: Endpoint<TradingPartner[]> = {
  method: 'GET',
  path: '/trading-partners',
  response: z.array(tradingPartnerSchema),
}

export const tradingPartnerEndpoint: Endpoint<
  TradingPartner,
  undefined,
  undefined,
  '/trading-partners/:id'
> = {
  method: 'GET',
  path: '/trading-partners/:id',
  response: tradingPartnerSchema,
}

export const createTradingPartnerEndpoint: Endpoint<
  TradingPartner,
  undefined,
  TradingPartnerInput,
  '/trading-partners'
> = {
  method: 'POST',
  path: '/trading-partners',
  body: tradingPartnerInputSchema,
  response: tradingPartnerSchema,
}

export const updateTradingPartnerEndpoint: Endpoint<
  TradingPartner,
  undefined,
  TradingPartnerInput,
  '/trading-partners/:id'
> = {
  method: 'PUT',
  path: '/trading-partners/:id',
  body: tradingPartnerInputSchema,
  response: tradingPartnerSchema,
}

export const switchToProductionEndpoint: Endpoint<
  TradingPartner,
  undefined,
  undefined,
  '/trading-partners/:id/production'
> = {
  method: 'POST',
  path: '/trading-partners/:id/production',
  response: tradingPartnerSchema,
}
