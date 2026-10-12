import { z } from 'zod'

import type { Channel } from './channel'
import type { Endpoint } from './endpoint'
import type { TradingPartner } from './trading-partner'

export const firstStepIds = [
  'gln',
  'erpConnection',
  'tradingPartner',
  'mapping',
  'testInterchange',
  'production',
] as const

export type FirstStepId = (typeof firstStepIds)[number]

const companySettingsTargetSchema = z.object({ kind: z.literal('companySettings') })

const newChannelTargetSchema = z.object({ kind: z.literal('newChannel') })

const newTradingPartnerTargetSchema = z.object({ kind: z.literal('newTradingPartner') })

const mappingsTargetSchema = z.object({ kind: z.literal('mappings') })

const tradingPartnerTargetSchema = z.object({
  kind: z.literal('tradingPartner'),
  tradingPartnerId: z.uuid(),
})

const onboardingTargetSchema = z.discriminatedUnion('kind', [
  tradingPartnerTargetSchema,
  newTradingPartnerTargetSchema,
])

function stepSchema<Id extends FirstStepId, Target extends z.ZodType>(id: Id, target: Target) {
  return z.object({ id: z.literal(id), done: z.boolean(), target })
}

export const firstStepsSchema = z.object({
  steps: z.tuple([
    stepSchema('gln', companySettingsTargetSchema),
    stepSchema('erpConnection', newChannelTargetSchema),
    stepSchema('tradingPartner', newTradingPartnerTargetSchema),
    stepSchema('mapping', mappingsTargetSchema),
    stepSchema('testInterchange', onboardingTargetSchema),
    stepSchema('production', onboardingTargetSchema),
  ]),
})

export type FirstSteps = z.infer<typeof firstStepsSchema>

export type FirstStep = FirstSteps['steps'][number]

export type FirstStepTarget = FirstStep['target']

export const firstStepsEndpoint: Endpoint<FirstSteps> = {
  method: 'GET',
  path: '/workspaces/current/first-steps',
  response: firstStepsSchema,
}

type OnboardingPartner = Pick<TradingPartner, 'id' | 'testMode' | 'onboarding'>

function onboardingTarget(tradingPartner: OnboardingPartner | undefined) {
  return tradingPartner
    ? ({ kind: 'tradingPartner', tradingPartnerId: tradingPartner.id } as const)
    : ({ kind: 'newTradingPartner' } as const)
}

const testSent = ({ testMode, onboarding }: OnboardingPartner) =>
  !testMode || onboarding.testInterchangeSentAt !== null

export function firstStepsOf({
  gln,
  channels,
  tradingPartners,
  publishedMappingVersions,
}: {
  gln: string | null
  channels: ReadonlyArray<Pick<Channel, 'tradingPartnerId'>>
  tradingPartners: ReadonlyArray<OnboardingPartner>
  publishedMappingVersions: number
}): FirstSteps {
  const inTestMode = tradingPartners.filter(({ testMode }) => testMode)
  const awaitingTest = inTestMode.find((tradingPartner) => !testSent(tradingPartner))
  const tested = inTestMode.find(testSent)

  return {
    steps: [
      { id: 'gln', done: gln !== null, target: { kind: 'companySettings' } },
      {
        id: 'erpConnection',
        done: channels.some(({ tradingPartnerId }) => tradingPartnerId === null),
        target: { kind: 'newChannel' },
      },
      {
        id: 'tradingPartner',
        done: tradingPartners.length > 0,
        target: { kind: 'newTradingPartner' },
      },
      { id: 'mapping', done: publishedMappingVersions > 0, target: { kind: 'mappings' } },
      {
        id: 'testInterchange',
        done: tradingPartners.some(testSent),
        target: onboardingTarget(awaitingTest ?? tradingPartners[0]),
      },
      {
        id: 'production',
        done: tradingPartners.some(({ testMode }) => !testMode),
        target: onboardingTarget(tested ?? inTestMode[0] ?? tradingPartners[0]),
      },
    ],
  }
}

export function firstStepsProgress({ steps }: FirstSteps) {
  return {
    done: steps.filter(({ done }) => done).length,
    total: steps.length,
    next: steps.find(({ done }) => !done)?.id,
    setUp: steps.some(({ id, done }) => id === 'tradingPartner' && done),
  }
}
