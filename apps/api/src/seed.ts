import { eq } from 'drizzle-orm'
import { DateTime, Effect, Match, Result } from 'effect'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { type SecretBox, secretContext } from '@edi-bridge/channels'
import {
  type DocumentStructure,
  inferDocumentStructure,
  type LookupTableEntry,
  type MappingGraph,
  type MappingVersion,
  mappingVersionSchema,
  type MessageType,
  type RunError,
  type RunProblem,
  type RunStepStage,
  toEncodedFile,
} from '@edi-bridge/contracts'
import {
  acknowledgements,
  channels,
  documents,
  documentStructures,
  flows,
  lookupTableEntries,
  lookupTables,
  mappings,
  mappingVersions,
  runs,
  runSteps,
  tradingPartners,
  users,
  workspaces,
} from '@edi-bridge/db'
import { buildContrl, isBrokenMessage, type Message, parseMessages } from '@edi-bridge/edifact'
import {
  applyInboundMappingVersion,
  MappingError,
  mapMessage,
  readDocument,
  writeDocument,
} from '@edi-bridge/mapping'
import invoicReference from '@edi-bridge/mapping/golden/invoic-reference.mapping.json' with { type: 'json' }
import ordersReference from '@edi-bridge/mapping/golden/orders-reference-json.mapping.json' with { type: 'json' }
import { enveloped, stagesOf } from '@edi-bridge/pipeline'

import { newWebhookToken } from './channel.js'
import { dayMs, hourMs, minuteMs } from './duration.js'
import {
  erpInvoice,
  erpInvoiceSample,
  erpOrderSample,
  ordersInterchange,
  seedArticles,
  seedChannelDomain,
  seedCompany,
  type SeedOrder,
  type SeedTradingPartner,
  seedTradingPartners,
} from './seed-content.js'

import type { Transaction } from './db.js'

export interface SeedOptions {
  secrets: SecretBox
  now?: Date
}

type Inserted<Row> = Promise<Row[]>

const one = async <Row>(rows: Inserted<Row>) => {
  const [row] = await rows

  if (row === undefined) {
    throw new Error('Seed insert returned no row')
  }

  return row
}

const referenceVersion = <D extends MappingVersion['direction']>(
  version: MappingVersion,
  direction: D,
) => {
  if (version.direction !== direction) {
    throw new Error(`The reference Mapping Version ${version.mappingName} is not ${direction}`)
  }

  // SAFETY: the check above narrowed the direction to D.
  return version as Extract<MappingVersion, { direction: D }>
}

const graphOf = (
  { links, transforms, transformLinks }: MappingGraph,
  lookupTableId: string,
): MappingGraph => ({
  links,
  // Each seeded Workspace has its own Lookup Tables, so the transform points at the new one.
  transforms: transforms.map((transform) =>
    transform.kind === 'lookupTable'
      ? { ...transform, config: { ...transform.config, lookupTableId } }
      : transform,
  ),
  transformLinks,
})

const seedPublisher = { name: 'EDI Bridge seed', email: 'seed@edi-bridge.invalid' }

async function seedPublisherId(tx: Transaction) {
  // Mapping Versions name who published them; seeded ones name the seed, a user who never signs in.
  await tx.insert(users).values(seedPublisher).onConflictDoNothing({ target: users.email })

  const { id } = await one(
    tx.select({ id: users.id }).from(users).where(eq(users.email, seedPublisher.email)),
  )

  return id
}

const pick = <A>(items: readonly A[], index: number) => {
  const item = items[index % items.length]

  if (item === undefined) {
    throw new Error('The seed picks from an empty list')
  }

  return item
}

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

const at = (now: Date, ms: number) => new Date(now.getTime() - ms)

const later = (date: Date, ms: number) => new Date(date.getTime() + ms)

const stepMs = 400

type Ending =
  | { status: 'delivered' }
  | { status: 'duplicate' }
  | { status: 'failed'; stage: RunStepStage }

