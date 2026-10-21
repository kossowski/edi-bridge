import { type SQL, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
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
  acknowledgementNotSentReasons,
  acknowledgementStates,
  acknowledgementTimeLimitHours,
  aiDailyTokenLimit,
  type AiReview,
  channelTestFailureReasons,
  channelTypes,
  characterSets,
  type CsvSettings,
  directions,
  documentFormats,
  documentRetentionDays,
  failureStages,
  type DocumentStructureNode,
  jsonRoots,
  lookupTableKinds,
  type MappingGraph,
  maxLookupCodeLength,
  messageTypes,
  type RunError,
  type RunProblem,
  runStatuses,
  runStepStages,
  runStepStatuses,
  sftpAuthentications,
  workspaceKinds,
  workspaceRoles,
} from '@edi-bridge/contracts'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

export const workspaceKind = pgEnum('workspace_kind', workspaceKinds)

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    gln: text(),
    kind: workspaceKind().notNull().default('standard'),
    seeded: boolean().notNull().default(false),
    lastResetAt: timestamp({ withTimezone: true, mode: 'date' }),
    aiDailyTokenLimit: integer().notNull().default(aiDailyTokenLimit.default),
    documentRetentionDays: integer().notNull().default(documentRetentionDays.default),
    createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'ai_daily_token_limit_range',
      sql`${table.aiDailyTokenLimit} between ${sql.raw(String(aiDailyTokenLimit.min))} and ${sql.raw(String(aiDailyTokenLimit.max))}`,
    ),
    check(
      'document_retention_days_range',
      sql`${table.documentRetentionDays} between ${sql.raw(String(documentRetentionDays.min))} and ${sql.raw(String(documentRetentionDays.max))}`,
    ),
  ],
)

// Days are in UTC, since the AI budget resets at midnight UTC.
export const aiTokenUsage = pgTable(
  'ai_token_usage',
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    tokens: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.day] }),
    check('tokens_not_negative', sql`${table.tokens} >= 0`),
  ],
)

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

export const messageType = pgEnum('message_type', messageTypes)

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
    messageTypes: messageType().array(),
    testMode: boolean().notNull().default(true),
    testInterchangeSentAt: timestamp({ withTimezone: true, mode: 'date' }),
    contrlReceivedAt: timestamp({ withTimezone: true, mode: 'date' }),
    testRejectedAt: timestamp({ withTimezone: true, mode: 'date' }),
    testRejectedRunId: uuid().references((): AnyPgColumn => runs.id, { onDelete: 'set null' }),
    nextControlReference: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.workspaceId),
    uniqueIndex(tradingPartnerGlnUnique).on(table.workspaceId, table.gln),
    check(
      'acknowledgement_time_limit_hours_range',
      sql`${table.acknowledgementTimeLimitHours} between ${sql.raw(String(acknowledgementTimeLimitHours.min))} and ${sql.raw(String(acknowledgementTimeLimitHours.max))}`,
    ),
    check('trading_partners_next_control_reference', sql`${table.nextControlReference} >= 1`),
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
    aiReview: jsonb().$type<AiReview>(),
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

export const pollProblemReason = pgEnum('poll_problem_reason', channelTestFailureReasons)

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
    hostKeyFingerprint: text(),
    pollingIntervalMinutes: integer(),
    pollProblemReason: pollProblemReason(),
    pollProblemSince: timestamp({ withTimezone: true, mode: 'date' }),
    pollProblemBlockedAddress: text(),
    rateLimitPerMinute: integer(),
    encryptedWebhookToken: text(),
    webhookTokenLastFour: text(),
    url: text(),
    encryptedAuthorization: text(),
    seeded: boolean().notNull().default(false),
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
      'channels_host_key_fingerprint',
      sql`${table.type} = 'sftp' or ${table.hostKeyFingerprint} is null`,
    ),
    check(
      'channels_poll_problem',
      sql`num_nonnulls(${table.pollProblemReason}, ${table.pollProblemSince}) = 0 or (${table.type} = 'sftp' and ${table.direction} = 'inbound' and num_nonnulls(${table.pollProblemReason}, ${table.pollProblemSince}) = 2)`,
    ),
    check(
      'channels_poll_problem_blocked_address',
      // The text cast keeps the check off the enum value its migration adds in the same transaction.
      sql`(${table.pollProblemReason}::text is not distinct from 'addressBlocked') = (${table.pollProblemBlockedAddress} is not null)`,
    ),
    check(
      'channels_authorization',
      sql`${table.type} = 'http' or ${table.encryptedAuthorization} is null`,
    ),
  ],
)

