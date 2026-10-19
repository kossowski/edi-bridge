import { type MappingGraph, withCheckDigit } from '@edi-bridge/contracts'

import {
  channels,
  documents,
  documentStructures,
  flows,
  mappings,
  mappingVersions,
  tradingPartners,
  users,
  workspaces,
} from './schema.js'

import type { Connection } from './client.js'
import type { runs } from './schema.js'

export const tradingPartner = {
  name: 'Hanse Retail',
  gln: withCheckDigit('020000000002'),
  characterSet: 'UNOC',
  acknowledgementTimeLimitHours: 24,
} satisfies Omit<typeof tradingPartners.$inferInsert, 'workspaceId'>

export async function insertWorkspace(db: Connection['db']) {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'Nordwind Foods', gln: withCheckDigit('020000000001') })
    .returning()

  if (workspace === undefined) {
    throw new Error('Workspace insert returned no row')
  }

  return workspace
}

export const emptyGraph: MappingGraph = { links: [], transforms: [], transformLinks: [] }

export async function only<T>(rows: Promise<T[]>) {
  const [row] = await rows

  if (row === undefined) {
    throw new Error('Insert returned no row')
  }

  return row
}

export async function insertFlow(db: Connection['db']) {
  const workspace = await insertWorkspace(db)
  const workspaceId = workspace.id

  const partner = await only(
    db
      .insert(tradingPartners)
      .values({ ...tradingPartner, gln: null, workspaceId })
      .returning(),
  )

  const user = await only(
    db
      .insert(users)
      .values({ name: 'Ops', email: `${crypto.randomUUID()}@nordwind.example` })
      .returning(),
  )

  const structure = await only(
    db
      .insert(documentStructures)
      .values({
        workspaceId,
        name: 'ERP invoices',
        format: 'json',
        jsonRoot: 'object',
        children: [],
      })
      .returning(),
  )

  const mapping = await only(
    db
      .insert(mappings)
      .values({
        workspaceId,
        documentStructureId: structure.id,
        messageType: 'INVOIC',
        name: 'ERP invoice to INVOIC',
        draft: emptyGraph,
      })
      .returning(),
  )

  const mappingVersion = await only(
    db
      .insert(mappingVersions)
      .values({ mappingId: mapping.id, version: 1, graph: emptyGraph, publishedBy: user.id })
      .returning(),
  )

  const inbound = await only(
    db
      .insert(channels)
      .values({
        workspaceId,
        type: 'webhook',
        direction: 'inbound',
        name: 'ERP webhook',
        rateLimitPerMinute: 60,
        encryptedWebhookToken: 'encrypted',
        webhookTokenLastFour: 'abcd',
      })
      .returning(),
  )

  const destination = await only(
    db
      .insert(channels)
      .values({
        workspaceId,
        tradingPartnerId: partner.id,
        type: 'http',
        direction: 'outbound',
        name: 'Hanse Retail AS2 gateway',
        url: 'https://edi.hanse-retail.example/inbox',
      })
      .returning(),
  )

  const flow = await only(
    db
      .insert(flows)
      .values({
        workspaceId,
        tradingPartnerId: partner.id,
        messageType: 'INVOIC',
        name: 'Invoices to Hanse Retail',
        inboundChannelId: inbound.id,
        destinationChannelId: destination.id,
        mappingVersionId: mappingVersion.id,
      })
      .returning(),
  )

  const document = await only(
    db
      .insert(documents)
      .values({
        workspaceId,
        channelId: inbound.id,
        fileName: 'invoice.json',
        content: '{"invoiceNumber":"INV-1001"}',
      })
      .returning(),
  )

  return { workspaceId, flow, mappingVersion, document }
}

export async function newRun(db: Connection['db']) {
  const { workspaceId, flow, mappingVersion, document } = await insertFlow(db)

  return {
    run: {
      workspaceId,
      documentId: document.id,
      flowId: flow.id,
      tradingPartnerId: flow.tradingPartnerId,
      manualSubmission: true,
    } satisfies typeof runs.$inferInsert,
    mappingVersion,
  }
}
