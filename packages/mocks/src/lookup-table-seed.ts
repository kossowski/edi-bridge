import { en, Faker } from '@faker-js/faker'
import { z } from 'zod'

import {
  blockingMissingCodeSchema,
  type FailedRunReference,
  type LookupTableEntry,
  lookupTableInputSchema,
  type LookupTableKind,
  type LookupTableScopeInput,
  messageTypes,
  type TradingPartner,
  upcomingMissingCodeSchema,
} from '@edi-bridge/contracts'

import { seedId } from './seed-id'
import { seedGln, seedTradingPartners } from './trading-partner'

const upcomingCodeSchema = upcomingMissingCodeSchema.pick({ code: true, itemCount: true })

export type UpcomingCode = z.infer<typeof upcomingCodeSchema>

const blockingCodeSchema = blockingMissingCodeSchema.pick({ code: true, failedRuns: true })

export type BlockingCode = z.infer<typeof blockingCodeSchema>

const lookupTableRecordSchema = lookupTableInputSchema.extend({
  id: z.uuid(),
  updatedAt: z.iso.datetime(),
  upcomingCodes: z.array(upcomingCodeSchema).optional(),
  blockingCodes: z.array(blockingCodeSchema).optional(),
})

export type LookupTableRecord = z.infer<typeof lookupTableRecordSchema>

type TradingPartnerIds = ReadonlyArray<Pick<TradingPartner, 'id'>>

function assertValid(record: LookupTableRecord, tradingPartners: TradingPartnerIds) {
  lookupTableRecordSchema.parse(record)
  const { scope } = record

  if (
    scope.kind === 'tradingPartner' &&
    !tradingPartners.some(({ id }) => id === scope.tradingPartnerId)
  ) {
    throw new Error(`No Trading Partner with id ${scope.tradingPartnerId}`)
  }
}

export const workspaceScope = { kind: 'workspace' } as const

export function partnerScope({ id }: Pick<TradingPartner, 'id'>): LookupTableScopeInput {
  return { kind: 'tradingPartner', tradingPartnerId: id }
}

function entries(...pairs: ReadonlyArray<readonly [string, string]>): LookupTableEntry[] {
  return pairs.map(([sourceCode, targetCode]) => ({ sourceCode, targetCode }))
}

const [hansemarkt, alpenfrisch] = seedTradingPartners

const hansemarktStore = (store: number) => `${seedGln(hansemarkt!.id).slice(0, 9)}${store}`

const seeds: ReadonlyArray<Omit<LookupTableRecord, 'id'>> = [
  {
    name: 'Units of measure',
    kind: 'units',
    scope: workspaceScope,
    updatedAt: '2026-09-14T08:30:00.000Z',
    entries: entries(['ST', 'PCE'], ['STK', 'PCE'], ['KG', 'KGM'], ['L', 'LTR']),
    upcomingCodes: [
      { code: 'BTL', itemCount: 14 },
      { code: 'SET', itemCount: 3 },
    ],
  },
  {
    name: 'Country codes',
    kind: 'countries',
    scope: workspaceScope,
    updatedAt: '2026-08-02T13:05:00.000Z',
    entries: entries(['Deutschland', 'DE'], ['Österreich', 'AT'], ['Schweiz', 'CH']),
    upcomingCodes: [{ code: 'Polen', itemCount: 2 }],
  },
  {
    name: 'VAT categories',
    kind: 'other',
    scope: workspaceScope,
    updatedAt: '2026-07-21T09:45:00.000Z',
    entries: entries(['19', 'S'], ['7', 'AA'], ['0', 'Z']),
  },
  {
    name: 'Hansemarkt units',
    kind: 'units',
    scope: partnerScope(hansemarkt!),
    updatedAt: '2026-09-30T15:12:00.000Z',
    entries: entries(['ST', 'PCE'], ['KAR', 'CT']),
  },
  {
    name: 'Alpenfrisch article groups',
    kind: 'other',
    scope: partnerScope(alpenfrisch!),
    updatedAt: '2026-10-02T11:20:00.000Z',
    entries: entries(['OG', 'FRUIT'], ['MO', 'DAIRY'], ['BR', 'BAKERY']),
  },
  {
    name: 'Hansemarkt store numbers',
    kind: 'addresses',
    scope: partnerScope(hansemarkt!),
    updatedAt: '2026-10-05T09:40:00.000Z',
    entries: entries(
      [hansemarktStore(1001), 'DA-1001'],
      [hansemarktStore(1002), 'DA-1002'],
      [hansemarktStore(1003), 'DA-1003'],
    ),
  },
]

export const seedLookupTables: ReadonlyArray<LookupTableRecord> = seeds.map((seed, index) => {
  const record = { id: seedId(8, index + 1), ...seed }
  assertValid(record, seedTradingPartners)

  return record
})

export function seedLookupTableNamed(name: string): LookupTableRecord {
  const found = seedLookupTables.find((table) => table.name === name)

  if (!found) {
    throw new Error(`No seed Lookup Table named ${name}`)
  }

  return found
}

