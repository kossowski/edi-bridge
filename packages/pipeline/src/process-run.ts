import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import { Data, DateTime, Effect, Match, Predicate, Result } from 'effect'

import {
  type ChannelTestFailureReason,
  type CharacterSet,
  directionOf,
  type DocumentStructure,
  documentStructureSchema,
  type FailureStage,
  type LookupTableEntry,
  type MappingGraph,
  type MessageType,
  type ProblemReason,
  type RunError,
  type RunProblem,
  type RunStepStage,
} from '@edi-bridge/contracts'
import {
  channels,
  claimControlReference,
  documentStructures,
  flows,
  lookupTableEntries,
  lookupTables,
  mappings,
  mappingVersions,
  runs,
  runSteps,
  tradingPartners,
  workspaces,
} from '@edi-bridge/db'
import {
  type Interchange,
  type Message,
  type Segment,
  serialize,
  serializeMessage,
  validate,
  ValidationError,
} from '@edi-bridge/edifact'
import {
  applyMappingVersion,
  type DocumentReadError,
  type MappingError,
  type MappingErrorCode,
  readDocument,
} from '@edi-bridge/mapping'

import type { DeliveryFailed } from '@edi-bridge/channels'

import { parse } from './parse'
import { Database, Delivery, Documents, type QueuedRun } from './services'

type Transaction = Parameters<Parameters<Database['Service']['transaction']>[0]>[0]

export class MessageInvalid extends Data.TaggedError('MessageInvalid')<{
  readonly cause: ValidationError
}> {}

export class GlnMissing extends Data.TaggedError('GlnMissing')<{
  readonly party: 'workspace' | 'tradingPartner'
}> {}

export class CharacterSetUnsupported extends Data.TaggedError('CharacterSetUnsupported')<{
  readonly characterSet: CharacterSet
}> {}

export class DeliveryDefect extends Data.TaggedError('DeliveryDefect')<{
  readonly defect: unknown
}> {}

type Failure = {
  stage: FailureStage
  error: RunError
  problem: Omit<RunProblem, 'whoFixes'>
}

type Pinned = {
  mappingId: string
  mappingName: string
  graph: MappingGraph
  messageType: MessageType
  structure: DocumentStructure
}

const mappingReasons: Record<MappingErrorCode, ProblemReason> = {
  missingRequiredValue: 'missingField',
  outsideLoop: 'invalidContent',
  unknownSource: 'missingField',
  unknownTarget: 'invalidContent',
  invalidTransform: 'invalidContent',
  invalidDate: 'invalidContent',
  invalidNumber: 'invalidContent',
  unknownLookupTable: 'missingCode',
  noLookupMatch: 'missingCode',
  expressionFailed: 'invalidContent',
}

const mappingFailure = (pinned: Pinned, error: MappingError | DocumentReadError): Failure =>
  Predicate.isTagged(error, 'DocumentReadError')
    ? {
        stage: 'mapping',
        error: {
          code: error.code,
          message: `The Document is unreadable: ${error.code}`,
          position: null,
        },
        problem: { reason: 'unreadable', fixTarget: null },
      }
    : {
        stage: 'mapping',
        error: {
          code: error.code,
          message: `${error.code} at ${error.targetPath}`,
          position: null,
        },
        problem: {
          reason: mappingReasons[error.code],
          fixTarget: {
            kind: 'mapping',
            mappingId: pinned.mappingId,
            name: pinned.mappingName,
            fieldPath: error.targetPath,
          },
        },
      }

// Validation runs on the Message alone, so a position counts from its UNH as segment 1.
const validationFailure = (message: Message, { cause }: MessageInvalid): Failure => {
  const segments = [message.header, ...message.segments, message.trailer]
  const segment = cause.position.segment - 1

  return {
    stage: 'validation',
    error: {
      code: cause.code,
      message: cause.message,
      position: {
        segment,
        tag: segments[segment - 1]?.tag ?? message.header.tag,
        element: cause.position.element ?? null,
        component: cause.position.component ?? null,
      },
    },
    problem: { reason: 'invalidContent', fixTarget: null },
  }
}

const deliveryReasons: Record<ChannelTestFailureReason, string> = {
  loginRejected: 'The SFTP server rejected the login',
  hostUnreachable: 'The host of the Channel is unreachable',
  timedOut: 'The Channel did not answer in time',
  remotePathMissing: 'The remote path of the Channel does not exist',
  permissionDenied: 'The Channel refused to take the file',
  unexpectedResponse: 'The Channel answered unexpectedly',
}

const glnOwners = { workspace: 'The Workspace', tradingPartner: 'The Trading Partner' } as const

type DeliveryError = DeliveryFailed | GlnMissing | CharacterSetUnsupported | DeliveryDefect

