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
  seedOnboardingTradingPartner,
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

async function seedSetup(
  tx: Transaction,
  workspaceId: string,
  { secrets, onboardedAt }: { secrets: SecretBox; onboardedAt: Date },
) {
  const publishedBy = await seedPublisherId(tx)

  await tx
    .update(workspaces)
    .set({ gln: seedCompany.gln, seeded: true })
    .where(eq(workspaces.id, workspaceId))

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

  const flow = (values: Omit<typeof flows.$inferInsert, 'workspaceId'>) =>
    one(
      tx
        .insert(flows)
        .values({ ...values, workspaceId, createdAt: onboardedAt, updatedAt: onboardedAt })
        .returning(),
    )

  type TradingPartnerSeed = Pick<SeedTradingPartner, 'name' | 'slug'>

  const sftpOf = ({ slug }: TradingPartnerSeed, tradingPartnerId: string) => ({
    type: 'sftp' as const,
    tradingPartnerId,
    host: `sftp.${slug}.${seedChannelDomain}`,
    port: 22,
    username: 'edi-bridge-seed',
    authentication: 'password' as const,
  })

  const sftpOutbox = (tradingPartner: TradingPartnerSeed, tradingPartnerId: string) =>
    channel({
      ...sftpOf(tradingPartner, tradingPartnerId),
      direction: 'inbound',
      name: `${tradingPartner.name} outbox`,
      remotePath: '/outbox',
      pollingIntervalMinutes: 5,
    })

  const ordersFlowOf = (
    tradingPartner: TradingPartnerSeed,
    tradingPartnerId: string,
    inboundChannelId: string,
  ) =>
    flow({
      tradingPartnerId,
      messageType: 'ORDERS',
      name: `Orders from ${tradingPartner.name}`,
      inboundChannelId,
      destinationChannelId: erpInbox.id,
      mappingVersionId: ordersMapping.versionId,
    })

  const partners = []

  for (const seed of seedTradingPartners) {
    const row = await one(
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
    )

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

    const inbound = await sftpOutbox(seed, row.id)

    const outbound = await channel({
      ...sftpOf(seed, row.id),
      direction: 'outbound',
      name: `${seed.name} inbox`,
      remotePath: '/inbox',
    })

    const ordersFlow = await ordersFlowOf(seed, row.id, inbound.id)

    const invoicFlow = await flow({
      tradingPartnerId: row.id,
      messageType: 'INVOIC',
      name: `Invoices to ${seed.name}`,
      inboundChannelId: erpWebhook.id,
      destinationChannelId: outbound.id,
      mappingVersionId: invoicMapping.versionId,
    })

    partners.push({ seed, row, inbound, outbound, ordersFlow, invoicFlow })
  }

  const onboarding = await one(
    tx
      .insert(tradingPartners)
      .values({
        workspaceId,
        name: seedOnboardingTradingPartner.name,
        gln: seedOnboardingTradingPartner.gln,
        characterSet: 'UNOC',
        acknowledgementTimeLimitHours: seedOnboardingTradingPartner.acknowledgementTimeLimitHours,
        messageTypes: seedOnboardingTradingPartner.messageTypes,
        testMode: true,
      })
      .returning(),
  )

  const onboardingOutbox = await sftpOutbox(seedOnboardingTradingPartner, onboarding.id)

  await ordersFlowOf(seedOnboardingTradingPartner, onboarding.id, onboardingOutbox.id)

  return {
    partners,
    erpWebhook,
    lookupEntries,
    orderUnits,
    invoiceStructure,
    orderStructure,
    invoicMapping: { ...invoicMapping, version: { ...invoicReferenceVersion, ...invoicGraph } },
    ordersMapping: { ...ordersMapping, version: { ...ordersReferenceVersion, ...ordersGraph } },
  }
}

type Setup = Awaited<ReturnType<typeof seedSetup>>

type SeededPartner = Setup['partners'][number]