const subjects: ReadonlyArray<readonly [string, LookupTableKind]> = [
  ['units', 'units'],
  ['country codes', 'countries'],
  ['store numbers', 'addresses'],
  ['article groups', 'other'],
  ['VAT categories', 'other'],
  ['packaging types', 'other'],
]

function generateEntries(faker: Faker, count: number): LookupTableEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    sourceCode: `${faker.string.alpha({ length: 2, casing: 'upper' })}${index + 1}`,
    targetCode: faker.string.alphanumeric({ length: { min: 2, max: 3 }, casing: 'upper' }),
  }))
}

type TradingPartnerNames = ReadonlyArray<Pick<TradingPartner, 'id' | 'name'>>

function generateUpcomingCodes(faker: Faker, count: number): UpcomingCode[] {
  return Array.from({ length: count }, (_, index) => ({
    code: `${faker.string.alpha({ length: 3, casing: 'upper' })}-${index + 1}`,
    itemCount: faker.number.int({ min: 1, max: 40 }),
  }))
}

function generateFailedRuns(
  faker: Faker,
  tradingPartners: TradingPartnerNames,
  now: Date,
): FailedRunReference[] {
  return Array.from({ length: faker.number.int({ min: 1, max: 3 }) }, () => {
    const { id, name } = faker.helpers.arrayElement(tradingPartners)

    return {
      id: faker.string.uuid(),
      receivedAt: faker.date.recent({ days: 14, refDate: now }).toISOString(),
      tradingPartner: { id, name },
      messageType: faker.helpers.arrayElement(messageTypes),
      businessReference: faker.helpers.maybe(() => `PO-${faker.string.numeric(6)}`) ?? null,
    }
  }).toSorted((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
}

function generateBlockingCodes(
  faker: Faker,
  count: number,
  tradingPartners: TradingPartnerNames,
  now: Date,
): BlockingCode[] {
  return Array.from({ length: count }, (_, index) => ({
    code: `${faker.string.alpha({ length: 2, casing: 'upper' })}-${index + 1}`,
    failedRuns: generateFailedRuns(faker, tradingPartners, now),
  }))
}

export function createLookupTables({
  count,
  entryCount,
  upcomingCodeCount = 0,
  blockingCodeCount = 0,
  now = new Date(),
  seed = 31,
  tradingPartners = seedTradingPartners,
}: {
  count: number
  entryCount?: number
  upcomingCodeCount?: number
  blockingCodeCount?: number
  now?: Date
  seed?: number
  tradingPartners?: TradingPartnerNames
}): LookupTableRecord[] {
  const faker = new Faker({ locale: [en], seed })

  return Array.from({ length: count }, (_, index) => {
    const tradingPartner = index % 3 === 0 ? null : faker.helpers.arrayElement(tradingPartners)
    const [subject, kind] = faker.helpers.arrayElement(subjects)

    const record: LookupTableRecord = {
      id: faker.string.uuid(),
      name: tradingPartner
        ? `${tradingPartner.name.split(/[\s,]/)[0]} ${subject} ${index + 1}`
        : `${subject[0]!.toUpperCase()}${subject.slice(1)} ${index + 1}`,
      kind,
      scope: tradingPartner ? partnerScope(tradingPartner) : workspaceScope,
      updatedAt: faker.date.past({ years: 1, refDate: now }).toISOString(),
      entries: generateEntries(faker, entryCount ?? faker.number.int({ min: 0, max: 12 })),
      upcomingCodes: generateUpcomingCodes(faker, upcomingCodeCount),
      blockingCodes: generateBlockingCodes(
        faker,
        blockingCodeCount,
        tradingPartner ? [tradingPartner] : tradingPartners,
        now,
      ),
    }

    assertValid(record, tradingPartners)

    return record
  })
}

export type LookupTableStore = {
  all: () => readonly LookupTableRecord[]
  get: (id: string) => LookupTableRecord | undefined
  translate: (id: string, value: string) => string | undefined
  set: (table: LookupTableRecord) => void
  delete: (id: string) => void
}

export function createLookupTableStore(
  lookupTables: ReadonlyArray<LookupTableRecord> = seedLookupTables,
): LookupTableStore {
  const byId = new Map(lookupTables.map((table) => [table.id, table]))

  return {
    all: () => [...byId.values()],
    get: (id) => byId.get(id),
    translate: (id, value) =>
      byId.get(id)?.entries.find(({ sourceCode }) => sourceCode === value)?.targetCode,
    set: (table) => {
      byId.set(table.id, table)
    },
    delete: (id) => {
      byId.delete(id)
    },
  }
}

export function toLookupTableStore(
  lookupTables: ReadonlyArray<LookupTableRecord> | LookupTableStore = seedLookupTables,
) {
  return 'get' in lookupTables ? lookupTables : createLookupTableStore(lookupTables)
}