const deliveryFailure = (
  failure: DeliveryError,
  { workspace, tradingPartner, channel }: Destination,
): Failure =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      DeliveryFailed: ({ reason }): Failure => ({
        stage: 'delivery',
        error: { code: reason, message: deliveryReasons[reason], position: null },
        problem: { reason: 'unreachable', fixTarget: null },
      }),
      GlnMissing: ({ party }): Failure => ({
        stage: 'delivery',
        error: {
          code: 'glnMissing',
          message: `${glnOwners[party]} has no GLN for the Interchange`,
          position: null,
        },
        problem: {
          reason: 'incompleteSetup',
          fixTarget:
            party === 'workspace'
              ? { kind: 'workspaceGln', name: workspace.name }
              : {
                  kind: 'tradingPartnerGln',
                  tradingPartnerId: tradingPartner.id,
                  name: tradingPartner.name,
                },
        },
      }),
      CharacterSetUnsupported: ({ characterSet }): Failure => ({
        stage: 'delivery',
        error: {
          code: 'characterSetUnsupported',
          message: `Delivery in character set ${characterSet} is not supported`,
          position: null,
        },
        problem: {
          reason: 'incompleteSetup',
          fixTarget: {
            kind: 'tradingPartner',
            tradingPartnerId: tradingPartner.id,
            name: tradingPartner.name,
          },
        },
      }),
      // A broken Channel row and a credential that does not open both end here.
      DeliveryDefect: (): Failure => ({
        stage: 'delivery',
        error: {
          code: 'deliveryDefect',
          message: 'The delivery stopped on an unexpected error',
          position: null,
        },
        problem: {
          reason: 'incompleteSetup',
          fixTarget: { kind: 'channelCredential', channelId: channel.id, name: channel.name },
        },
      }),
    }),
  )

const envelopeTrailer: Segment = { tag: 'UNZ', elements: [] }

const framed = (message: Message, header: Segment, trailer = envelopeTrailer): Interchange => ({
  hasServiceStringAdvice: false,
  delimiters: {
    component: ':',
    element: '+',
    decimal: '.',
    release: '?',
    repetition: ' ',
    segment: "'",
  },
  header,
  messages: [message],
  trailer,
})

const twoDigits = (value: number) => String(value).padStart(2, '0')

type Envelope = {
  characterSet: CharacterSet
  sender: string
  receiver: string
  sentAt: DateTime.Utc
  reference: number
}

const enveloped = (
  message: Message,
  { characterSet, sender, receiver, sentAt, reference }: Envelope,
) => {
  const { year, month, day, hour, minute } = DateTime.toPartsUtc(sentAt)

  return serialize({
    ...framed(
      message,
      {
        tag: 'UNB',
        elements: [
          [characterSet, '3'],
          [sender, '14'],
          [receiver, '14'],
          [
            twoDigits(year % 100) + twoDigits(month) + twoDigits(day),
            twoDigits(hour) + twoDigits(minute),
          ],
          [String(reference)],
        ],
      },
      { tag: 'UNZ', elements: [['1'], [String(reference)]] },
    ),
    // The default separators of UNOB are IS1 to IS4, so a UNA declares the printable ones.
    hasServiceStringAdvice: characterSet === 'UNOB',
  })
}

// UNOA to UNOC are ISO 8859-1 or a subset of it; Node has no encoder for UNOD to UNOF.
const encoded = (interchange: string, characterSet: CharacterSet) =>
  characterSet === 'UNOA' || characterSet === 'UNOB' || characterSet === 'UNOC'
    ? Effect.succeed(Buffer.from(interchange, 'latin1'))
    : Effect.fail(new CharacterSetUnsupported({ characterSet }))

const validated = (message: Message, characterSet: CharacterSet) =>
  Effect.try({
    try: () => validate(framed(message, { tag: 'UNB', elements: [[characterSet]] })),
    catch: (cause) => {
      if (cause instanceof ValidationError) {
        return new MessageInvalid({ cause })
      }

      throw cause
    },
  })

const loadDestination = ({ workspaceId, runId }: QueuedRun) =>
  Effect.gen(function* () {
    const db = yield* Database

    const [found] = yield* Effect.promise(() =>
      db
        .select({
          workspace: { name: workspaces.name, gln: workspaces.gln },
          tradingPartner: {
            id: tradingPartners.id,
            name: tradingPartners.name,
            gln: tradingPartners.gln,
            characterSet: tradingPartners.characterSet,
          },
          channel: channels,
        })
        .from(runs)
        .innerJoin(workspaces, eq(workspaces.id, runs.workspaceId))
        .innerJoin(tradingPartners, eq(tradingPartners.id, runs.tradingPartnerId))
        .innerJoin(flows, eq(flows.id, runs.flowId))
        .innerJoin(channels, eq(channels.id, flows.destinationChannelId))
        .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId))),
    )

    if (found === undefined) {
      return yield* Effect.die(new Error(`Run ${runId} has no destination Channel`))
    }

    return found
  })

