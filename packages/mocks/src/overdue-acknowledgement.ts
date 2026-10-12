import { type Faker, faker as defaultFaker } from '@faker-js/faker'

import {
  directionOf,
  type OverdueAcknowledgement,
  overdueAcknowledgementMessageTypes,
  overdueAcknowledgementSchema,
  type RunSummary,
  type TradingPartner,
} from '@edi-bridge/contracts'

import { hour, isUnacknowledged, overdueSinceOf } from './overdue'
import { seedRuns } from './run'
import { controlReferenceOf, interchangeIdOf } from './run-store'
import { seedTradingPartners } from './trading-partner'

const overdueLookback = 72 * hour

export function generateOverdueAcknowledgement(
  faker: Faker,
  tradingPartner: Pick<TradingPartner, 'id' | 'name' | 'acknowledgementTimeLimitHours'>,
  now: Date,
): OverdueAcknowledgement {
  const overdueSince = faker.date.between({ from: now.getTime() - overdueLookback, to: now })
  const { acknowledgementTimeLimitHours } = tradingPartner
  const id = faker.string.uuid()

  return {
    interchange: { id, controlReference: controlReferenceOf(id) },
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
    messageType: faker.helpers.arrayElement(overdueAcknowledgementMessageTypes),
    sentAt: new Date(overdueSince.getTime() - acknowledgementTimeLimitHours * hour).toISOString(),
    acknowledgementTimeLimitHours,
    overdueSince: overdueSince.toISOString(),
  }
}

export function createOverdueAcknowledgement(
  overrides: Partial<OverdueAcknowledgement> = {},
): OverdueAcknowledgement {
  const tradingPartner = defaultFaker.helpers.arrayElement(
    seedTradingPartners.filter(({ testMode }) => !testMode),
  )

  return overdueAcknowledgementSchema.parse({
    ...generateOverdueAcknowledgement(defaultFaker, tradingPartner, new Date()),
    ...overrides,
  })
}

// An outbound Run delivers its own Interchange, so a few recent delivered ones stand for sent
// Interchanges whose Acknowledgement never arrived. Test Mode traffic is checked during onboarding.
export function seedOverdueAcknowledgements(
  runs: ReadonlyArray<RunSummary> = seedRuns(),
  tradingPartners: ReadonlyArray<TradingPartner> = seedTradingPartners,
  now = new Date(),
): OverdueAcknowledgement[] {
  const byId = new Map(tradingPartners.map((tradingPartner) => [tradingPartner.id, tradingPartner]))

  return runs.flatMap((run) => {
    const tradingPartner = byId.get(run.tradingPartner.id)

    if (
      !tradingPartner ||
      tradingPartner.testMode ||
      run.status !== 'delivered' ||
      Date.parse(run.receivedAt) < now.getTime() - overdueLookback ||
      directionOf(run) !== 'outbound' ||
      !isUnacknowledged(run)
    ) {
      return []
    }

    const { acknowledgementTimeLimitHours } = tradingPartner
    const overdueSince = overdueSinceOf(run.receivedAt, tradingPartner)

    if (overdueSince > now.getTime()) {
      return []
    }

    const id = interchangeIdOf(run)

    return [
      overdueAcknowledgementSchema.parse({
        interchange: { id, controlReference: controlReferenceOf(id) },
        tradingPartner: run.tradingPartner,
        messageType: run.messageType,
        sentAt: run.receivedAt,
        acknowledgementTimeLimitHours,
        overdueSince: new Date(overdueSince).toISOString(),
      }),
    ]
  })
}
