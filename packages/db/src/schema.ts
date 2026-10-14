import { type SQL, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  acknowledgementTimeLimitHours,
  characterSets,
  lookupTableKinds,
  maxLookupCodeLength,
} from '@edi-bridge/contracts'

export const workspaces = pgTable('workspaces', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  gln: text(),
  createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

export const characterSet = pgEnum('character_set', characterSets)

export const tradingPartnerGlnUnique = 'trading_partners_workspace_id_gln_unique'

export const tradingPartners = pgTable(
  'trading_partners',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    gln: text(),
    characterSet: characterSet().notNull(),
    acknowledgementTimeLimitHours: integer().notNull(),
    testMode: boolean().notNull().default(true),
    testInterchangeSentAt: timestamp({ withTimezone: true, mode: 'date' }),
    contrlReceivedAt: timestamp({ withTimezone: true, mode: 'date' }),
    createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.workspaceId),
    uniqueIndex(tradingPartnerGlnUnique).on(table.workspaceId, table.gln),
    check(
      'acknowledgement_time_limit_hours_range',
      sql`${table.acknowledgementTimeLimitHours} between ${sql.raw(String(acknowledgementTimeLimitHours.min))} and ${sql.raw(String(acknowledgementTimeLimitHours.max))}`,
    ),
  ],
)

export const lookupTableKind = pgEnum('lookup_table_kind', lookupTableKinds)

export const lookupTableWorkspaceNameUnique = 'lookup_tables_workspace_name_unique'

export const lookupTableTradingPartnerNameUnique = 'lookup_tables_trading_partner_name_unique'

export const lookupTables = pgTable(
  'lookup_tables',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tradingPartnerId: uuid().references(() => tradingPartners.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    kind: lookupTableKind().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.workspaceId),
    index().on(table.tradingPartnerId),
    uniqueIndex(lookupTableWorkspaceNameUnique)
      .on(table.workspaceId, sql`lower(${table.name})`)
      .where(sql`${table.tradingPartnerId} is null`),
    uniqueIndex(lookupTableTradingPartnerNameUnique).on(
      table.workspaceId,
      table.tradingPartnerId,
      sql`lower(${table.name})`,
    ),
  ],
)

const codeLength = (name: string, column: SQL) =>
  check(name, sql`char_length(${column}) between 1 and ${sql.raw(String(maxLookupCodeLength))}`)

export const lookupTableEntries = pgTable(
  'lookup_table_entries',
  {
    lookupTableId: uuid()
      .notNull()
      .references(() => lookupTables.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    sourceCode: text().notNull(),
    targetCode: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.lookupTableId, table.position] }),
    unique('lookup_table_entries_source_code_unique').on(table.lookupTableId, table.sourceCode),
    codeLength('source_code_length', sql`${table.sourceCode}`),
    codeLength('target_code_length', sql`${table.targetCode}`),
  ],
)