export const flows = pgTable(
  'flows',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tradingPartnerId: uuid()
      .notNull()
      .references(() => tradingPartners.id, { onDelete: 'cascade' }),
    messageType: messageType().notNull(),
    name: text().notNull(),
    inboundChannelId: uuid()
      .notNull()
      .references(() => channels.id),
    destinationChannelId: uuid()
      .notNull()
      .references(() => channels.id),
    mappingVersionId: uuid()
      .notNull()
      .references(() => mappingVersions.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index().on(table.workspaceId),
    index().on(table.tradingPartnerId),
    index().on(table.inboundChannelId),
    index().on(table.destinationChannelId),
    index().on(table.mappingVersionId),
  ],
)

export const documents = pgTable(
  'documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: uuid()
      .notNull()
      .references(() => channels.id),
    fileName: text().notNull(),
    content: text(),
    // Text would hold U+FFFD for bytes not valid in their encoding, so those are kept as bytes.
    bytes: bytea(),
    // The UNB keys that make a later copy of the Interchange a Duplicate; null for no Interchange.
    interchangeSender: text(),
    interchangeControlReference: text(),
    // UNB 0035 = 1: the sender marked the Interchange as a test.
    testIndicator: boolean().notNull().default(false),
    // With the Channel and file name, the key that makes a later copy of an SFTP file a Duplicate.
    contentHash: text(),
    receivedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index().on(table.workspaceId),
    index().on(table.channelId),
    index('documents_interchange_index').on(
      table.workspaceId,
      table.interchangeSender,
      table.interchangeControlReference,
    ),
    index('documents_sftp_file_index').on(table.channelId, table.fileName, table.contentHash),
    check(
      'documents_interchange',
      sql`num_nonnulls(${table.interchangeSender}, ${table.interchangeControlReference}) in (0, 2)`,
    ),
    check('documents_content', sql`num_nonnulls(${table.content}, ${table.bytes}) = 1`),
  ],
)

export const runStatus = pgEnum('run_status', runStatuses)

export const failureStage = pgEnum('failure_stage', failureStages)

export const acknowledgementState = pgEnum('acknowledgement_state', acknowledgementStates)

export const runs = pgTable(
  'runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Retention deletes the Document but keeps the Run.
    documentId: uuid().references(() => documents.id, { onDelete: 'set null' }),
    documentDeletedAt: timestamp({ withTimezone: true, mode: 'date' }),
    flowId: uuid()
      .notNull()
      .references(() => flows.id),
    tradingPartnerId: uuid()
      .notNull()
      .references(() => tradingPartners.id),
    mappingVersionId: uuid().references(() => mappingVersions.id),
    manualSubmission: boolean().notNull(),
    status: runStatus().notNull().default('received'),
    failureStage: failureStage(),
    businessReference: text(),
    // The BGM number, so a resend replaces the Run of its own Message, not another of its order.
    documentNumber: text(),
    error: jsonb().$type<RunError>(),
    problem: jsonb().$type<Omit<RunProblem, 'whoFixes'>>(),
    waitingForTradingPartnerSince: timestamp({ withTimezone: true, mode: 'date' }),
    output: text(),
    // The mapped Message of an outbound Run, so a Retry builds its Interchange without mapping again.
    deliveryInput: jsonb(),
    // Set once the Channel took the output, so a Retry never delivers it twice.
    handedOverAt: timestamp({ withTimezone: true, mode: 'date' }),
    controlReference: integer(),
    // Null for an Interchange handed over before Acknowledgements were tracked.
    acknowledgementState: acknowledgementState(),
    // Null for a Document that is not an Interchange.
    messageIndex: integer(),
    // A Reprocess starts a new Run from the same Document.
    replacesRunId: uuid()
      .unique()
      .references((): AnyPgColumn => runs.id),
    duplicateOfRunId: uuid().references((): AnyPgColumn => runs.id),
    receivedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index().on(table.workspaceId, table.receivedAt.desc()),
    index().on(table.documentId),
    index().on(table.flowId),
    index().on(table.tradingPartnerId),
    index().on(table.mappingVersionId),
    index().on(table.tradingPartnerId, table.controlReference),
    index().on(table.duplicateOfRunId),
    // The Overdue check reads only the Interchanges that still await an Acknowledgement.
    index('runs_pending_acknowledgement_index')
      .on(table.handedOverAt)
      .where(sql`${table.acknowledgementState} = 'pending'`),
    check(
      'runs_failure',
      allSetOnlyWhen(sql`${table.status} = 'failed'`, [
        sql`${table.failureStage}`,
        sql`${table.error}`,
        sql`${table.problem}`,
      ]),
    ),
    check(
      'runs_waiting_for_trading_partner',
      sql`${table.status} = 'failed' or ${table.waitingForTradingPartnerSince} is null`,
    ),
    // A Run that failed before delivery never has output: no earlier stage produces deliverable EDIFACT.
    check(
      'runs_output',
      sql`${table.failureStage} is null or ${table.failureStage} = 'delivery' or ${table.output} is null`,
    ),
    check('runs_control_reference', sql`${table.controlReference} >= 1`),
    check(
      'runs_acknowledgement_state',
      sql`${table.acknowledgementState} is null or (${table.handedOverAt} is not null and ${table.controlReference} is not null)`,
    ),
    check('runs_message_index', sql`${table.messageIndex} >= 1`),
    check(
      'runs_document_deleted',
      sql`(${table.documentId} is null) = (${table.documentDeletedAt} is not null)`,
    ),
    check(
      'runs_duplicate',
      sql`(${table.status} = 'duplicate') = (${table.duplicateOfRunId} is not null)`,
    ),
  ],
)

