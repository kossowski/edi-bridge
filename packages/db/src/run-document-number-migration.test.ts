import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { connect, type Connection } from './client.js'
import { migrate } from './migrate.js'
import { runs } from './schema.js'
import { emptyGraph, only } from './test-fixtures.js'
import { startTestDatabase, type TestDatabase } from './testing.js'

let testDatabase: TestDatabase

let connection: Connection

type RunOwners = {
  workspaceId: string
  tradingPartnerId: string
  ordersFlowId: string
  invoicFlowId: string
  documentId: string
}

const graph = sql`${JSON.stringify(emptyGraph)}::jsonb`

// Plain SQL with only the columns of migration 0024, so later schema changes leave the old rows intact.
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
        select id, 'ERP documents', 'json', 'object', '[]'::jsonb from workspace
        returning id
      ), mapping as (
        insert into mappings (workspace_id, document_structure_id, message_type, name, draft)
        select workspace.id, structure.id, 'INVOIC', 'ERP invoice to INVOIC', ${graph}
        from workspace, structure
        returning id
      ), mapping_version as (
        insert into mapping_versions (mapping_id, version, graph, published_by)
        select mapping.id, 1, ${graph}, publisher.id from mapping, publisher
        returning id
      ), inbound as (
        insert into channels (workspace_id, type, direction, name, rate_limit_per_minute, encrypted_webhook_token, webhook_token_last_four)
        select id, 'webhook', 'inbound', 'Webhook', 60, 'encrypted', 'abcd' from workspace
        returning id
      ), destination as (
        insert into channels (workspace_id, trading_partner_id, type, direction, name, url)
        select workspace.id, partner.id, 'http', 'outbound', 'Gateway', 'https://edi.hanse-retail.example/inbox'
        from workspace, partner
        returning id
      ), orders_flow as (
        insert into flows (workspace_id, trading_partner_id, message_type, name, inbound_channel_id, destination_channel_id, mapping_version_id)
        select workspace.id, partner.id, 'ORDERS', 'Orders from Hanse Retail', inbound.id, destination.id, mapping_version.id
        from workspace, partner, inbound, destination, mapping_version
        returning id
      ), invoic_flow as (
        insert into flows (workspace_id, trading_partner_id, message_type, name, inbound_channel_id, destination_channel_id, mapping_version_id)
        select workspace.id, partner.id, 'INVOIC', 'Invoices to Hanse Retail', inbound.id, destination.id, mapping_version.id
        from workspace, partner, inbound, destination, mapping_version
        returning id
      ), document as (
        insert into documents (workspace_id, channel_id, file_name, content)
        select workspace.id, inbound.id, 'interchange.edi', 'UNB'
        from workspace, inbound
        returning id
      )
      select workspace.id as "workspaceId", partner.id as "tradingPartnerId",
        orders_flow.id as "ordersFlowId", invoic_flow.id as "invoicFlowId", document.id as "documentId"
      from workspace, partner, orders_flow, invoic_flow, document
    `),
  )
}

async function insertOldRun(
  db: Connection['db'],
  owners: RunOwners,
  flowId: string,
  businessReference: string | null,
) {
  const stored = await only(
    db.execute<{ id: string }>(sql`
      insert into runs (workspace_id, document_id, flow_id, trading_partner_id, manual_submission, status, business_reference)
      values (${owners.workspaceId}, ${owners.documentId}, ${flowId}, ${owners.tradingPartnerId}, false, 'delivered', ${businessReference})
      returning id
    `),
  )

  return stored.id
}

let inboundRunId: string

let inboundWithoutReferenceRunId: string

let outboundRunId: string

beforeAll(async () => {
  testDatabase = await startTestDatabase({ upTo: '0024_sftp_file_duplicates' })
  connection = connect(testDatabase.url)

  const owners = await insertRunOwners(connection.db)

  inboundRunId = await insertOldRun(connection.db, owners, owners.ordersFlowId, '128576')
  inboundWithoutReferenceRunId = await insertOldRun(
    connection.db,
    owners,
    owners.ordersFlowId,
    null,
  )
  outboundRunId = await insertOldRun(connection.db, owners, owners.invoicFlowId, '4711')

  await migrate(testDatabase.url)
}, 60_000)

afterAll(async () => {
  await connection.close()
  await testDatabase.stop()
})

const storedRun = (id: string) => only(connection.db.select().from(runs).where(eq(runs.id, id)))

describe('migration 0025 on a Run stored before the document number', () => {
  it('gives an inbound Run its Business Reference, the BGM number, as the document number', async () => {
    await expect(storedRun(inboundRunId)).resolves.toMatchObject({
      businessReference: '128576',
      documentNumber: '128576',
    })
  })

  it('leaves an inbound Run without a Business Reference without a document number', async () => {
    await expect(storedRun(inboundWithoutReferenceRunId)).resolves.toMatchObject({
      documentNumber: null,
    })
  })

  it('leaves an outbound Run without a document number, since it never waits for the Trading Partner', async () => {
    await expect(storedRun(outboundRunId)).resolves.toMatchObject({
      businessReference: '4711',
      documentNumber: null,
    })
  })
})
