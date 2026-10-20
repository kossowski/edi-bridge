import { aliasedTable, and, asc, eq, isNull, ne, notExists, sql } from 'drizzle-orm'
import { DateTime, Effect, Result } from 'effect'

import { directionOf } from '@edi-bridge/contracts'
import {
  channels,
  documents as storedDocuments,
  flows,
  type RawDocument,
  runs,
  runSteps,
  tradingPartners,
  type Transaction,
} from '@edi-bridge/db'
import { ParseError, parseMessages, readInterchange } from '@edi-bridge/edifact'

import { answerDocument } from './acknowledgement'
import { ReceiptRejected } from './errors'
import { Database, Documents, RunQueue } from './services'
import { stagesOf } from './stages'

export type ArrivingDocument = {
  workspaceId: string
  channelId: string
  fileName: string
  content: string
  manualSubmission: boolean
}

type Flow = typeof flows.$inferSelect

export type ReceivedRun = typeof runs.$inferSelect

export type Receipt = {
  document: RawDocument
  runs: ReceivedRun[]
  notRouted: Array<{ messageType: string }>
  notQueued: string[]
}

type DeclaredMessage = { messageType: string; messageIndex: number }

type Declared = { sender: string | undefined; messages: DeclaredMessage[] }

type ChannelFlow = { flow: Flow; tradingPartnerGln: string | null }

type RoutedMessage = { flow: Flow; messageIndex: number | null }

type InterchangeKey = { sender: string; controlReference: string }

// A Document without an Interchange envelope declares no Message Types.
function declaredMessagesOf(content: string): Declared {
  try {
    const interchange = parseMessages(content)

    return {
      sender: interchange.header.elements[1]?.[0],
      messages: interchange.messages.flatMap(({ header }, index) => {
        const messageType = header.elements[1]?.[0]

        return messageType === undefined ? [] : [{ messageType, messageIndex: index + 1 }]
      }),
    }
  } catch (error) {
    if (error instanceof ParseError) {
      return { sender: undefined, messages: [] }
    }

    throw error
  }
}

// A Flow takes Documents from one Trading Partner, so a shared Message Type goes by the sender.
function flowFor(
  messageType: string,
  sender: string | undefined,
  channelFlows: readonly ChannelFlow[],
) {
  const candidates = channelFlows.filter(({ flow }) => flow.messageType === messageType)

  const chosen =
    candidates.length === 1
      ? candidates
      : candidates.filter(({ tradingPartnerGln }) => tradingPartnerGln === sender)

  return chosen.length === 1 ? chosen[0]?.flow : undefined
}

// Without a Message Type to route by, only an outbound Flow's Document Structure can read it.
function route(content: string, channelFlows: readonly ChannelFlow[]) {
  const { sender, messages } = declaredMessagesOf(content)

  if (messages.length === 0) {
    const outbound = channelFlows.flatMap(({ flow }) =>
      directionOf(flow) === 'outbound' ? [flow] : [],
    )

    return outbound.length > 1
      ? Effect.fail(new ReceiptRejected({ reason: 'ambiguousFlow' }))
      : Effect.succeed({
          routed: outbound.map((flow): RoutedMessage => ({ flow, messageIndex: null })),
          notRouted: [],
        })
  }

  const routed: RoutedMessage[] = []
  const notRouted: Array<{ messageType: string }> = []

  for (const { messageType, messageIndex } of messages) {
    const flow = flowFor(messageType, sender, channelFlows)

    if (flow) {
      routed.push({ flow, messageIndex })
    } else {
      notRouted.push({ messageType })
    }
  }

  return Effect.succeed({ routed, notRouted })
}

function interchangeKeyOf(content: string): InterchangeKey | undefined {
  try {
    const { header } = readInterchange(content)
    const sender = header?.elements[1]?.[0]
    const controlReference = header?.elements[4]?.[0]

    return sender && controlReference ? { sender, controlReference } : undefined
  } catch (error) {
    if (error instanceof ParseError) {
      return undefined
    }

    throw error
  }
}

const replaced = aliasedTable(runs, 'replaced')

