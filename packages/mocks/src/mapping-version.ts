import {
  type MappingVersionSummary,
  mappingVersionSummarySchema,
  type RunSummary,
} from '@edi-bridge/contracts'

import { directionOf } from './flow'
import { seededFaker } from './seeded-faker'

const firstPublication = Date.parse('2026-03-02T09:00:00.000Z')

export function mappingVersionsForFlow({
  flow,
  messageType,
}: Pick<RunSummary, 'flow' | 'messageType'>): MappingVersionSummary[] {
  const faker = seededFaker(`mapping:${flow.id}`)
  const mappingId = faker.string.uuid()
  const tradingPartnerName = flow.name.split(' ')[0]

  const mappingName =
    directionOf({ messageType }) === 'outbound'
      ? `${tradingPartnerName}: ERP JSON to ${messageType}`
      : `${tradingPartnerName}: ${messageType} to ERP JSON`

  const count = faker.number.int({ min: 1, max: 5 })

  return Array.from({ length: count }, (_, index) => {
    const version = count - index

    return mappingVersionSummarySchema.parse({
      id: faker.string.uuid(),
      mappingId,
      mappingName,
      version,
      publishedAt: new Date(firstPublication + (version - 1) * 23 * 86_400_000).toISOString(),
    })
  })
}
