import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { Data, DateTime, type Duration, Effect, Result } from 'effect'

import { directionOf } from '@edi-bridge/contracts'
import {
  acknowledgements,
  channels,
  claimTradingPartnerControlReference,
  flows,
  tradingPartners,
  workspaces,
} from '@edi-bridge/db'
import {
  buildContrl,
  BuildContrlError,
  type BuildContrlErrorCode,
  type Message,
  readInterchange,
} from '@edi-bridge/edifact'

import { carriesTestIndicator, enveloped } from './envelope'
import { Database, Delivery } from './services'

type NotSentReason = NonNullable<(typeof acknowledgements.$inferSelect)['notSentReason']>

export type Answer = {
  tradingPartnerId: string
  channelId: string | null
  notSentReason: NotSentReason | null
  contrl: { message: Message; sender: string; receiver: string; testIndicator: boolean } | null
}

class ContrlNotBuilt extends Data.TaggedError('ContrlNotBuilt')<{
  readonly code: BuildContrlErrorCode
}> {}

const notSentMessages: Record<NotSentReason, string> = {
  noOutboundChannel: 'no outbound EDIFACT Flow of its Trading Partner names a Channel',
  ambiguousChannel: 'the outbound EDIFACT Flows of its Trading Partner name different Channels',
  workspaceGlnMissing: 'the Workspace has no GLN',
  unechoableInterchangeHeader: 'its UNB cannot be echoed in a valid CONTRL',
}

const builtContrl = (content: string) =>
  Effect.try({
    try: () => buildContrl(content, '1'),
    catch: (cause) => {
      if (cause instanceof BuildContrlError) {
        return new ContrlNotBuilt({ code: cause.code })
      }

      throw cause
    },
  })

// The destination of the Trading Partner's outbound EDIFACT Flows is where it takes Interchanges.
const channelOf = (workspaceId: string, tradingPartnerId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const found = yield* Effect.promise(() =>
      db
        .selectDistinct({ messageType: flows.messageType, channelId: flows.destinationChannelId })
        .from(flows)
        .where(
          and(eq(flows.workspaceId, workspaceId), eq(flows.tradingPartnerId, tradingPartnerId)),
        ),
    )

    const channelIds = [
      ...new Set(
        found.flatMap(({ messageType, channelId }) =>
          directionOf({ messageType }) === 'outbound' ? [channelId] : [],
        ),
      ),
    ]

    const [channelId] = channelIds

    if (channelId === undefined) {
      return { channelId: null, notSentReason: 'noOutboundChannel' as const }
    }

    return channelIds.length > 1
      ? { channelId: null, notSentReason: 'ambiguousChannel' as const }
      : { channelId, notSentReason: null }
  })

// A Document without a readable UNB is no Interchange, and a CONTRL is never answered.
const answerOf = (workspaceId: string, documentId: string, content: string) =>
  Effect.gen(function* () {
    const built = yield* Effect.result(builtContrl(content))

    if (Result.isFailure(built) && built.failure.code === 'unreadable-interchange-header') {
      return undefined
    }

    const { header, messages } = readInterchange(content)
    const messageTypes = messages.map(({ message }) => message.header.elements[1]?.[0])

    if (messageTypes.length > 0 && messageTypes.every((messageType) => messageType === 'CONTRL')) {
      return undefined
    }

    const sender = header?.elements[1]?.[0] ?? ''
    const db = yield* Database

    const [found] = yield* Effect.promise(() =>
      db
        .select({
          tradingPartnerId: tradingPartners.id,
          testMode: tradingPartners.testMode,
          workspaceGln: workspaces.gln,
        })
        .from(tradingPartners)
        .innerJoin(workspaces, eq(workspaces.id, tradingPartners.workspaceId))
        .where(and(eq(tradingPartners.workspaceId, workspaceId), eq(tradingPartners.gln, sender))),
    )

    if (found === undefined) {
      yield* Effect.logWarning(
        `The Interchange of Document ${documentId} gets no CONTRL: no Trading Partner has the GLN ${sender} of its sender`,
      )

      return undefined
    }

    const { tradingPartnerId, testMode, workspaceGln } = found
    const { channelId, notSentReason } = yield* channelOf(workspaceId, tradingPartnerId)
    const message = Result.isSuccess(built) ? built.success : null

    return {
      tradingPartnerId,
      channelId,
      notSentReason:
        message === null
          ? 'unechoableInterchangeHeader'
          : workspaceGln === null
            ? 'workspaceGlnMissing'
            : notSentReason,
      contrl:
        message === null || workspaceGln === null
          ? null
          : {
              message,
              sender: workspaceGln,
              receiver: sender,
              // The CONTRL to a test Interchange is a test too, whatever the partner's Test Mode.
              testIndicator: testMode || carriesTestIndicator(header),
            },
    } satisfies Answer
  })

