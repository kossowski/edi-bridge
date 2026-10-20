import { and, eq, exists, inArray, isNotNull, isNull } from 'drizzle-orm'
import { DateTime, Effect } from 'effect'

import {
  messageTypeDirections,
  messageTypes,
  type TestInterchangeRefusal,
} from '@edi-bridge/contracts'
import {
  channels,
  documents,
  documentStructures,
  flows,
  mappings,
  mappingVersions,
  tradingPartners,
  type Transaction,
  workspaces,
} from '@edi-bridge/db'

import { TestInterchangeRefused } from './errors'
import { queueReceived, type ReceivedRun, storeRun } from './receive'
import { Database } from './services'

export type TestSend = { workspaceId: string; tradingPartnerId: string }

type Flow = typeof flows.$inferSelect

type Sample = { fileName: string; content: string }

type Candidate = { flow: Flow; sample: Sample | undefined }

const outboundMessageTypes = messageTypes.filter(
  (messageType) => messageTypeDirections[messageType] === 'outbound',
)

const nameCollator = new Intl.Collator('de')

// canSendTestInterchange in SQL; the lock holds a concurrent CONTRL or switch back until the Run is stored.
const lockAwaitingTestInterchange = (
  tx: Transaction,
  { workspaceId, tradingPartnerId }: TestSend,
) =>
  tx
    .select({ id: tradingPartners.id })
    .from(tradingPartners)
    .where(
      and(
        eq(tradingPartners.workspaceId, workspaceId),
        eq(tradingPartners.id, tradingPartnerId),
        eq(tradingPartners.testMode, true),
        isNotNull(tradingPartners.gln),
        isNull(tradingPartners.contrlReceivedAt),
        exists(
          tx
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.id, tradingPartners.workspaceId), isNotNull(workspaces.gln))),
        ),
      ),
    )
    .for('update')

// An outbound Flow hands its Interchange to the Trading Partner's own outbound Channel.
async function candidatesOf(tx: Transaction, { workspaceId, tradingPartnerId }: TestSend) {
  const rows = await tx
    .select({
      flow: flows,
      sampleFileName: documentStructures.sampleFileName,
      sampleText: documentStructures.sampleText,
    })
    .from(flows)
    .innerJoin(
      channels,
      and(
        eq(channels.id, flows.destinationChannelId),
        eq(channels.direction, 'outbound'),
        eq(channels.tradingPartnerId, flows.tradingPartnerId),
      ),
    )
    .innerJoin(mappingVersions, eq(mappingVersions.id, flows.mappingVersionId))
    .innerJoin(mappings, eq(mappings.id, mappingVersions.mappingId))
    .innerJoin(documentStructures, eq(documentStructures.id, mappings.documentStructureId))
    .where(
      and(
        eq(flows.workspaceId, workspaceId),
        eq(flows.tradingPartnerId, tradingPartnerId),
        inArray(flows.messageType, outboundMessageTypes),
      ),
    )

  return rows
    .map(({ flow, sampleFileName, sampleText }): Candidate => ({
      flow,
      sample:
        sampleFileName === null || sampleText === null
          ? undefined
          : { fileName: sampleFileName, content: sampleText },
    }))
    .toSorted(
      (a, b) =>
        nameCollator.compare(a.flow.name, b.flow.name) || a.flow.id.localeCompare(b.flow.id),
    )
}

type Chosen = { flow: Flow; sample: Sample }

// The first Flow by name with a sample sends it, so the same Flow sends each test.
function choose(candidates: readonly Candidate[]): Chosen | TestInterchangeRefusal {
  const [first] = candidates

  if (first === undefined) {
    return { reason: 'noOutboundFlow' }
  }

  const chosen = candidates.find(({ sample }) => sample !== undefined)

  return chosen?.sample === undefined
    ? { reason: 'sampleMissing', flow: { id: first.flow.id, name: first.flow.name } }
    : { flow: chosen.flow, sample: chosen.sample }
}

export const sendTestDocument = (send: TestSend) =>
  Effect.gen(function* () {
    const db = yield* Database
    const receivedAt = yield* DateTime.nowAsDate

    const outcome = yield* Effect.promise(() =>
      db.transaction(async (tx): Promise<ReceivedRun | TestInterchangeRefusal> => {
        const [awaiting] = await lockAwaitingTestInterchange(tx, send)

        if (awaiting === undefined) {
          return { reason: 'notAwaited' }
        }

        const chosen = choose(await candidatesOf(tx, send))

        if ('reason' in chosen) {
          return chosen
        }

        const [document] = await tx
          .insert(documents)
          .values({
            workspaceId: send.workspaceId,
            channelId: chosen.flow.inboundChannelId,
            fileName: chosen.sample.fileName,
            content: chosen.sample.content,
            receivedAt,
          })
          .returning()

        if (document === undefined) {
          throw new Error('Document insert returned no row')
        }

        const run = await storeRun(tx, {
          flow: chosen.flow,
          run: {
            workspaceId: send.workspaceId,
            documentId: document.id,
            manualSubmission: true,
            receivedAt,
            messageIndex: null,
          },
          receipt: { startedAt: receivedAt, finishedAt: receivedAt },
        })

        // The new test answers the earlier rejection.
        await tx
          .update(tradingPartners)
          .set({ testRejectedAt: null, testRejectedRunId: null })
          .where(eq(tradingPartners.id, send.tradingPartnerId))

        return run
      }),
    )

    if ('reason' in outcome) {
      return yield* new TestInterchangeRefused({ refusal: outcome })
    }

    yield* queueReceived([outcome])

    return outcome
  })
