import { type SQL, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
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
  type CsvSettings,
  documentFormats,
  type DocumentStructureNode,
  jsonRoots,
  lookupTableKinds,
  maxLookupCodeLength,
  workspaceRoles,
} from '@edi-bridge/contracts'

export const workspaces = pgTable('workspaces', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  gln: text(),
  createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

const createdAt = () => timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow()

const updatedAt = () =>
  timestamp({ withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  operator: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

const userId = () =>
  uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: userId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index().on(table.userId)],
)

export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: userId(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true, mode: 'date' }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true, mode: 'date' }),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index().on(table.userId)],
)

export const verifications = pgTable(
  'verifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index().on(table.identifier)],
)

export const workspaceRole = pgEnum('workspace_role', workspaceRoles)

export const memberships = pgTable(
  'memberships',
  {
    userId: userId(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    role: workspaceRole().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.workspaceId] }),
    index().on(table.workspaceId),
  ],
)

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

export const documentFormat = pgEnum('document_format', documentFormats)

export const jsonRoot = pgEnum('json_root', jsonRoots)

export const documentStructures = pgTable(
  'document_structures',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    format: documentFormat().notNull(),
    jsonRoot: jsonRoot(),
    csv: jsonb().$type<CsvSettings>(),
    sampleFileName: text(),
    sampleText: text(),
    sampleTakenAt: timestamp({ withTimezone: true, mode: 'date' }),
    children: jsonb().$type<DocumentStructureNode[]>().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.workspaceId),
    check(
      'document_structures_format_settings',
      sql`(${table.format} = 'json') = (${table.jsonRoot} is not null) and (${table.format} = 'csv') = (${table.csv} is not null)`,
    ),
    check(
      'document_structures_sample_complete',
      sql`num_nonnulls(${table.sampleFileName}, ${table.sampleText}, ${table.sampleTakenAt}) in (0, 3)`,
    ),
  ],
)
