import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm'
import { DateTime, type Duration, Effect } from 'effect'

import { directionOf } from '@edi-bridge/contracts'
import {
  acknowledgements,
  channels,
  claimTradingPartnerControlReference,
  type Connection,
  flows,
  tradingPartners,
  workspaces,
} from '@edi-bridge/db'
import {
  buildContrl,
  BuildContrlError,
  type BuildContrlErrorCode,
  type Message,
} from '@edi-bridge/edifact'

import { enveloped } from './envelope'
import { Database, Delivery } from './services'

type Transaction = Parameters<Parameters<Connection['db']['transaction']>[0]>[0]

type NotSentReason = NonNullable<(typeof acknowledgements.$inferSelect)['notSentReason']>

type AnsweredFlow = {
  messageType: (typeof flows.$inferSelect)['messageType']
  tradingPartnerId: string
}

export type Answer = {
  tradingPartnerId: string
  channelId: string | null
  notSentReason: NotSentReason | null
  contrl: { message: Message; sender: string; receiver: string } | null
}

const buildErrorReasons = {
  'unreadable-interchange-header': 'unreadableInterchangeHeader',
  'unechoable-interchange-header': 'unechoableInterchangeHeader',
} as const satisfies Record<BuildContrlErrorCode, NotSentReason>

const notSentMessages: Record<NotSentReason, string> = {
  noOutboundChannel: 'no outbound EDIFACT Flow of its Trading Partner names a Channel',
  ambiguousChannel: 'the outbound EDIFACT Flows of its Trading Partner name different Channels',
  workspaceGlnMissing: 'the Workspace has no GLN',
  tradingPartnerGlnMissing: 'its Trading Partner has no GLN',
  unreadableInterchangeHeader: 'its UNB cannot be read',
  unechoableInterchangeHeader: 'its UNB cannot be echoed in a valid CONTRL',
}

const builtContrl = (content: string) => {
  try {
    return { message: buildContrl(content, '1'), notSentReason: null }
  } catch (error) {
    if (error instanceof BuildContrlError) {
      return { message: null, notSentReason: buildErrorReasons[error.code] }
    }

    throw error
  }
}

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

// The Trading Partner of the Interchange is the one of its Runs' Flows, by its sender when several.
const tradingPartnerOf = (sender: string | undefined, answered: readonly AnsweredFlow[]) =>
  Effect.gen(function* () {
    const db = yield* Database
    const ids = [...new Set(answered.map(({ tradingPartnerId }) => tradingPartnerId))]

    const partners = yield* Effect.promise(() =>
      db
        .select({ id: tradingPartners.id, gln: tradingPartners.gln })
        .from(tradingPartners)
        .where(inArray(tradingPartners.id, ids)),
    )

    return partners.length === 1 ? partners[0] : partners.find(({ gln }) => gln === sender)
  })

// A Document without inbound Runs is no Interchange, and a CONTRL is never answered.
export const answerOf = (
  workspaceId: string,
  content: string,
  declared: { sender: string | undefined; messageTypes: readonly string[] },
  routed: readonly AnsweredFlow[],
) =>
  Effect.gen(function* () {
    const inbound = routed.filter((flow) => directionOf(flow) === 'inbound')

    if (
      inbound.length === 0 ||
      declared.messageTypes.every((messageType) => messageType === 'CONTRL')
    ) {
      return undefined
    }

    const tradingPartner = yield* tradingPartnerOf(declared.sender, inbound)

    if (tradingPartner === undefined) {
      yield* Effect.logWarning(
        'A received Interchange gets no CONTRL: its Runs belong to several Trading Partners, none its sender',
      )

      return undefined
    }

    const db = yield* Database

    const [workspace] = yield* Effect.promise(() =>
      db.select({ gln: workspaces.gln }).from(workspaces).where(eq(workspaces.id, workspaceId)),
    )

    const { channelId, notSentReason: channelReason } = yield* channelOf(
      workspaceId,
      tradingPartner.id,
    )

    const built = builtContrl(content)
    const sender = workspace?.gln ?? null
    const receiver = tradingPartner.gln

    const glnReason =
      sender === null
        ? ('workspaceGlnMissing' as const)
        : receiver === null
          ? ('tradingPartnerGlnMissing' as const)
          : null

    return {
      tradingPartnerId: tradingPartner.id,
      channelId,
      notSentReason: built.notSentReason ?? glnReason ?? channelReason,
      contrl:
        built.message === null || sender === null || receiver === null
          ? null
          : { message: built.message, sender, receiver },
    } satisfies Answer
  })

// The CONTRL is recorded with the Runs, so a worker sends it even after a restart.
export const recordAnswer = async (
  tx: Transaction,
  { workspaceId, documentId }: { workspaceId: string; documentId: string },
  { tradingPartnerId, channelId, notSentReason, contrl }: Answer,
  sentAt: DateTime.Utc,
) => {
  const controlReference =
    contrl === null ? null : await claimTradingPartnerControlReference(tx, tradingPartnerId)

  await tx.insert(acknowledgements).values({
    workspaceId,
    documentId,
    tradingPartnerId,
    channelId,
    notSentReason,
    controlReference,
    content:
      contrl === null || controlReference === null
        ? null
        : enveloped(contrl.message, {
            characterSet: 'UNOC',
            sender: contrl.sender,
            receiver: contrl.receiver,
            sentAt,
            reference: controlReference,
          }),
  })
}

export const warnNotSent = (documentId: string, { notSentReason }: Answer) =>
  notSentReason === null
    ? Effect.void
    : Effect.logWarning(
        `The CONTRL for Document ${documentId} is not sent: ${notSentMessages[notSentReason]}`,
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

        return due
      }),
    )
  })

const sendAcknowledgement = (id: string, cutoff: Date) =>
  Effect.gen(function* () {
    const claimed = yield* claimAttempt(id, cutoff)

    if (claimed === undefined) {
      return
    }

    const { previousAttempt, controlReference, content, channel } = claimed

    if (content === null || controlReference === null) {
      return yield* Effect.die(new Error(`Acknowledgement ${id} has no CONTRL to send`))
    }

    const delivery = yield* Delivery
    const db = yield* Database

    // An attempt cut off before it was recorded may have landed, so the Channel checks for it.
    const sent = yield* delivery(channel, {
      name: `CONTRL-${String(controlReference)}.edi`,
      content: Buffer.from(content, 'latin1'),
      mediaType: 'application/edifact',
      isRetry: previousAttempt !== null,
    }).pipe(
      Effect.map(() => null),
      Effect.catchTag('DeliveryFailed', ({ reason }) => Effect.succeed(reason)),
      Effect.catchDefect(() => Effect.succeed('defect')),
    )

    const handedOverAt = sent === null ? yield* DateTime.nowAsDate : null

    yield* Effect.promise(() =>
      db
        .update(acknowledgements)
        .set({ handedOverAt, deliveryError: sent })
        .where(eq(acknowledgements.id, id)),
    )

    if (sent !== null) {
      yield* Effect.logWarning(`The CONTRL ${id} was not sent, tried again later: ${sent}`)
    }
  })

// A CONTRL whose attempt failed or was cut off is tried again once the bound passed.
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
