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
  channelTypes,
  characterSets,
  type CsvSettings,
  directions,
  documentFormats,
  type DocumentStructureNode,
  jsonRoots,
  lookupTableKinds,
  type MappingGraph,
  maxLookupCodeLength,
  messageTypes,
  sftpAuthentications,
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

export const userEmailUnique = 'users_email_unique'

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  email: text().notNull().unique(userEmailUnique),
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

export const members = pgTable(
  'members',
  {
    userId: userId(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    role: workspaceRole().notNull(),
    lastActivityAt: timestamp({ withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.workspaceId] }),
    index().on(table.workspaceId),
  ],
)

export const invites = pgTable(
  'invites',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    role: workspaceRole().notNull(),
    token: text().notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
    acceptedAt: timestamp({ withTimezone: true, mode: 'date' }),
    revokedAt: timestamp({ withTimezone: true, mode: 'date' }),
  },
  (table) => [index().on(table.workspaceId)],
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

export const messageType = pgEnum('message_type', messageTypes)

export const mappingNameUnique = 'mappings_workspace_id_name_unique'

export const mappings = pgTable(
  'mappings',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    documentStructureId: uuid()
      .notNull()
      .references(() => documentStructures.id),
    messageType: messageType().notNull(),
    name: text().notNull(),
    draft: jsonb().$type<MappingGraph>().notNull(),
    unpublishedChanges: boolean().notNull().default(true),
    draftUpdatedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    index().on(table.workspaceId),
    index().on(table.documentStructureId),
    unique(mappingNameUnique).on(table.workspaceId, table.name),
  ],
)

export const mappingVersions = pgTable(
  'mapping_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    mappingId: uuid()
      .notNull()
      .references(() => mappings.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    graph: jsonb().$type<MappingGraph>().notNull(),
    changeNote: text(),
    publishedBy: uuid()
      .notNull()
      .references(() => users.id),
    publishedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('mapping_versions_mapping_id_version_unique').on(table.mappingId, table.version),
    check('mapping_versions_version_positive', sql`${table.version} >= 1`),
  ],
)

export const channelType = pgEnum('channel_type', channelTypes)

export const direction = pgEnum('direction', directions)

export const sftpAuthentication = pgEnum('sftp_authentication', sftpAuthentications)

const allSetOnlyWhen = (kind: SQL, columns: SQL[]) =>
  sql`num_nonnulls(${sql.join(columns, sql`, `)}) = case when ${kind} then ${sql.raw(String(columns.length))} else 0 end`

export const channels = pgTable(
  'channels',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tradingPartnerId: uuid().references(() => tradingPartners.id, { onDelete: 'cascade' }),
    type: channelType().notNull(),
    direction: direction().notNull(),
    name: text().notNull(),
    host: text(),
    port: integer(),
    username: text(),
    remotePath: text(),
    authentication: sftpAuthentication(),
    encryptedCredential: text(),
    pollingIntervalMinutes: integer(),
    rateLimitPerMinute: integer(),
    encryptedWebhookToken: text(),
    webhookTokenLastFour: text(),
    url: text(),
    encryptedAuthorization: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index().on(table.workspaceId),
    index().on(table.tradingPartnerId),
    check(
      'channels_kind',
      sql`(${table.type}, ${table.direction}) in (('sftp', 'inbound'), ('sftp', 'outbound'), ('webhook', 'inbound'), ('http', 'outbound'))`,
    ),
    check(
      'channels_sftp_settings',
      allSetOnlyWhen(sql`${table.type} = 'sftp'`, [
        sql`${table.host}`,
        sql`${table.port}`,
        sql`${table.username}`,
        sql`${table.remotePath}`,
        sql`${table.authentication}`,
        sql`${table.encryptedCredential}`,
      ]),
    ),
    check(
      'channels_polling_interval',
      allSetOnlyWhen(sql`${table.type} = 'sftp' and ${table.direction} = 'inbound'`, [
        sql`${table.pollingIntervalMinutes}`,
      ]),
    ),
    check(
      'channels_webhook_settings',
      allSetOnlyWhen(sql`${table.type} = 'webhook'`, [
        sql`${table.rateLimitPerMinute}`,
        sql`${table.encryptedWebhookToken}`,
        sql`${table.webhookTokenLastFour}`,
      ]),
    ),
    check(
      'channels_http_settings',
      allSetOnlyWhen(sql`${table.type} = 'http'`, [sql`${table.url}`]),
    ),
    check(
      'channels_authorization',
      sql`${table.type} = 'http' or ${table.encryptedAuthorization} is null`,
    ),
  ],
)
