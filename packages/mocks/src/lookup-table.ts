import { en, Faker } from '@faker-js/faker'
import { http, HttpResponse } from 'msw'

import {
  type LookupTableScope,
  type LookupTableSummary,
  lookupTableSummarySchema,
  lookupTablesEndpoint,
  type TradingPartner,
} from '@edi-bridge/contracts'

import { seedId } from './seed-id'
import { seedTradingPartners } from './trading-partner'

const workspace: LookupTableScope = { kind: 'workspace' }

function partnerScope(tradingPartner: Pick<TradingPartner, 'id' | 'name'>): LookupTableScope {
  return {
    kind: 'tradingPartner',
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
  }
}

const [hansemarkt, alpenfrisch] = seedTradingPartners

const seeds: ReadonlyArray<Omit<LookupTableSummary, 'id'>> = [
  { name: 'Units of measure', scope: workspace },
  { name: 'Country codes', scope: workspace },
  { name: 'VAT categories', scope: workspace },
  { name: 'Hansemarkt units', scope: partnerScope(hansemarkt!) },
  { name: 'Alpenfrisch article groups', scope: partnerScope(alpenfrisch!) },
]

export const seedLookupTables: ReadonlyArray<LookupTableSummary> = seeds.map((seed, index) =>
  lookupTableSummarySchema.parse({ id: seedId(8, index + 1), ...seed }),
)

export function seedLookupTableNamed(name: string): LookupTableSummary {
  const found = seedLookupTables.find((table) => table.name === name)

  if (!found) {
    throw new Error(`No seed Lookup Table named ${name}`)
  }

  return found
}

const subjects = ['units', 'country codes', 'article groups', 'VAT categories', 'packaging types']

export function createLookupTables({
  count,
  seed = 31,
  tradingPartners = seedTradingPartners,
}: {
  count: number
  seed?: number
  tradingPartners?: ReadonlyArray<Pick<TradingPartner, 'id' | 'name'>>
}): LookupTableSummary[] {
  const faker = new Faker({ locale: [en], seed })

  return Array.from({ length: count }, (_, index) => {
    const tradingPartner = index % 3 === 0 ? null : faker.helpers.arrayElement(tradingPartners)
    const subject = faker.helpers.arrayElement(subjects)

    return lookupTableSummarySchema.parse({
      id: faker.string.uuid(),
      name: tradingPartner
        ? `${tradingPartner.name.split(/[\s,]/)[0]} ${subject} ${index + 1}`
        : `${subject[0]!.toUpperCase()}${subject.slice(1)} ${index + 1}`,
      scope: tradingPartner ? partnerScope(tradingPartner) : workspace,
    })
  })
}

export function lookupTablesHandler(
  apiUrl: string,
  lookupTables: ReadonlyArray<LookupTableSummary> = seedLookupTables,
) {
  return http.get(`${apiUrl}${lookupTablesEndpoint.path}`, () =>
    HttpResponse.json([...lookupTables].sort((a, b) => a.name.localeCompare(b.name, 'de'))),
  )
}