const recordAnswer = (
  { workspaceId, documentId }: { workspaceId: string; documentId: string },
  { tradingPartnerId, channelId, notSentReason, contrl }: Answer,
  sentAt: DateTime.Utc,
) =>
  Effect.gen(function* () {
    const db = yield* Database

    yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const sent =
          contrl === null
            ? null
            : {
                ...contrl,
                reference: await claimTradingPartnerControlReference(tx, tradingPartnerId),
              }

        await tx.insert(acknowledgements).values({
          workspaceId,
          documentId,
          tradingPartnerId,
          channelId,
          notSentReason,
          controlReference: sent?.reference ?? null,
          content:
            sent === null
              ? null
              : enveloped(sent.message, {
                  characterSet: 'UNOC',
                  sender: sent.sender,
                  receiver: sent.receiver,
                  sentAt,
                  reference: sent.reference,
                  testIndicator: sent.testIndicator,
                }),
        })
      }),
    )
  })

const warnNotSent = (documentId: string, { notSentReason }: Answer) =>
  notSentReason === null
    ? Effect.void
    : Effect.logWarning(
        `The CONTRL for Document ${documentId} is not sent: ${notSentMessages[notSentReason]}`,
      )

// The receipt does not depend on the CONTRL, so a defect in it leaves the Document unanswered.
export const answerDocument = (
  stored: { workspaceId: string; documentId: string; content: string },
  answeredAt: DateTime.Utc,
) =>
  Effect.gen(function* () {
    const answer = yield* answerOf(stored.workspaceId, stored.documentId, stored.content)

    if (answer === undefined) {
      return
    }

    yield* recordAnswer(stored, answer, answeredAt)
    yield* warnNotSent(stored.documentId, answer)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError(`The CONTRL for Document ${stored.documentId} was not recorded`, cause),
    ),
  )

const isDue = (cutoff: Date) =>
  and(
    isNull(acknowledgements.handedOverAt),
    isNull(acknowledgements.notSentReason),
    or(
      isNull(acknowledgements.deliveryAttemptedAt),
      lt(acknowledgements.deliveryAttemptedAt, cutoff),
    ),
  )

// The claim marks the attempt, so two workers never send one CONTRL at once.
const claimAttempt = (id: string, cutoff: Date) =>
  Effect.gen(function* () {
    const db = yield* Database
    const attemptedAt = yield* DateTime.nowAsDate

    return yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const [due] = await tx
          .select({
            previousAttempt: acknowledgements.deliveryAttemptedAt,
            controlReference: acknowledgements.controlReference,
            content: acknowledgements.content,
            channel: channels,
          })
          .from(acknowledgements)
          .innerJoin(channels, eq(channels.id, acknowledgements.channelId))
          .where(and(eq(acknowledgements.id, id), isDue(cutoff)))
          .for('update', { of: acknowledgements })

        if (due === undefined) {
          return undefined
        }

        await tx
          .update(acknowledgements)
          .set({ deliveryAttemptedAt: attemptedAt })
          .where(eq(acknowledgements.id, id))

        return { ...due, attemptedAt }
      }),
    )
  })

const sendAcknowledgement = (id: string, cutoff: Date) =>
  Effect.gen(function* () {
    const claimed = yield* claimAttempt(id, cutoff)

    if (claimed === undefined) {
      return
    }

    const { previousAttempt, attemptedAt, controlReference, content, channel } = claimed

    if (content === null || controlReference === null) {
      return yield* Effect.die(new Error(`Acknowledgement ${id} has no CONTRL to send`))
    }

    const delivery = yield* Delivery
    const db = yield* Database

    // An attempt cut off before it was recorded may have landed, so the Channel checks for it.
    const deliveryError = yield* delivery(channel, {
      name: `CONTRL-${String(controlReference)}.edi`,
      content: Buffer.from(content, 'latin1'),
      mediaType: 'application/edifact',
      isRetry: previousAttempt !== null,
    }).pipe(
      Effect.map(() => null),
      Effect.catchTag('DeliveryFailed', ({ reason }) => Effect.succeed(reason)),
      Effect.catchDefect(() => Effect.succeed('defect')),
    )

    const handedOverAt = deliveryError === null ? yield* DateTime.nowAsDate : null

    // A later attempt claimed the CONTRL after this one outlasted the bound, so it records the outcome.
    yield* Effect.promise(() =>
      db
        .update(acknowledgements)
        .set({ handedOverAt, deliveryError })
        .where(
          and(eq(acknowledgements.id, id), eq(acknowledgements.deliveryAttemptedAt, attemptedAt)),
        ),
    )

    if (deliveryError !== null) {
      yield* Effect.logWarning(`The CONTRL ${id} was not sent, tried again later: ${deliveryError}`)
    }
  })

export const sendAcknowledgements = (retryAfter: Duration.Input) =>
  Effect.gen(function* () {
    const db = yield* Database
    const cutoff = DateTime.toDateUtc(DateTime.subtractDuration(yield* DateTime.now, retryAfter))

    const due = yield* Effect.promise(() =>
      db.select({ id: acknowledgements.id }).from(acknowledgements).where(isDue(cutoff)),
    )

    yield* Effect.forEach(
      due,
      ({ id }) =>
        sendAcknowledgement(id, cutoff).pipe(
          Effect.catchCause((cause) => Effect.logError(`The CONTRL ${id} was not sent`, cause)),
        ),
      { concurrency: 4, discard: true },
    )
  })