export const acknowledgementNotSentReason = pgEnum(
  'acknowledgement_not_sent_reason',
  acknowledgementNotSentReasons,
)

export const acknowledgements = pgTable(
  'acknowledgements',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Retention deletes the answered Document but keeps its Acknowledgement.
    documentId: uuid()
      .unique()
      .references(() => documents.id, { onDelete: 'set null' }),
    tradingPartnerId: uuid()
      .notNull()
      .references(() => tradingPartners.id),
    channelId: uuid().references(() => channels.id),
    controlReference: integer(),
    content: text(),
    notSentReason: acknowledgementNotSentReason(),
    // Set at each attempt, so an attempt cut off by a worker restart is tried again after a bound.
    deliveryAttemptedAt: timestamp({ withTimezone: true, mode: 'date' }),
    deliveryError: text(),
    handedOverAt: timestamp({ withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [
    index().on(table.workspaceId),
    index().on(table.tradingPartnerId),
    index().on(table.channelId),
    index('acknowledgements_unsent_index')
      .on(table.deliveryAttemptedAt)
      .where(sql`${table.handedOverAt} is null and ${table.notSentReason} is null`),
    check(
      'acknowledgements_content',
      sql`num_nonnulls(${table.content}, ${table.controlReference}) in (0, 2)`,
    ),
    check(
      'acknowledgements_not_sent_reason',
      sql`(${table.notSentReason} is null) = (${table.channelId} is not null and ${table.content} is not null)`,
    ),
    check(
      'acknowledgements_handed_over',
      sql`${table.handedOverAt} is null or ${table.notSentReason} is null`,
    ),
    check('acknowledgements_control_reference', sql`${table.controlReference} >= 1`),
  ],
)

export const runStepStage = pgEnum('run_step_stage', runStepStages)

export const runStepStatus = pgEnum('run_step_status', runStepStatuses)

export const runSteps = pgTable(
  'run_steps',
  {
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    stage: runStepStage().notNull(),
    status: runStepStatus().notNull().default('pending'),
    startedAt: timestamp({ withTimezone: true, mode: 'date' }),
    finishedAt: timestamp({ withTimezone: true, mode: 'date' }),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.position] }),
    unique('run_steps_run_id_stage_unique').on(table.runId, table.stage),
    check('run_steps_position', sql`${table.position} >= 0`),
    check(
      'run_steps_timings',
      sql`case
        when ${table.status} in ('pending', 'skipped') then num_nonnulls(${table.startedAt}, ${table.finishedAt}) = 0
        when ${table.status} = 'running' then ${table.startedAt} is not null and ${table.finishedAt} is null
        else coalesce(${table.startedAt} <= ${table.finishedAt}, false)
      end`,
    ),
  ],
)
