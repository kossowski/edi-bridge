import { http, HttpResponse } from 'msw'

import {
  directionOf,
  fromSearchParams,
  type MappingVersionSummary,
  mappingVersionSummarySchema,
  type MessageType,
  publishedMappingVersionsEndpoint,
  type RunSummary,
} from '@edi-bridge/contracts'

import { badRequest } from './responses'
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

// A Mapping with its published versions, newest first. The Message Type is what the Mapping
// reads or writes, so the Flow form only offers versions that fit the Flow.
export type MappingRecord = {
  mappingId: string
  messageType: MessageType
  versions: ReadonlyArray<MappingVersionSummary>
}

export function mappingOfFlow(flow: {
  id: string
  name: string
  messageType: MessageType
}): MappingRecord {
  const versions = mappingVersionsForFlow({ flow, messageType: flow.messageType })

  return { mappingId: versions[0]!.mappingId, messageType: flow.messageType, versions }
}

export type MappingCatalogue = {
  all: () => readonly MappingRecord[]
  published: (messageType?: MessageType) => MappingVersionSummary[]
  find: (
    mappingVersionId: string,
  ) => { mapping: MappingRecord; version: MappingVersionSummary } | undefined
}

export function createMappingCatalogue(mappings: ReadonlyArray<MappingRecord>): MappingCatalogue {
  const byVersionId = new Map(
    mappings.flatMap((mapping) =>
      mapping.versions.map((version) => [version.id, { mapping, version }] as const),
    ),
  )

  return {
    all: () => mappings,
    published: (messageType) =>
      mappings
        .filter((mapping) => messageType === undefined || mapping.messageType === messageType)
        .flatMap(({ versions }) => versions)
        .sort((a, b) => a.mappingName.localeCompare(b.mappingName, 'de') || b.version - a.version),
    find: (mappingVersionId) => byVersionId.get(mappingVersionId),
  }
}

export function toMappingCatalogue(mappings: ReadonlyArray<MappingRecord> | MappingCatalogue) {
  return 'published' in mappings ? mappings : createMappingCatalogue(mappings)
}

export function publishedMappingVersionsHandler(
  apiUrl: string,
  mappings: ReadonlyArray<MappingRecord> | MappingCatalogue,
) {
  const catalogue = toMappingCatalogue(mappings)

  return http.get(`${apiUrl}${publishedMappingVersionsEndpoint.path}`, ({ request }) => {
    const query = publishedMappingVersionsEndpoint.query.safeParse(
      fromSearchParams(new URL(request.url).searchParams),
    )

    return query.success
      ? HttpResponse.json(catalogue.published(query.data.messageType))
      : badRequest(query.error.message)
  })
}
