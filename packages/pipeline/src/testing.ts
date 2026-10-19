import { asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { GenericContainer, Wait } from 'testcontainers'

import { inferDocumentStructure, mappingVersionSchema, toEncodedFile } from '@edi-bridge/contracts'
import {
  channels,
  type Connection,
  documents,
  documentStructures,
  flows,
  lookupTableEntries,
  lookupTables,
  mappings,
  mappingVersions,
  postgresDocumentStorage,
  runs,
  runSteps,
  tradingPartners,
  users,
  workspaces,
} from '@edi-bridge/db'

import { Database, Documents, type QueuedRun, RunQueue, type RunQueueService } from './services'

type Db = Connection['db']

const require = createRequire(import.meta.url)

export const golden = (name: string, encoding: BufferEncoding = 'utf8') =>
  readFileSync(require.resolve(`@edi-bridge/mapping/golden/${name}`), encoding)

export const goldenInvoice = golden('invoic-reference.document.json')

// The reference INVOIC between UNH and UNT, as the pipeline stores it: one segment per line.
export const goldenInvoicMessage = golden('invoic-reference.edi', 'latin1')
  .split('\n')
  .filter((line) => line !== '' && !/^UN[BZ]/.test(line))
  .join('\n')

const goldenVersion = (() => {
  const version = mappingVersionSchema.parse(JSON.parse(golden('invoic-reference.mapping.json')))

  if (version.direction !== 'outbound') {
    throw new Error('The reference Mapping Version is not outbound')
  }

  return version
})()

export async function startTestRedis() {
  const container = await new GenericContainer('redis:8.10.2-alpine3.23')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start()

  return {
    url: `redis://${container.getHost()}:${String(container.getMappedPort(6379))}`,
    stop: async () => {
      await container.stop()
    },
  }
}

export type TestRedis = Awaited<ReturnType<typeof startTestRedis>>

export function inMemoryRunQueue() {
  const queued: QueuedRun[] = []

  return {
    queued,
    service: {
      enqueue: (run: QueuedRun) => Effect.sync(() => void queued.push(run)),
    } satisfies RunQueueService,
  }
}

export const pipelineServices =
  (db: Db, queue: { service: RunQueueService }) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(Database, db),
      Effect.provideService(Documents, postgresDocumentStorage(db)),
      Effect.provideService(RunQueue, queue.service),
    )

const one = <A>(rows: A[]): A => {
  const [row] = rows

  if (row === undefined) {
    throw new Error('Insert returned no row')
  }

  return row
}

export async function seedInvoiceWorkspace(db: Db, name: string) {
  const user = one(
    await db
      .insert(users)
      .values({ name: 'Integration engineer', email: `${crypto.randomUUID()}@example.com` })
      .returning(),
  )

  const workspace = one(
    await db.insert(workspaces).values({ name, gln: '4389876511113' }).returning(),
  )

  const workspaceId = workspace.id

  const tradingPartner = one(
    await db
      .insert(tradingPartners)
      .values({
        workspaceId,
        name: 'Hanse Retail',
        gln: '4071615111110',
        characterSet: 'UNOC',
        acknowledgementTimeLimitHours: 24,
      })
      .returning(),
  )

  const inboundChannel = one(
    await db
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

  const outboundChannel = one(
    await db
      .insert(channels)
      .values({
        workspaceId,
        tradingPartnerId: tradingPartner.id,
        type: 'http',
        direction: 'outbound',
        name: 'Hanse Retail inbox',
        url: 'https://edi.example.com/inbox',
      })
      .returning(),
  )

  const structure = inferDocumentStructure({
    kind: 'jsonDocument',
    document: toEncodedFile('invoic-reference.document.json', goldenInvoice),
  })

  if (structure.format !== 'json') {
    throw new Error('The reference Document is not JSON')
  }

  const documentStructure = one(
    await db
      .insert(documentStructures)
      .values({
        workspaceId,
        name: 'ERP invoice',
        format: 'json',
        jsonRoot: structure.root,
        children: structure.children,
      })
      .returning(),
  )

  const unitTable = one(
    await db.insert(lookupTables).values({ workspaceId, name: 'Units', kind: 'units' }).returning(),
  )

  await db
    .insert(lookupTableEntries)
    .values({ lookupTableId: unitTable.id, position: 0, sourceCode: 'ST', targetCode: 'PCE' })

  // Each Workspace gets its own Lookup Table, so its transform points at that table.
  const graph = {
    links: goldenVersion.links,
    transforms: goldenVersion.transforms.map((transform) =>
      transform.kind === 'lookupTable'
        ? { ...transform, config: { ...transform.config, lookupTableId: unitTable.id } }
        : transform,
    ),
    transformLinks: goldenVersion.transformLinks,
  }

  const mapping = one(
    await db
      .insert(mappings)
      .values({
        workspaceId,
        documentStructureId: documentStructure.id,
        messageType: 'INVOIC',
        name: goldenVersion.mappingName,
        draft: graph,
        unpublishedChanges: false,
      })
      .returning(),
  )

  const mappingVersion = one(
    await db
      .insert(mappingVersions)
      .values({ mappingId: mapping.id, version: 1, graph, publishedBy: user.id })
      .returning(),
  )

  const flow = one(
    await db
      .insert(flows)
      .values({
        workspaceId,
        tradingPartnerId: tradingPartner.id,
        messageType: 'INVOIC',
        name: 'Invoices to Hanse Retail',
        inboundChannelId: inboundChannel.id,
        destinationChannelId: outboundChannel.id,
        mappingVersionId: mappingVersion.id,
      })
      .returning(),
  )

  return {
    id: workspaceId,
    tradingPartnerId: tradingPartner.id,
    inboundChannelId: inboundChannel.id,
    outboundChannelId: outboundChannel.id,
    mappingId: mapping.id,
    mappingVersionId: mappingVersion.id,
    flowId: flow.id,
  }
}

export type InvoiceWorkspace = Awaited<ReturnType<typeof seedInvoiceWorkspace>>

export async function readRun(db: Db, id: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, id))

  if (run === undefined) {
    return undefined
  }

  const [document] = await db.select().from(documents).where(eq(documents.id, run.documentId))

  const steps = await db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, id))
    .orderBy(asc(runSteps.position))

  return { ...run, document, steps }
}
