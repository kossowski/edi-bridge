import { asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { GenericContainer, Wait } from 'testcontainers'

import { type SecretBox, secretBox, secretContext, secretKeyBytes } from '@edi-bridge/channels'
import {
  adjustDocumentStructure,
  type DocumentStructureOrigin,
  inferDocumentStructure,
  mappingVersionSchema,
  toEncodedFile,
} from '@edi-bridge/contracts'
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

import { RunNotQueued } from './errors'
import {
  Database,
  Delivery,
  type DeliveryService,
  Documents,
  type QueuedRun,
  RunQueue,
  type RunQueueService,
} from './services'

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

export function inMemoryRunQueue({ failures = 0 }: { failures?: number } = {}) {
  const queued: QueuedRun[] = []
  let failing = failures

  return {
    queued,
    service: {
      enqueue: (run: QueuedRun) =>
        Effect.suspend(() => {
          if (failing > 0) {
            failing -= 1

            return Effect.fail(new RunNotQueued({ runId: run.runId, cause: 'unreachable' }))
          }

          queued.push(run)

          return Effect.void
        }),
    } satisfies RunQueueService,
  }
}

const noDelivery: DeliveryService = () => Effect.die(new Error('This test delivers nothing'))

export const pipelineServices =
  (db: Db, queue: { service: RunQueueService }, delivery = noDelivery) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(Database, db),
      Effect.provideService(Documents, postgresDocumentStorage(db)),
      Effect.provideService(RunQueue, queue.service),
      Effect.provideService(Delivery, delivery),
    )

export const testSecrets = secretBox(randomBytes(secretKeyBytes))

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
    userId: user.id,
    tradingPartnerId: tradingPartner.id,
    inboundChannelId: inboundChannel.id,
    outboundChannelId: outboundChannel.id,
    mappingId: mapping.id,
    mappingVersionId: mappingVersion.id,
    flowId: flow.id,
  }
}

export type InvoiceWorkspace = Awaited<ReturnType<typeof seedInvoiceWorkspace>>

const orderFormats = {
  json: {
    mappingVersion: 'orders-reference-json.mapping.json',
    origin: (): DocumentStructureOrigin => ({
      kind: 'jsonDocument',
      document: toEncodedFile(
        'orders-reference.document.json',
        golden('orders-reference.document.json'),
      ),
    }),
    adjustments: [],
  },
  csv: {
    mappingVersion: 'orders-reference-csv.mapping.json',
    origin: (): DocumentStructureOrigin => ({
      kind: 'csvDocument',
      document: {
        fileName: 'orders-reference.document.csv',
        content: golden('orders-reference.document.csv', 'base64'),
      },
      csv: { delimiter: ';', headerRow: true, encoding: 'windows-1252' },
    }),
    // The ERP expects the price as 10,00, so the Admin makes it a text column.
    adjustments: [{ path: 'rows[].Preis', type: 'string' as const }],
  },
}