// The lock holds a concurrent copy back until this one's Runs are stored, so only one is the original.
async function originalRunsOf(
  tx: Transaction,
  workspaceId: string,
  documentId: string,
  { sender, controlReference }: InterchangeKey,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([workspaceId, sender, controlReference])}, 0))`,
  )

  const found = await tx
    .select({ id: runs.id, messageIndex: runs.messageIndex })
    .from(runs)
    .innerJoin(storedDocuments, eq(storedDocuments.id, runs.documentId))
    .where(
      and(
        eq(storedDocuments.workspaceId, workspaceId),
        eq(storedDocuments.interchangeSender, sender),
        eq(storedDocuments.interchangeControlReference, controlReference),
        ne(storedDocuments.id, documentId),
        isNull(runs.duplicateOfRunId),
        // A Reprocess Run replaces a Run of its own Document, which stays the original.
        notExists(
          tx
            .select()
            .from(replaced)
            .where(
              and(eq(replaced.id, runs.replacesRunId), eq(replaced.documentId, runs.documentId)),
            ),
        ),
      ),
    )
    .orderBy(asc(storedDocuments.receivedAt), asc(storedDocuments.id))

  const originals = new Map<number, string>()

  for (const { id, messageIndex } of found) {
    if (messageIndex !== null && !originals.has(messageIndex)) {
      originals.set(messageIndex, id)
    }
  }

  return originals
}

const nameCollator = new Intl.Collator('de')

const checkInboundChannel = (workspaceId: string, channelId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const [channel] = yield* Effect.promise(() =>
      db
        .select({ direction: channels.direction })
        .from(channels)
        .where(and(eq(channels.workspaceId, workspaceId), eq(channels.id, channelId))),
    )

    if (channel === undefined) {
      return yield* new ReceiptRejected({ reason: 'unknownChannel' })
    }

    if (channel.direction !== 'inbound') {
      return yield* new ReceiptRejected({ reason: 'outboundChannel' })
    }
  })

const routeOnChannel = ({ workspaceId, channelId, content }: ArrivingDocument) =>
  Effect.gen(function* () {
    const db = yield* Database

    const found = yield* Effect.promise(() =>
      db
        .select({ flow: flows, tradingPartnerGln: tradingPartners.gln })
        .from(flows)
        .innerJoin(tradingPartners, eq(tradingPartners.id, flows.tradingPartnerId))
        .where(and(eq(flows.workspaceId, workspaceId), eq(flows.inboundChannelId, channelId))),
    )

    if (found.length === 0) {
      return yield* new ReceiptRejected({ reason: 'noFlow' })
    }

    const routing = yield* route(
      content,
      found.toSorted((a, b) => nameCollator.compare(a.flow.name, b.flow.name)),
    )

    return routing.routed.length === 0
      ? yield* new ReceiptRejected({ reason: 'noRoutedMessage' })
      : routing
  })

export const receive = (arriving: ArrivingDocument) =>
  Effect.gen(function* () {
    const receiptStartedAt = yield* DateTime.nowAsDate

    yield* checkInboundChannel(arriving.workspaceId, arriving.channelId)

    const documents = yield* Documents
    const key = interchangeKeyOf(arriving.content)

    const document = yield* Effect.promise(() =>
      documents.store({
        workspaceId: arriving.workspaceId,
        channelId: arriving.channelId,
        fileName: arriving.fileName,
        content: arriving.content,
        interchangeSender: key?.sender ?? null,
        interchangeControlReference: key?.controlReference ?? null,
      }),
    )

    const routing = yield* Effect.result(routeOnChannel(arriving))
    const receiptFinishedAt = yield* DateTime.now

    yield* answerDocument(
      { workspaceId: arriving.workspaceId, documentId: document.id, content: arriving.content },
      receiptFinishedAt,
    )

    if (Result.isFailure(routing)) {
      // A Document rejected after storing stays findable by its id.
      return yield* new ReceiptRejected({ reason: routing.failure.reason, documentId: document.id })
    }

    const { routed, notRouted } = routing.success
    const db = yield* Database

    const created = yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const originals =
          key === undefined
            ? new Map<number, string>()
            : await originalRunsOf(tx, arriving.workspaceId, document.id, key)

        return Promise.all(
          routed.map(async ({ flow, messageIndex }) => {
            const duplicateOfRunId = messageIndex === null ? undefined : originals.get(messageIndex)

            const [run] = await tx
              .insert(runs)
              .values({
                workspaceId: arriving.workspaceId,
                documentId: document.id,
                flowId: flow.id,
                tradingPartnerId: flow.tradingPartnerId,
                manualSubmission: arriving.manualSubmission,
                receivedAt: document.receivedAt,
                messageIndex,
                ...(duplicateOfRunId !== undefined && {
                  status: 'duplicate' as const,
                  duplicateOfRunId,
                }),
              })
              .returning()

            if (run === undefined) {
              throw new Error('Run insert returned no row')
            }

            await tx.insert(runSteps).values(
              stagesOf(flow).map((stage, position) =>
                stage === 'receipt'
                  ? {
                      runId: run.id,
                      position,
                      stage,
                      status: 'succeeded' as const,
                      startedAt: receiptStartedAt,
                      finishedAt: DateTime.toDateUtc(receiptFinishedAt),
                    }
                  : {
                      runId: run.id,
                      position,
                      stage,
                      ...(duplicateOfRunId !== undefined && { status: 'skipped' as const }),
                    },
              ),
            )

            return run
          }),
        )
      }),
    )

    const queue = yield* RunQueue
    const received = created.filter(({ status }) => status === 'received')

    // The Runs are stored already, so one not queued stays received until the next sweep.
    const [, notQueued] = yield* Effect.partition(received, (run) =>
      queue.enqueue({ workspaceId: arriving.workspaceId, runId: run.id }),
    )

    if (notQueued.length > 0) {
      yield* Effect.logWarning('Received Runs not queued until the next sweep', notQueued)
    }

    return {
      document,
      runs: created,
      notRouted,
      notQueued: notQueued.map(({ runId }) => runId),
    } satisfies Receipt
  })