type Destination = Effect.Success<ReturnType<typeof loadDestination>>

const deliver = (
  queued: QueuedRun,
  message: Message,
  messageType: MessageType,
  { workspace, tradingPartner, channel }: Destination,
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { characterSet } = tradingPartner

    if (workspace.gln === null) {
      return yield* new GlnMissing({ party: 'workspace' })
    }

    if (tradingPartner.gln === null) {
      return yield* new GlnMissing({ party: 'tradingPartner' })
    }

    const reference = yield* Effect.promise(() => claimControlReference(db, queued))

    const interchange = enveloped(message, {
      characterSet,
      sender: workspace.gln,
      receiver: tradingPartner.gln,
      sentAt: yield* DateTime.now,
      reference,
    })

    yield* Effect.promise(() =>
      db.update(runs).set({ output: interchange }).where(eq(runs.id, queued.runId)),
    )

    const content = yield* encoded(interchange, characterSet)
    const delivery = yield* Delivery

    // The file name carries the control reference, as an upload never replaces an existing file.
    yield* delivery(channel, { name: `${messageType}-${String(reference)}.edi`, content })
  }).pipe(Effect.catchDefect((defect) => Effect.fail(new DeliveryDefect({ defect }))))

const orderNumberOf = ({ segments }: Message) =>
  segments.find(({ tag, elements }) => tag === 'RFF' && elements[0]?.[0] === 'ON')
    ?.elements[0]?.[1] ?? null

const loadPinned = (workspaceId: string, mappingVersionId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const [row] = yield* Effect.promise(() =>
      db
        .select({ version: mappingVersions, mapping: mappings, structure: documentStructures })
        .from(mappingVersions)
        .innerJoin(mappings, eq(mappings.id, mappingVersions.mappingId))
        .innerJoin(documentStructures, eq(documentStructures.id, mappings.documentStructureId))
        .where(
          and(eq(mappings.workspaceId, workspaceId), eq(mappingVersions.id, mappingVersionId)),
        ),
    )

    if (row === undefined) {
      return yield* Effect.die(new Error(`Mapping Version ${mappingVersionId} does not exist`))
    }

    const { version, mapping, structure } = row

    if (directionOf(mapping) !== 'outbound') {
      return yield* Effect.die(new Error(`Mapping ${mapping.id} is not outbound`))
    }

    // A stored Document Structure that breaks its schema is a defect, not a failure of the Run.
    const parsed = yield* Effect.orDie(
      parse(documentStructureSchema, {
        id: structure.id,
        name: structure.name,
        format: structure.format,
        ...(structure.format === 'json' ? { root: structure.jsonRoot } : { csv: structure.csv }),
        sample: null,
        children: structure.children,
      }),
    )

    return {
      mappingId: mapping.id,
      mappingName: mapping.name,
      graph: version.graph,
      messageType: mapping.messageType,
      structure: parsed,
    } satisfies Pinned
  })

const loadLookupTables = (workspaceId: string, { transforms }: MappingGraph) =>
  Effect.gen(function* () {
    const ids = [
      ...new Set(
        transforms.flatMap((transform) =>
          transform.kind === 'lookupTable' && transform.config.lookupTableId !== null
            ? [transform.config.lookupTableId]
            : [],
        ),
      ),
    ]

    if (ids.length === 0) {
      return new Map<string, LookupTableEntry[]>()
    }

    const db = yield* Database

    const rows = yield* Effect.promise(() =>
      db
        .select({
          lookupTableId: lookupTables.id,
          sourceCode: lookupTableEntries.sourceCode,
          targetCode: lookupTableEntries.targetCode,
        })
        .from(lookupTables)
        .innerJoin(lookupTableEntries, eq(lookupTableEntries.lookupTableId, lookupTables.id))
        .where(and(eq(lookupTables.workspaceId, workspaceId), inArray(lookupTables.id, ids)))
        .orderBy(asc(lookupTableEntries.position)),
    )

    return new Map(
      ids.map((id) => [
        id,
        rows
          .filter(({ lookupTableId }) => lookupTableId === id)
          .map(({ sourceCode, targetCode }) => ({ sourceCode, targetCode })),
      ]),
    )
  })

const updateStep = (
  runId: string,
  stage: RunStepStage,
  values: Partial<typeof runSteps.$inferInsert>,
) =>
  Effect.flatMap(Database, (db) =>
    Effect.promise(() =>
      db
        .update(runSteps)
        .set(values)
        .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, stage))),
    ),
  )

