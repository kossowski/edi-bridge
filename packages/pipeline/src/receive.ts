import { and, eq } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'

import { directionOf } from '@edi-bridge/contracts'
import { channels, flows, type RawDocument, runs, runSteps } from '@edi-bridge/db'
import { parse, ParseError } from '@edi-bridge/edifact'

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

// A Document that doesn't parse as an Interchange declares no Message Types.
function messageTypesOf(content: string): string[] {
  try {
    return parse(content).messages.flatMap(({ header }) => header.elements[1]?.[0] ?? [])
  } catch (error) {
    if (error instanceof ParseError) {
      return []
    }

    throw error
  }
}

// Without a Message Type to route by, only an outbound Flow's Document Structure can read it.
function route(content: string, channelFlows: readonly Flow[]) {
  const declared = messageTypesOf(content)

  if (declared.length === 0) {
    const outbound = channelFlows.filter((flow) => directionOf(flow) === 'outbound')

    return outbound.length > 1
      ? Effect.fail(new ReceiptRejected({ reason: 'ambiguousFlow' }))
      : Effect.succeed({ routed: outbound, notRouted: [] })
  }

  const routed: Flow[] = []
  const notRouted: Array<{ messageType: string }> = []

  for (const messageType of declared) {
    const flow = channelFlows.find((candidate) => candidate.messageType === messageType)

    if (flow) {
      routed.push(flow)
    } else {
      notRouted.push({ messageType })
    }
  }

  return Effect.succeed({ routed, notRouted })
}

const nameCollator = new Intl.Collator('de')

const flowsOfChannel = (workspaceId: string, channelId: string) =>
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

    const found = yield* Effect.promise(() =>
      db
        .select()
        .from(flows)
        .where(and(eq(flows.workspaceId, workspaceId), eq(flows.inboundChannelId, channelId))),
    )

    return found.length === 0
      ? yield* new ReceiptRejected({ reason: 'noFlow' })
      : found.toSorted((a, b) => nameCollator.compare(a.name, b.name))
  })

export const receive = (arriving: ArrivingDocument) =>
  Effect.gen(function* () {
    const receiptStartedAt = yield* DateTime.nowAsDate
    const channelFlows = yield* flowsOfChannel(arriving.workspaceId, arriving.channelId)
    const { routed, notRouted } = yield* route(arriving.content, channelFlows)

    if (routed.length === 0) {
      return yield* new ReceiptRejected({ reason: 'noRoutedMessage' })
    }

    if (routed.some((flow) => directionOf(flow) === 'inbound')) {
      return yield* new ReceiptRejected({ reason: 'inboundNotProcessed' })
    }

    const documents = yield* Documents

    const document = yield* Effect.promise(() =>
      documents.store({
        workspaceId: arriving.workspaceId,
        channelId: arriving.channelId,
        fileName: arriving.fileName,
        content: arriving.content,
      }),
    )

    const db = yield* Database
    const receiptFinishedAt = yield* DateTime.nowAsDate

    const created = yield* Effect.promise(() =>
      db.transaction((tx) =>
        Promise.all(
          routed.map(async (flow) => {
            const [run] = await tx
              .insert(runs)
              .values({
                workspaceId: arriving.workspaceId,
                documentId: document.id,
                flowId: flow.id,
                tradingPartnerId: flow.tradingPartnerId,
                manualSubmission: arriving.manualSubmission,
                receivedAt: document.receivedAt,
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
                      finishedAt: receiptFinishedAt,
                    }
                  : { runId: run.id, position, stage },
              ),
            )

            return run
          }),
        ),
      ),
    )

    const queue = yield* RunQueue

    // The Runs are stored already, so one not queued stays received until the next sweep.
    const [, notQueued] = yield* Effect.partition(created, (run) =>
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