function stepsOf(runId: string, messageType: MessageType, receivedAt: Date, ending: Ending) {
  const stages = stagesOf({ messageType })

  // A Duplicate stops after its receipt, a failed Run at its Failure Stage.
  const stopAt = Match.value(ending).pipe(
    Match.when({ status: 'failed' }, ({ stage }) => stages.indexOf(stage)),
    Match.when({ status: 'duplicate' }, () => 1),
    Match.orElse(() => stages.length),
  )

  return stages.map((stage, position) => {
    const startedAt = later(receivedAt, position * stepMs)
    const finishedAt = later(startedAt, stepMs)

    if (position < stopAt) {
      return { runId, position, stage, status: 'succeeded' as const, startedAt, finishedAt }
    }

    if (position === stopAt && ending.status === 'failed') {
      return { runId, position, stage, status: 'failed' as const, startedAt, finishedAt }
    }

    return { runId, position, stage, status: 'skipped' as const }
  })
}

type Failure = { error: RunError; problem: Omit<RunProblem, 'whoFixes'> }

export async function seedWorkspace(
  tx: Transaction,
  workspaceId: string,
  { secrets, now = new Date() }: SeedOptions,
) {
  const publishedBy = await seedPublisherId(tx)
  const onboardedAt = at(now, 30 * dayMs)

  await tx
    .update(workspaces)
    .set({ gln: seedCompany.gln, seeded: true })
    .where(eq(workspaces.id, workspaceId))

  const partners = await Promise.all(
    seedTradingPartners.map(async (seed) => ({
      seed,
      row: await one(
        tx
          .insert(tradingPartners)
          .values({
            workspaceId,
            name: seed.name,
            gln: seed.gln,
            characterSet: 'UNOC',
            acknowledgementTimeLimitHours: seed.acknowledgementTimeLimitHours,
            testMode: seed.testMode,
            ...(!seed.testMode && {
              testInterchangeSentAt: onboardedAt,
              contrlReceivedAt: later(onboardedAt, hourMs),
            }),
          })
          .returning(),
      ),
    })),
  )

  const lookupTable = async (
    name: string,
    entries: LookupTableEntry[],
    {
      kind = 'units',
      tradingPartnerId,
    }: { kind?: 'units' | 'addresses'; tradingPartnerId?: string } = {},
  ) => {
    const table = await one(
      tx
        .insert(lookupTables)
        .values({ workspaceId, name, kind, tradingPartnerId: tradingPartnerId ?? null })
        .returning(),
    )

    await tx
      .insert(lookupTableEntries)
      .values(entries.map((entry, position) => ({ lookupTableId: table.id, position, ...entry })))

    return { id: table.id, name, entries }
  }

  const invoiceUnits = await lookupTable('Invoice units', [
    { sourceCode: 'ST', targetCode: 'PCE' },
    { sourceCode: 'KAR', targetCode: 'CT' },
  ])

  const orderUnits = await lookupTable('Order units', [
    { sourceCode: 'PCE', targetCode: 'ST' },
    { sourceCode: 'CT', targetCode: 'KAR' },
  ])

  for (const { seed, row } of partners) {
    if (seed.stores.length > 0) {
      await lookupTable(
        `${seed.name} stores`,
        seed.stores.map(({ gln }, index) => ({
          sourceCode: gln,
          targetCode: `F${String(index + 1).padStart(3, '0')}`,
        })),
        { kind: 'addresses', tradingPartnerId: row.id },
      )
    }
  }

  const lookupEntries = new Map([
    [invoiceUnits.id, invoiceUnits.entries],
    [orderUnits.id, orderUnits.entries],
  ])

  const structure = async (
    name: string,
    fileName: string,
    sample: typeof erpInvoiceSample | typeof erpOrderSample,
  ) => {
    const inferred = inferDocumentStructure(
      { kind: 'jsonDocument', document: toEncodedFile(fileName, JSON.stringify(sample, null, 2)) },
      { takenAt: onboardedAt.toISOString() },
    )

    if (inferred.format !== 'json' || inferred.sample === null) {
      throw new Error(`The seed sample ${fileName} is not a JSON Document`)
    }

    const row = await one(
      tx
        .insert(documentStructures)
        .values({
          workspaceId,
          name,
          format: 'json',
          jsonRoot: inferred.root,
          children: inferred.children,
          sampleFileName: inferred.sample.fileName,
          sampleText: inferred.sample.text,
          sampleTakenAt: onboardedAt,
          createdAt: onboardedAt,
          updatedAt: onboardedAt,
        })
        .returning(),
    )

    return {
      id: row.id,
      name,
      format: 'json',
      root: inferred.root,
      children: inferred.children,
      sample: inferred.sample,
    } satisfies DocumentStructure
  }

  const invoiceStructure = await structure('ERP invoice', 'invoice.json', erpInvoiceSample)
  const orderStructure = await structure('ERP order', 'order.json', erpOrderSample)

  const mapping = async (
    name: string,
    messageType: MessageType,
    documentStructureId: string,
    graph: MappingGraph,
  ) => {
    const row = await one(
      tx
        .insert(mappings)
        .values({
          workspaceId,
          documentStructureId,
          messageType,
          name,
          draft: graph,
          unpublishedChanges: false,
          draftUpdatedAt: onboardedAt,
          createdAt: onboardedAt,
        })
        .returning(),
    )

    const version = await one(
      tx
        .insert(mappingVersions)
        .values({ mappingId: row.id, version: 1, graph, publishedBy, publishedAt: onboardedAt })
        .returning(),
    )

    return { id: row.id, name, versionId: version.id }
  }

  const invoicReferenceVersion = referenceVersion(
    mappingVersionSchema.parse(invoicReference),
    'outbound',
  )

  const invoicGraph = graphOf(invoicReferenceVersion, invoiceUnits.id)
  const invoicVersion = { ...invoicReferenceVersion, ...invoicGraph }

  const invoicMapping = await mapping(
    'ERP invoice to INVOIC',
    'INVOIC',
    invoiceStructure.id,
    invoicGraph,
  )

  const ordersReferenceVersion = referenceVersion(
    mappingVersionSchema.parse(ordersReference),
    'inbound',
  )

  const ordersGraph = graphOf(ordersReferenceVersion, orderUnits.id)
  const ordersVersion = { ...ordersReferenceVersion, ...ordersGraph }

  const ordersMapping = await mapping(
    'ORDERS to ERP order',
    'ORDERS',
    orderStructure.id,
    ordersGraph,
  )

  const channel = async (values: Omit<typeof channels.$inferInsert, 'workspaceId' | 'id'>) => {
    const id = randomUUID()

    const seal = (column: 'encryptedCredential' | 'encryptedWebhookToken', plaintext: string) =>
      secrets.seal(plaintext, secretContext(id, column))

    const token = newWebhookToken()

    const sealedValues = Match.value(values.type).pipe(
      Match.when('sftp', () => ({
        encryptedCredential: seal('encryptedCredential', randomBytes(18).toString('base64url')),
      })),
      Match.when('webhook', () => ({
        encryptedWebhookToken: seal('encryptedWebhookToken', token),
        webhookTokenLastFour: token.slice(-4),
      })),
      Match.orElse(() => ({})),
    )

    return one(
      tx
        .insert(channels)
        .values({
          ...values,
          ...sealedValues,
          id,
          workspaceId,
          seeded: true,
          createdAt: onboardedAt,
          updatedAt: onboardedAt,
        })
        .returning(),
    )
  }

  const erpWebhook = await channel({
    type: 'webhook',
    direction: 'inbound',
    name: 'ERP invoices',
    rateLimitPerMinute: 60,
  })

  const erpInbox = await channel({
    type: 'http',
    direction: 'outbound',
    name: 'ERP order inbox',
    url: `https://erp.edi-bridge-seed.${seedChannelDomain}/orders`,
  })

  const partnerChannels = await Promise.all(
    partners.map(async ({ seed, row }) => {
      const sftp = {
        type: 'sftp' as const,
        tradingPartnerId: row.id,
        host: `sftp.${seed.slug}.${seedChannelDomain}`,
        port: 22,
        username: 'edi-bridge-seed',
        authentication: 'password' as const,
      }

      return {
        inbound: await channel({
          ...sftp,
          direction: 'inbound',
          name: `${seed.name} outbox`,
          remotePath: '/outbox',
          pollingIntervalMinutes: 5,
        }),
        outbound: await channel({
          ...sftp,
          direction: 'outbound',
          name: `${seed.name} inbox`,
          remotePath: '/inbox',
        }),
      }
    }),
  )

  let nextControlReferences = partners.map(() => 1)

  const claimReference = (partner: number) => {
    const reference = nextControlReferences[partner] ?? 1

    nextControlReferences = nextControlReferences.map((value, index) =>
      index === partner ? value + 1 : value,
    )

    return reference
  }

  const sentAt = (date: Date) => DateTime.fromDateUnsafe(date)

  const interchangeOf = (
    message: Message,
    partner: SeedTradingPartner,
    reference: number,
    date: Date,
  ) =>
    enveloped(message, {
      characterSet: 'UNOC',
      sender: seedCompany.gln,
      receiver: partner.gln,
      sentAt: sentAt(date),
      reference,
      testIndicator: false,
    })

  const insertRun = async (
    values: Omit<typeof runs.$inferInsert, 'workspaceId' | 'manualSubmission'> & {
      receivedAt: Date
    },
    messageType: MessageType,
    ending: Ending,
  ) => {
    const run = await one(
      tx
        .insert(runs)
        .values({ ...values, workspaceId, manualSubmission: false, updatedAt: values.receivedAt })
        .returning(),
    )

    await tx.insert(runSteps).values(stepsOf(run.id, messageType, values.receivedAt, ending))

    return run
  }

  const insertDocument = (values: Omit<typeof documents.$inferInsert, 'workspaceId'>) =>
    one(
      tx
        .insert(documents)
        .values({ ...values, workspaceId })
        .returning(),
    )

  for (const [index, { seed, row }] of partners.entries()) {
    const partnerChannel = partnerChannels[index]

    if (partnerChannel === undefined) {
      continue
    }

    const ordersFlow = await one(
      tx
        .insert(flows)
        .values({
          workspaceId,
          tradingPartnerId: row.id,
          messageType: 'ORDERS',
          name: `Orders from ${seed.name}`,
          inboundChannelId: partnerChannel.inbound.id,
          destinationChannelId: erpInbox.id,
          mappingVersionId: ordersMapping.versionId,
          createdAt: onboardedAt,
          updatedAt: onboardedAt,
        })
        .returning(),
    )

    const invoicFlow = await one(
      tx
        .insert(flows)
        .values({
          workspaceId,
          tradingPartnerId: row.id,
          messageType: 'INVOIC',
          name: `Invoices to ${seed.name}`,
          inboundChannelId: erpWebhook.id,
          destinationChannelId: partnerChannel.outbound.id,
          mappingVersionId: invoicMapping.versionId,
          createdAt: onboardedAt,
          updatedAt: onboardedAt,
        })
        .returning(),
    )

    if (seed.testMode) {
      continue
    }

    for (let cycle = 0; cycle < 6; cycle++) {
      // The newest order arrives at now, so a new Workspace has traffic of today at any hour.
      const orderedAt = at(now, cycle * 27 * hourMs + index * (5 * hourMs + minuteMs))
      const sequence = String(100_000 + index * 1000 + cycle)
      const unreadable = index === 1 && cycle === 3
      const missingCode = index === 0 && cycle === 2

      const order: SeedOrder = {
        number: `B-${sequence}`,
        orderedAt,
        deliveryDate: later(orderedAt, 3 * dayMs),
        tradingPartner: seed,
        store: pick(seed.stores, cycle),
        lines: [
          {
            article: pick(seedArticles, cycle + index),
            quantity: 6 * (cycle + 2),
            unit: missingCode ? 'KGM' : 'PCE',
          },
          {
            article: pick(seedArticles, cycle + index + 1),
            quantity: 12,
            unit: 'PCE',
          },
        ],
      }

      const reference = String(4000 + cycle).padStart(8, '0')
      const content = ordersInterchange(order, reference, unreadable ? { segmentCount: 99 } : {})

      const document = await insertDocument({
        channelId: partnerChannel.inbound.id,
        fileName: `ORDERS_${order.number}.edi`,
        content,
        interchangeSender: seed.gln,
        interchangeControlReference: reference,
        contentHash: sha256(content),
        receivedAt: orderedAt,
      })

      const [parsed] = parseMessages(content).messages

      if (parsed === undefined) {
        throw new Error(`The seeded ORDERS ${order.number} has no Message`)
      }

      const inbound = {
        documentId: document.id,
        flowId: ordersFlow.id,
        tradingPartnerId: row.id,
        mappingVersionId: ordersMapping.versionId,
        messageIndex: 1,
        receivedAt: orderedAt,
      }

      if (isBrokenMessage(parsed)) {
        const segments = content.split("'\n")
        const { position } = parsed.error

        await insertRun(
          {
            ...inbound,
            status: 'failed',
            failureStage: 'parse',
            error: {
              code: parsed.error.code,
              message: parsed.error.message,
              position: {
                segment: position.segment,
                tag: segments[position.segment - 1]?.slice(0, 3) ?? 'UNT',
                element: position.element ?? null,
                component: position.component ?? null,
              },
              details: null,
            },
            problem: {
              reason: 'unreadable',
              fixTarget: { kind: 'tradingPartner', tradingPartnerId: row.id, name: seed.name },
            },
          },
          'ORDERS',
          { status: 'failed', stage: 'parse' },
        )

        continue
      }

      const contrlReference = claimReference(index)
      const contrlAt = later(orderedAt, 2 * stepMs)

      await tx.insert(acknowledgements).values({
        workspaceId,
        documentId: document.id,
        tradingPartnerId: row.id,
        channelId: partnerChannel.outbound.id,
        controlReference: contrlReference,
        content: interchangeOf(buildContrl(content, '1'), seed, contrlReference, contrlAt),
        deliveryAttemptedAt: contrlAt,
        handedOverAt: contrlAt,
        createdAt: contrlAt,
      })

      const references = { businessReference: order.number, documentNumber: order.number }

      const mapped = Effect.runSync(
        Effect.result(
          applyInboundMappingVersion(ordersVersion, orderStructure, parsed, {
            lookupTables: lookupEntries,
          }).pipe(Effect.flatMap((written) => writeDocument(orderStructure, written))),
        ),
      )

      if (Result.isFailure(mapped)) {
        const failure = mapped.failure

        if (!(failure instanceof MappingError) || failure.lookup?.code === undefined) {
          throw new Error(`The seeded ORDERS ${order.number} does not map: ${failure.message}`)
        }

        const missing: Failure = {
          error: {
            code: failure.code,
            message: `${failure.code} at ${failure.targetPath}`,
            position: null,
            details: null,
          },
          problem: {
            reason: 'missingCode',
            fixTarget: {
              kind: 'lookupTable',
              lookupTableId: orderUnits.id,
              name: orderUnits.name,
              code: failure.lookup.code,
            },
          },
        }

        await insertRun(
          { ...inbound, ...references, status: 'failed', failureStage: 'mapping', ...missing },
          'ORDERS',
          { status: 'failed', stage: 'mapping' },
        )

        continue
      }

      const delivered = await insertRun(
        {
          ...inbound,
          ...references,
          status: 'delivered',
          output: new TextDecoder().decode(mapped.success),
          handedOverAt: later(orderedAt, 5 * stepMs),
        },
        'ORDERS',
        { status: 'delivered' },
      )

      // The Trading Partner sent the order again, which the Duplicate check stopped.
      if (index === 0 && cycle === 3) {
        const resentAt = later(orderedAt, 45 * minuteMs)

        const resent = await insertDocument({
          channelId: partnerChannel.inbound.id,
          fileName: `ORDERS_${order.number}_resent.edi`,
          content,
          interchangeSender: seed.gln,
          interchangeControlReference: reference,
          contentHash: sha256(content),
          receivedAt: resentAt,
        })

        await insertRun(
          {
            ...inbound,
            ...references,
            documentId: resent.id,
            mappingVersionId: null,
            status: 'duplicate',
            duplicateOfRunId: delivered.id,
            receivedAt: resentAt,
          },
          'ORDERS',
          { status: 'duplicate' },
        )
      }

      const invoicedAt = later(orderedAt, 3 * hourMs)

      if (invoicedAt > at(now, minuteMs)) {
        continue
      }

      const invoiceNumber = `R-${sequence}`
      const invoiceText = `${JSON.stringify(erpInvoice(order, invoiceNumber, invoicedAt), null, 2)}\n`

      const invoiceDocument = await insertDocument({
        channelId: erpWebhook.id,
        fileName: `invoice-${invoiceNumber}.json`,
        content: invoiceText,
        receivedAt: invoicedAt,
      })

      const { message } = Effect.runSync(
        readDocument(invoiceStructure, invoiceText).pipe(
          Effect.flatMap((read) =>
            mapMessage(invoicVersion, read, { lookupTables: lookupEntries }),
          ),
        ),
      )

      const invoicReferenceNumber = claimReference(index)
      const handedOverAt = later(invoicedAt, 4 * stepMs)
      const unreachable = index === 1 && cycle === 1

      const outbound = {
        documentId: invoiceDocument.id,
        flowId: invoicFlow.id,
        tradingPartnerId: row.id,
        mappingVersionId: invoicMapping.versionId,
        businessReference: order.number,
        documentNumber: invoiceNumber,
        deliveryInput: message,
        output: interchangeOf(message, seed, invoicReferenceNumber, handedOverAt),
        controlReference: invoicReferenceNumber,
        receivedAt: invoicedAt,
      }

      if (unreachable) {
        await insertRun(
          {
            ...outbound,
            status: 'failed',
            failureStage: 'delivery',
            error: {
              code: 'hostUnreachable',
              message: 'The host of the Channel is unreachable',
              position: null,
              details: null,
            },
            problem: {
              reason: 'unreachable',
              fixTarget: {
                kind: 'channel',
                channelId: partnerChannel.outbound.id,
                name: partnerChannel.outbound.name,
              },
            },
          },
          'INVOIC',
          { status: 'failed', stage: 'delivery' },
        )

        continue
      }

      // A day old by then, so past the time limit of the Trading Partner.
      const overdue = index === 0 && cycle === 1

      await insertRun(
        {
          ...outbound,
          status: 'delivered',
          handedOverAt,
          acknowledgementState: overdue ? 'overdue' : 'accepted',
        },
        'INVOIC',
        { status: 'delivered' },
      )
    }
  }

  for (const [index, { row }] of partners.entries()) {
    await tx
      .update(tradingPartners)
      .set({ nextControlReference: nextControlReferences[index] ?? 1 })
      .where(eq(tradingPartners.id, row.id))
  }
}
