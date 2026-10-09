import {
  type MappingVersionSummary,
  mappingVersionSummarySchema,
  type RunSummary,
} from '@edi-bridge/contracts'

import { isOutbound } from './flow'
import { seededFaker } from './seed-id'

const firstPublication = Date.parse('2026-03-02T09:00:00.000Z')

export function mappingVersionsForFlow({
  flow,
  messageType,
}: Pick<RunSummary, 'flow' | 'messageType'>): MappingVersionSummary[] {
  const faker = seededFaker(`mapping:${flow.id}`)
  const mappingId = faker.string.uuid()
  const partner = flow.name.split(' ')[0]

  const mappingName = isOutbound(messageType)
    ? `${partner}: ERP JSON to ${messageType}`
    : `${partner}: ${messageType} to ERP JSON`

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
