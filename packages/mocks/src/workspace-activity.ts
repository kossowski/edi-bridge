import { en, Faker } from '@faker-js/faker'
import { delay, http } from 'msw'

import {
  failureStages,
  type FinishedRunCounts,
  messageTypes,
  type OverdueAcknowledgement,
  overdueAcknowledgementSchema,
  type RunStatus,
  type RunSummary,
  type TradingPartner,
} from '@edi-bridge/contracts'

import { hour } from './overdue'
import {
  generateOverdueAcknowledgement,
  seedOverdueAcknowledgements,
} from './overdue-acknowledgement'
import { serverError } from './responses'
import { seedRuns, toRunSummary } from './run'
import { seedReprocessed } from './run-detail'
import { createRunStore, type RunStore, type WaitingForTradingPartnerSince } from './run-store'
import { createTradingPartners, seedTradingPartners } from './trading-partner'

export type WorkspaceActivity = {
  runs: ReadonlyArray<RunSummary> | RunStore
  tradingPartners: ReadonlyArray<TradingPartner>
  overdueAcknowledgements: ReadonlyArray<OverdueAcknowledgement>
  waitingForTradingPartnerSince?: WaitingForTradingPartnerSince | undefined
}

export type WorkspaceActivityState = 'empty' | 'large' | 'loading' | 'error'

export const isFinished = (status: RunStatus): status is keyof FinishedRunCounts =>
  status === 'delivered' || status === 'failed'

export const emptyWorkspaceActivity: WorkspaceActivity = {
  runs: [],
  tradingPartners: [],
  overdueAcknowledgements: [],
}

const healthProfiles = [
  { value: { errorShare: 0.01, overdue: false }, weight: 60 },
  { value: { errorShare: 0.1, overdue: true }, weight: 25 },
  { value: { errorShare: 0.4, overdue: true }, weight: 15 },
]

const inProgressLookback = 2 * hour

function generatedRunStatus(faker: Faker, errorShare: number, receivedAt: Date, now: Date) {
  if (
    now.getTime() - receivedAt.getTime() < inProgressLookback &&
    faker.datatype.boolean({ probability: 0.2 })
  ) {
    return { status: 'processing', failureStage: null } as const
  }

  return faker.datatype.boolean({ probability: errorShare })
    ? ({ status: 'failed', failureStage: faker.helpers.arrayElement(failureStages) } as const)
    : ({ status: 'delivered', failureStage: null } as const)
}

export function createWorkspaceActivity({
  tradingPartnerCount,
  overdueCount,
  runCount,
  days = 30,
  now = new Date(),
  seed = 16,
}: {
  tradingPartnerCount: number
  overdueCount: number
  runCount: number
  days?: number
  now?: Date
  seed?: number
}): WorkspaceActivity {
  const faker = new Faker({ locale: [en], seed })
  const tradingPartners = createTradingPartners({ count: tradingPartnerCount, now, seed })

  const profiled = tradingPartners.map((tradingPartner) => ({
    tradingPartner,
    ...faker.helpers.weightedArrayElement(healthProfiles),
  }))

  const from = new Date(now.getTime() - days * 24 * hour)

  const runs = Array.from({ length: runCount }, () => {
    const { tradingPartner, errorShare } = faker.helpers.arrayElement(profiled)
    const messageType = faker.helpers.arrayElement(messageTypes)
    const receivedAt = faker.date.between({ from, to: now })

    return toRunSummary({
      id: faker.string.uuid(),
      receivedAt: receivedAt.toISOString(),
      tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
      messageType,
      flow: { id: faker.string.uuid(), name: `${tradingPartner.name} ${messageType}` },
      manualSubmission: false,
      ...generatedRunStatus(faker, errorShare, receivedAt, now),
    })
  })

  const inProduction = profiled.filter(({ tradingPartner }) => !tradingPartner.testMode)
  const overdueProfiled = inProduction.filter(({ overdue }) => overdue)
  const overdueCandidates = overdueProfiled.length > 0 ? overdueProfiled : inProduction

  const overdueAcknowledgements =
    overdueCandidates.length === 0
      ? []
      : Array.from({ length: overdueCount }, () =>
          overdueAcknowledgementSchema.parse(
            generateOverdueAcknowledgement(
              faker,
              faker.helpers.arrayElement(overdueCandidates).tradingPartner,
              now,
            ),
          ),
        )

  return { runs, tradingPartners, overdueAcknowledgements }
}

export const largeWorkspaceActivity = () =>
  createWorkspaceActivity({ tradingPartnerCount: 240, overdueCount: 500, runCount: 30_000 })

function seedRunStore() {
  const runs = seedRuns()

  return createRunStore(runs, seedReprocessed(runs))
}

export function seedWorkspaceActivity(
  runs: RunStore = seedRunStore(),
  waitingForTradingPartnerSince?: WaitingForTradingPartnerSince,
): WorkspaceActivity {
  return {
    runs,
    waitingForTradingPartnerSince,
    tradingPartners: seedTradingPartners,
    get overdueAcknowledgements() {
      return seedOverdueAcknowledgements(runs.all())
    },
  }
}

let cachedLargeWorkspaceActivity: WorkspaceActivity | undefined

export function workspaceActivityOf(
  source: WorkspaceActivity | 'empty' | 'large' | undefined,
): WorkspaceActivity {
  switch (source) {
    case undefined:
      return seedWorkspaceActivity()
    case 'empty':
      return emptyWorkspaceActivity
    case 'large':
      return (cachedLargeWorkspaceActivity ??= largeWorkspaceActivity())
    default:
      return source
  }
}

export function workspaceActivityHandler(
  path: string,
  source: WorkspaceActivity | WorkspaceActivityState | undefined,
  respond: (activity: WorkspaceActivity, request: Request) => Response,
) {
  if (source === 'loading') {
    return http.get(path, async () => {
      await delay('infinite')
    })
  }

  if (source === 'error') {
    return http.get(path, () => serverError())
  }

  let activity: WorkspaceActivity | undefined

  return http.get(path, ({ request }) => {
    activity ??= workspaceActivityOf(source)

    return respond(activity, request)
  })
}