const step = <A, E, R>(
  runId: string,
  stage: RunStepStage,
  effect: Effect.Effect<A, E, R>,
  succeeded: (tx: Transaction) => Promise<void> = () => Promise.resolve(),
) =>
  Effect.gen(function* () {
    yield* updateStep(runId, stage, { status: 'running', startedAt: yield* DateTime.nowAsDate })

    const result = yield* Effect.result(effect)
    const db = yield* Database
    const finishedAt = yield* DateTime.nowAsDate

    yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        await tx
          .update(runSteps)
          .set({ status: Result.isSuccess(result) ? 'succeeded' : 'failed', finishedAt })
          .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, stage)))

        if (Result.isSuccess(result)) {
          await succeeded(tx)
        }
      }),
    )

    return result
  })

const fail = (runId: string, failure: Failure) =>
  Effect.gen(function* () {
    const db = yield* Database

    yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const [failed] = await tx
          .select({ position: runSteps.position })
          .from(runSteps)
          .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, failure.stage)))

        await tx
          .update(runSteps)
          .set({ status: 'skipped' })
          .where(and(eq(runSteps.runId, runId), gt(runSteps.position, failed?.position ?? 0)))

        await tx
          .update(runs)
          .set({
            status: 'failed',
            failureStage: failure.stage,
            error: failure.error,
            problem: failure.problem,
          })
          .where(eq(runs.id, runId))
      }),
    )
  })

// Claims a received Run, so a Run handed out twice is processed once.
const claim = ({ workspaceId, runId }: QueuedRun) =>
  Effect.gen(function* () {
    const db = yield* Database

    const [found] = yield* Effect.promise(() =>
      db
        .select({ run: runs, flow: flows })
        .from(runs)
        .innerJoin(flows, eq(flows.id, runs.flowId))
        .where(
          and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId), eq(runs.status, 'received')),
        ),
    )

    if (found === undefined || directionOf(found.flow) !== 'outbound') {
      return undefined
    }

    const [claimed] = yield* Effect.promise(() =>
      db
        .update(runs)
        .set({ status: 'processing', mappingVersionId: found.flow.mappingVersionId })
        .where(and(eq(runs.id, runId), eq(runs.status, 'received')))
        .returning(),
    )

    return claimed
  })

export const processRun = (queued: QueuedRun) =>
  Effect.gen(function* () {
    const run = yield* claim(queued)

    if (run === undefined || run.mappingVersionId === null) {
      return
    }

    const documents = yield* Documents
    const document = yield* Effect.promise(() => documents.read(queued.workspaceId, run.documentId))

    if (document === undefined) {
      return yield* Effect.die(new Error(`Document ${run.documentId} of Run ${run.id} is missing`))
    }

    const pinned = yield* loadPinned(queued.workspaceId, run.mappingVersionId)
    const lookupTables = yield* loadLookupTables(queued.workspaceId, pinned.graph)

    const mapped = yield* step(
      run.id,
      'mapping',
      readDocument(pinned.structure, document.content).pipe(
        Effect.flatMap((content) =>
          applyMappingVersion(
            { ...pinned.graph, target: { kind: 'messageType', messageType: pinned.messageType } },
            content,
            { lookupTables },
          ),
        ),
      ),
    )

    if (Result.isFailure(mapped)) {
      return yield* fail(run.id, mappingFailure(pinned, mapped.failure))
    }

    const message = mapped.success
    const destination = yield* loadDestination(queued)
    const checked = yield* step(
      run.id,
      'validation',
      validated(message, destination.tradingPartner.characterSet),
    )

    if (Result.isFailure(checked)) {
      return yield* fail(run.id, validationFailure(message, checked.failure))
    }

    const db = yield* Database

    // HTTP delivery comes with its own ticket; until then such a Run waits at delivery.
    if (destination.channel.type !== 'sftp') {
      yield* Effect.promise(() =>
        db
          .update(runs)
          .set({ output: serializeMessage(message), businessReference: orderNumberOf(message) })
          .where(eq(runs.id, run.id)),
      )

      return
    }

    yield* Effect.promise(() =>
      db
        .update(runs)
        .set({ businessReference: orderNumberOf(message) })
        .where(eq(runs.id, run.id)),
    )

    const delivered = yield* step(
      run.id,
      'delivery',
      deliver(queued, message, pinned.messageType, destination),
      async (tx) => {
        await tx.update(runs).set({ status: 'delivered' }).where(eq(runs.id, run.id))
      },
    )

    if (Result.isFailure(delivered)) {
      yield* fail(run.id, deliveryFailure(delivered.failure, destination))

      if (Predicate.isTagged(delivered.failure, 'DeliveryDefect')) {
        return yield* Effect.die(delivered.failure.defect)
      }
    }
  })
