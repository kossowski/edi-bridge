import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type MappingGraph, runErrorSchema, runProblemSchema } from '@edi-bridge/contracts'

import { connect, type Connection } from './client.js'
import { migrate } from './migrate.js'
import { runs } from './schema.js'
import { emptyGraph, only } from './test-fixtures.js'
import { startTestDatabase, type TestDatabase } from './testing.js'

const storedProblemSchema = runProblemSchema.omit({ whoFixes: true })

const channelId = '00000000-0000-4000-8000-000000000001'

const failedRuns = [
  {
    name: 'an unreadable Document',
    failureStage: 'parse',
    error: { code: 'unparseable', message: 'The Document is not valid JSON', position: null },
    problem: { reason: 'unreadable', fixTarget: null },
    migratedReason: 'unreadable',
  },
  {
    name: 'invalid content',
    failureStage: 'validation',
    error: {
      code: 'invalidValue',
      message: 'DTM 2380 is not a date',
      position: { segment: 3, tag: 'DTM', element: 1, component: 2 },
    },
    problem: { reason: 'invalidContent', fixTarget: null },
    migratedReason: 'invalidContent',
  },
  {
    name: 'a missing code',
    failureStage: 'mapping',
    error: { code: 'noLookupMatch', message: 'No Lookup Table entry for ST', position: null },
    problem: { reason: 'missingCode', fixTarget: null },
    migratedReason: 'missingCode',
  },
  {
    name: 'a missing field',
    failureStage: 'validation',
    error: {
      code: 'missingField',
      message: 'BGM 1004 document number is missing',
      position: { segment: 2, tag: 'BGM', element: 2, component: null },
    },
    problem: { reason: 'missingField', fixTarget: null },
    migratedReason: 'missingField',
  },
  {
    name: 'an unreachable destination',
    failureStage: 'delivery',
    error: { code: 'deliveryFailed', message: 'The destination answered 503', position: null },
    problem: { reason: 'unreachable', fixTarget: null },
    migratedReason: 'unreachable',
  },
  {
    name: 'an incomplete setup',
    failureStage: 'delivery',
    error: { code: 'channelDefect', message: 'The SFTP key is missing', position: null },
    problem: {
      reason: 'incompleteSetup',
      fixTarget: { kind: 'channelCredential', channelId, name: 'Hanse Retail SFTP' },
    },
    migratedReason: 'incompleteSetup',
  },
  {
    name: 'a processing defect before delivery',
    failureStage: 'mapping',
    error: {
      code: 'processingDefect',
      message: 'The processing stopped on an unexpected error',
      position: null,
    },
    problem: { reason: 'invalidContent', fixTarget: null },
    migratedReason: 'defect',
  },
  {
    name: 'a processing defect at delivery',
    failureStage: 'delivery',
    error: {
      code: 'processingDefect',
      message: 'The processing stopped on an unexpected error',
      position: null,
    },
    problem: { reason: 'unreachable', fixTarget: null },
    migratedReason: 'defect',
  },
  {
    name: 'a delivery defect',
    failureStage: 'delivery',
    error: {
      code: 'deliveryDefect',
      message: 'The delivery stopped on an unexpected error',
      position: null,
    },
    problem: { reason: 'unreachable', fixTarget: null },
    migratedReason: 'defect',
  },
] as const

type StoredFailure = (typeof failedRuns)[number]['error' | 'problem']

const jsonb = (value: StoredFailure | MappingGraph) => sql`${JSON.stringify(value)}::jsonb`

let testDatabase: TestDatabase

let connection: Connection

const runIds = new Map<string, string>()

let deliveredRunId: string

type RunOwners = {
  workspaceId: string
  tradingPartnerId: string
  flowId: string
  documentId: string
}