// An ORDERS Flow of the Workspace's Trading Partner on its inbound Channel, delivered to the ERP.
export async function addOrdersFlow(
  db: Db,
  workspace: InvoiceWorkspace,
  { url, format = 'json' }: { url: string; format?: keyof typeof orderFormats },
) {
  const { mappingVersion, origin, adjustments } = orderFormats[format]
  const version = mappingVersionSchema.parse(JSON.parse(golden(mappingVersion)))

  if (version.direction !== 'inbound') {
    throw new Error(`The reference Mapping Version ${mappingVersion} is not inbound`)
  }

  const structure = adjustDocumentStructure(
    { ...inferDocumentStructure(origin()), id: randomUUID(), name: version.target.name },
    { name: version.target.name, adjustments },
  )

  const documentStructure = one(
    await db
      .insert(documentStructures)
      .values({
        workspaceId: workspace.id,
        name: structure.name,
        ...(structure.format === 'json'
          ? { format: 'json' as const, jsonRoot: structure.root }
          : { format: 'csv' as const, csv: structure.csv }),
        children: structure.children,
      })
      .returning(),
  )

  const unitTable = one(
    await db
      .insert(lookupTables)
      .values({ workspaceId: workspace.id, name: 'Order units', kind: 'units' })
      .returning(),
  )

  await db
    .insert(lookupTableEntries)
    .values({ lookupTableId: unitTable.id, position: 0, sourceCode: 'PCE', targetCode: 'ST' })

  const graph = {
    links: version.links,
    transforms: version.transforms.map((transform) =>
      transform.kind === 'lookupTable'
        ? { ...transform, config: { ...transform.config, lookupTableId: unitTable.id } }
        : transform,
    ),
    transformLinks: version.transformLinks,
  }

  const mapping = one(
    await db
      .insert(mappings)
      .values({
        workspaceId: workspace.id,
        documentStructureId: documentStructure.id,
        messageType: 'ORDERS',
        name: version.mappingName,
        draft: graph,
        unpublishedChanges: false,
      })
      .returning(),
  )

  const pinned = one(
    await db
      .insert(mappingVersions)
      .values({ mappingId: mapping.id, version: 1, graph, publishedBy: workspace.userId })
      .returning(),
  )

  const erp = one(
    await db
      .insert(channels)
      .values({
        workspaceId: workspace.id,
        type: 'http',
        direction: 'outbound',
        name: 'ERP order import',
        url,
      })
      .returning(),
  )

  const flow = one(
    await db
      .insert(flows)
      .values({
        workspaceId: workspace.id,
        tradingPartnerId: workspace.tradingPartnerId,
        messageType: 'ORDERS',
        name: 'Orders from Hanse Retail',
        inboundChannelId: workspace.inboundChannelId,
        destinationChannelId: erp.id,
        mappingVersionId: pinned.id,
      })
      .returning(),
  )

  return {
    flowId: flow.id,
    mappingId: mapping.id,
    mappingVersionId: pinned.id,
    erpChannelId: erp.id,
  }
}

export async function deliverOverSftp(
  db: Db,
  workspace: InvoiceWorkspace,
  login: { host: string; port: number; username: string; password: string; remotePath: string },
  secrets: SecretBox = testSecrets,
) {
  const id = randomUUID()

  await db.insert(channels).values({
    id,
    workspaceId: workspace.id,
    tradingPartnerId: workspace.tradingPartnerId,
    type: 'sftp',
    direction: 'outbound',
    name: 'Hanse Retail SFTP inbox',
    host: login.host,
    port: login.port,
    username: login.username,
    remotePath: login.remotePath,
    authentication: 'password',
    encryptedCredential: secrets.seal(login.password, secretContext(id, 'encryptedCredential')),
  })

  await db.update(flows).set({ destinationChannelId: id }).where(eq(flows.id, workspace.flowId))

  return id
}

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

export async function receiveOverSftp(
  db: Db,
  workspace: InvoiceWorkspace,
  login: { host: string; port: number; username: string; password: string; remotePath: string },
  {
    flowId,
    pollingIntervalMinutes = 1,
    secrets = testSecrets,
  }: { flowId?: string; pollingIntervalMinutes?: number; secrets?: SecretBox } = {},
) {
  const id = randomUUID()

  await db.insert(channels).values({
    id,
    workspaceId: workspace.id,
    tradingPartnerId: workspace.tradingPartnerId,
    type: 'sftp',
    direction: 'inbound',
    name: `Hanse Retail SFTP outbox ${id.slice(0, 8)}`,
    host: login.host,
    port: login.port,
    username: login.username,
    remotePath: login.remotePath,
    authentication: 'password',
    encryptedCredential: secrets.seal(login.password, secretContext(id, 'encryptedCredential')),
    pollingIntervalMinutes,
  })

  if (flowId !== undefined) {
    await db.update(flows).set({ inboundChannelId: id }).where(eq(flows.id, flowId))
  }

  return id
}