async function seedTraffic(tx: Transaction, workspaceId: string, setup: Setup, now: Date) {
  const {
    erpWebhook,
    lookupEntries,
    orderUnits,
    invoiceStructure,
    orderStructure,
    invoicMapping,
    ordersMapping,
  } = setup

  const nextControlReferences = new Map(setup.partners.map(({ row }) => [row.id, 1]))

  const claimReference = ({ row }: SeededPartner) => {
    const reference = nextControlReferences.get(row.id) ?? 1

    nextControlReferences.set(row.id, reference + 1)

    return reference
  }

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
      sentAt: DateTime.fromDateUnsafe(date),
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

  for (const [index, partner] of setup.partners.entries()) {
    const { seed, row, inbound: inboundChannel, outbound: outboundChannel } = partner

    for (const [cycle, scenario] of seed.orders.entries()) {
      // The newest order arrives at now, so a new Workspace has traffic of today at any hour.
      const orderedAt = at(now, cycle * 27 * hourMs + index * (5 * hourMs + minuteMs))
      const sequence = String(100_000 + index * 1000 + cycle)

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
            unit: scenario === 'missingCode' ? 'KGM' : 'PCE',
          },
          {
            article: pick(seedArticles, cycle + index + 1),
            quantity: 12,
            unit: 'PCE',
          },
        ],
      }

      const reference = String(4000 + cycle).padStart(8, '0')

      const content = ordersInterchange(
        order,
        reference,
        scenario === 'unreadableOrder' ? { segmentCount: 99 } : {},
      )

      const document = await insertDocument({
        channelId: inboundChannel.id,
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
        flowId: partner.ordersFlow.id,
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

      const contrlReference = claimReference(partner)
      const contrlAt = later(orderedAt, 2 * stepMs)

      await tx.insert(acknowledgements).values({
        workspaceId,
        documentId: document.id,
        tradingPartnerId: row.id,
        channelId: outboundChannel.id,
        controlReference: contrlReference,
        content: interchangeOf(buildContrl(content, '1'), seed, contrlReference, contrlAt),
        deliveryAttemptedAt: contrlAt,
        handedOverAt: contrlAt,
        createdAt: contrlAt,
      })

      const references = { businessReference: order.number, documentNumber: order.number }

      const mapped = Effect.runSync(
        Effect.result(
          applyInboundMappingVersion(ordersMapping.version, orderStructure, parsed, {
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

      if (scenario === 'resentOrder') {
        const resentAt = later(orderedAt, 45 * minuteMs)

        const resent = await insertDocument({
          channelId: inboundChannel.id,
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
            mapMessage(invoicMapping.version, read, { lookupTables: lookupEntries }),
          ),
        ),
      )

      const invoicReferenceNumber = claimReference(partner)
      const handedOverAt = later(invoicedAt, 4 * stepMs)

      const outbound = {
        documentId: invoiceDocument.id,
        flowId: partner.invoicFlow.id,
        tradingPartnerId: row.id,
        mappingVersionId: invoicMapping.versionId,
        businessReference: order.number,
        documentNumber: invoiceNumber,
        deliveryInput: message,
        output: interchangeOf(message, seed, invoicReferenceNumber, handedOverAt),
        controlReference: invoicReferenceNumber,
        receivedAt: invoicedAt,
      }

      if (scenario === 'unreachableHost') {
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
                channelId: outboundChannel.id,
                name: outboundChannel.name,
              },
            },
          },
          'INVOIC',
          { status: 'failed', stage: 'delivery' },
        )

        continue
      }

      await insertRun(
        {
          ...outbound,
          status: 'delivered',
          handedOverAt,
          // Handed over a day ago, so past the time limit of the Trading Partner.
          acknowledgementState: scenario === 'overdueAcknowledgement' ? 'overdue' : 'accepted',
        },
        'INVOIC',
        { status: 'delivered' },
      )
    }
  }

  for (const { row } of setup.partners) {
    await tx
      .update(tradingPartners)
      .set({ nextControlReference: nextControlReferences.get(row.id) ?? 1 })
      .where(eq(tradingPartners.id, row.id))
  }
}

export async function seedWorkspace(
  tx: Transaction,
  workspaceId: string,
  { secrets, now = new Date() }: SeedOptions,
) {
  const setup = await seedSetup(tx, workspaceId, { secrets, onboardedAt: at(now, 30 * dayMs) })

  await seedTraffic(tx, workspaceId, setup, now)
}