// Plain SQL with only the columns of migration 0015, so later schema changes leave the old rows intact.
async function insertRunOwners(db: Connection['db']) {
  return only(
    db.execute<RunOwners>(sql`
      with workspace as (
        insert into workspaces (name) values ('Nordwind Foods') returning id
      ), partner as (
        insert into trading_partners (workspace_id, name, character_set, acknowledgement_time_limit_hours)
        select id, 'Hanse Retail', 'UNOC', 24 from workspace
        returning id
      ), publisher as (
        insert into users (name, email) values ('Ops', 'ops@nordwind.example') returning id
      ), structure as (
        insert into document_structures (workspace_id, name, format, json_root, children)
        select id, 'ERP invoices', 'json', 'object', '[]'::jsonb from workspace
        returning id
      ), mapping as (
        insert into mappings (workspace_id, document_structure_id, message_type, name, draft)
        select workspace.id, structure.id, 'INVOIC', 'ERP invoice to INVOIC', ${jsonb(emptyGraph)}
        from workspace, structure
        returning id
      ), mapping_version as (
        insert into mapping_versions (mapping_id, version, graph, published_by)
        select mapping.id, 1, ${jsonb(emptyGraph)}, publisher.id from mapping, publisher
        returning id
      ), inbound as (
        insert into channels (workspace_id, type, direction, name, rate_limit_per_minute, encrypted_webhook_token, webhook_token_last_four)
        select id, 'webhook', 'inbound', 'ERP webhook', 60, 'encrypted', 'abcd' from workspace
        returning id
      ), destination as (
        insert into channels (workspace_id, trading_partner_id, type, direction, name, url)
        select workspace.id, partner.id, 'http', 'outbound', 'Hanse Retail AS2 gateway', 'https://edi.hanse-retail.example/inbox'
        from workspace, partner
        returning id
      ), flow as (
        insert into flows (workspace_id, trading_partner_id, message_type, name, inbound_channel_id, destination_channel_id, mapping_version_id)
        select workspace.id, partner.id, 'INVOIC', 'Invoices to Hanse Retail', inbound.id, destination.id, mapping_version.id
        from workspace, partner, inbound, destination, mapping_version
        returning id
      ), document as (
        insert into documents (workspace_id, channel_id, file_name, content)
        select workspace.id, inbound.id, 'invoice.json', '{"invoiceNumber":"INV-1001"}'
        from workspace, inbound
        returning id
      )
      select workspace.id as "workspaceId", partner.id as "tradingPartnerId", flow.id as "flowId", document.id as "documentId"
      from workspace, partner, flow, document
    `),
  )
}

type OldRun =
  | { status: 'delivered' }
  | {
      status: 'failed'
      failureStage: string
      error: StoredFailure
      problem: StoredFailure
    }

async function insertOldRun(db: Connection['db'], owners: RunOwners, run: OldRun) {
  const failure =
    run.status === 'failed'
      ? sql`${run.failureStage}, ${jsonb(run.error)}, ${jsonb(run.problem)}`
      : sql`null, null, null`

  const stored = await only(
    db.execute<{ id: string }>(sql`
      insert into runs (workspace_id, document_id, flow_id, trading_partner_id, manual_submission, status, failure_stage, error, problem)
      values (${owners.workspaceId}, ${owners.documentId}, ${owners.flowId}, ${owners.tradingPartnerId}, true, ${run.status}, ${failure})
      returning id
    `),
  )

  return stored.id
}

beforeAll(async () => {
  testDatabase = await startTestDatabase({ upTo: '0015_run_message_index' })
  connection = connect(testDatabase.url)

  const owners = await insertRunOwners(connection.db)

  for (const failed of failedRuns) {
    runIds.set(
      failed.name,
      await insertOldRun(connection.db, owners, { status: 'failed', ...failed }),
    )
  }

  deliveredRunId = await insertOldRun(connection.db, owners, { status: 'delivered' })

  await migrate(testDatabase.url)
}, 60_000)

afterAll(async () => {
  await connection.close()
  await testDatabase.stop()
})

const storedRun = (id: string) => only(connection.db.select().from(runs).where(eq(runs.id, id)))

describe('migration 0016 on a failed Run stored before error details', () => {
  it.each(failedRuns)(
    'gives the error of $name no details and the problem reason $migratedReason',
    async (failed) => {
      const run = await storedRun(runIds.get(failed.name) ?? '')

      expect(runErrorSchema.parse(run.error)).toEqual({ ...failed.error, details: null })
      expect(storedProblemSchema.parse(run.problem)).toEqual({
        ...failed.problem,
        reason: failed.migratedReason,
      })
    },
  )

  it('leaves a Run that did not fail without error and problem', async () => {
    const run = await storedRun(deliveredRunId)

    expect(run).toMatchObject({ status: 'delivered', error: null, problem: null })
  })
})
