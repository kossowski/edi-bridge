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
  runs,
  tradingPartners,
  type Transaction,
  workspaces,
} from '@edi-bridge/db'

import { TestInterchangeRefused } from './errors'
import { publishRunChanges } from './live-events'
import { queueReceived, type ReceivedRun, storeRun } from './receive'
import { Database } from './services'

export type TestInterchangeToSend = { workspaceId: string; tradingPartnerId: string }

type Flow = typeof flows.$inferSelect

type Sample = { fileName: string; content: string }

type Candidate = { flow: Flow; sample: Sample | undefined }

type Refused = { kind: 'refused'; refusal: TestInterchangeRefusal }

const refused = (refusal: TestInterchangeRefusal): Refused => ({ kind: 'refused', refusal })

const outboundMessageTypes = messageTypes.filter(
  (messageType) => messageTypeDirections[messageType] === 'outbound',
)

const nameCollator = new Intl.Collator('de')

// canSendTestInterchange in SQL; the lock holds a concurrent CONTRL or switch back until the Run is stored.
const lockAwaitingTestInterchange = (
  tx: Transaction,
  { workspaceId, tradingPartnerId }: TestInterchangeToSend,
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
async function candidatesOf(
  tx: Transaction,
  { workspaceId, tradingPartnerId }: TestInterchangeToSend,
) {
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

// A test send is a manual submission on an outbound Flow; until it is handed over or fails, it is the awaited test.
async function testInFlight(
  tx: Transaction,
  { workspaceId, tradingPartnerId }: TestInterchangeToSend,
  candidates: readonly Candidate[],
) {
  if (candidates.length === 0) {
    return false
  }

  const [inFlight] = await tx
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
        eq(runs.tradingPartnerId, tradingPartnerId),
        eq(runs.manualSubmission, true),
        inArray(
          runs.flowId,
          candidates.map(({ flow }) => flow.id),
        ),
        inArray(runs.status, ['received', 'processing']),
        isNull(runs.handedOverAt),
      ),
    )
    .limit(1)

  return inFlight !== undefined
}

// The first Flow by name with a sample sends it, so the same Flow sends each test.
function choose(
  candidates: readonly Candidate[],
): Refused | { kind: 'chosen'; flow: Flow; sample: Sample } {
  const [first] = candidates

  if (first === undefined) {
    return refused({ reason: 'noOutboundFlow' })
  }

  const chosen = candidates.find(({ sample }) => sample !== undefined)

  return chosen?.sample === undefined
    ? refused({ reason: 'sampleMissing', flow: { id: first.flow.id, name: first.flow.name } })
    : { kind: 'chosen', flow: chosen.flow, sample: chosen.sample }
}

export const sendTestInterchange = (send: TestInterchangeToSend) =>
  Effect.gen(function* () {
    const db = yield* Database
    const receivedAt = yield* DateTime.nowAsDate

    const outcome = yield* Effect.promise(() =>
      db.transaction(async (tx): Promise<Refused | { kind: 'stored'; run: ReceivedRun }> => {
        const [awaiting] = await lockAwaitingTestInterchange(tx, send)

        if (awaiting === undefined) {
          return refused({ reason: 'notAwaited' })
        }

        const candidates = await candidatesOf(tx, send)

        if (await testInFlight(tx, send, candidates)) {
          return refused({ reason: 'notAwaited' })
        }

        const chosen = choose(candidates)

        if (chosen.kind === 'refused') {
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

        return { kind: 'stored', run }
      }),
    )

    if (outcome.kind === 'refused') {
      return yield* new TestInterchangeRefused({ refusal: outcome.refusal })
    }

    yield* publishRunChanges([outcome.run.id])
    yield* queueReceived([outcome.run])

    return outcome.run
  })
