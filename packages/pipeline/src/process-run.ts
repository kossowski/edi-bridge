import { and, asc, desc, eq, exists, gt, inArray, lt, notExists } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { Data, DateTime, Effect, Match, Predicate, Result } from 'effect'
import { z } from 'zod'

import {
  type ChannelTestFailureReason,
  type CharacterSet,
  type Direction,
  directionOf,
  type DocumentStructure,
  documentStructureSchema,
  encodeText,
  type FailureStage,
  failureStageSchema,
  type FixTarget,
  type LookupTableEntry,
  type MappingGraph,
  type MessageType,
  type ProblemReason,
  type RunError,
  type RunProblem,
  type RunStepStage,
  segmentTagSchema,
  whoFixes,
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
  isBrokenMessage,
  type Message,
  type ParsedInterchange,
  parseMessages,
  type Position,
  type Segment,
  serialize,
  validate,
  ValidationError,
} from '@edi-bridge/edifact'
import {
  applyInboundMappingVersion,
  type DocumentReadError,
  type DocumentWriteError,
  type MappingError,
  type MappingErrorCode,
  type MappedMessage,
  mapMessage,
  readDocument,
  writeDocument,
} from '@edi-bridge/mapping'

import type { DeliveryFailed, OutboundDocument } from '@edi-bridge/channels'
import type { ParseError } from '@edi-bridge/edifact'

import { parse } from './parse'
import { Database, Delivery, Documents, type QueuedRun } from './services'

type Transaction = Parameters<Parameters<Database['Service']['transaction']>[0]>[0]

// The sweep took the Run from a stalled worker, so another worker or a Retry owns it now.
export class RunNotOwned extends Data.TaggedError('RunNotOwned')<{
  readonly runId: string
}> {}

export class MessageInvalid extends Data.TaggedError('MessageInvalid')<{
  readonly cause: ValidationError
}> {}

export class MessageUnreadable extends Data.TaggedError('MessageUnreadable')<{
  readonly cause: ParseError
  readonly interchange: ParsedInterchange
}> {}

export class GlnMissing extends Data.TaggedError('GlnMissing')<{
  readonly party: 'workspace' | 'tradingPartner'
}> {}

export class CharacterSetUnsupported extends Data.TaggedError('CharacterSetUnsupported')<{
  readonly characterSet: CharacterSet
}> {}

// The Delivery adapter died: a broken Channel row or a credential that does not open.
export class ChannelDefect extends Data.TaggedError('ChannelDefect')<{
  readonly defect: unknown
}> {}

// Any other defect in the delivery step, such as a database error.
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
  unknownLookupTable: 'incompleteSetup',
  noLookupMatch: 'missingCode',
  expressionFailed: 'invalidContent',
}

type LoadedLookupTable = { id: string; name: string; entries: LookupTableEntry[] }

type LoadedLookupTables = ReadonlyMap<string, LoadedLookupTable>

const entriesOf = (loaded: LoadedLookupTables) =>
  new Map([...loaded].map(([id, { entries }]) => [id, entries]))

const mappingTarget = ({ mappingId, mappingName }: Pinned, fieldPath: string): FixTarget => ({
  kind: 'mapping',
  mappingId,
  name: mappingName,
  fieldPath,
})

const mappingFixTarget = (
  pinned: Pinned,
  loaded: LoadedLookupTables,
  { targetPath, lookup }: MappingError,
): FixTarget => {
  const table = lookup?.lookupTableId ? loaded.get(lookup.lookupTableId) : undefined

  // A Lookup Table that is not chosen or no longer exists is fixed in the Mapping.
  return table && lookup?.code
    ? { kind: 'lookupTable', lookupTableId: table.id, name: table.name, code: lookup.code }
    : mappingTarget(pinned, targetPath)
}

const mappingFailure = (
  pinned: Pinned,
  loaded: LoadedLookupTables,
  error: MappingError | DocumentReadError | DocumentWriteError,
): Failure =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      DocumentReadError: ({ code }): Failure => ({
        stage: 'mapping',
        error: {
          code,
          message: `The Document is unreadable: ${code}`,
          position: null,
          details: null,
        },
        // An unreadable Document names no field, and no fix target kind is a Document Structure.
        problem: { reason: 'unreadable', fixTarget: null },
      }),
      DocumentWriteError: ({ code, line, fieldPath }): Failure => ({
        stage: 'mapping',
        error: {
          code,
          message: `Line ${String(line)} of the Document cannot be written in its encoding`,
          position: null,
          details: null,
        },
        problem: {
          reason: 'invalidContent',
          // Only a CSV Document has an encoding that can fail, and its every cell has a field.
          fixTarget: fieldPath === null ? null : mappingTarget(pinned, fieldPath),
        },
      }),
      MappingError: (mappingError): Failure => ({
        stage: 'mapping',
        error: {
          code: mappingError.code,
          message: `${mappingError.code} at ${mappingError.targetPath}`,
          position: null,
          details: null,
        },
        problem: {
          reason: mappingReasons[mappingError.code],
          fixTarget: mappingFixTarget(pinned, loaded, mappingError),
        },
      }),
    }),
  )

// Validation runs on the Message alone, so a position counts from its UNH as segment 1.
const validationFailure = (
  pinned: Pinned,
  { message, targetPathAt }: MappedMessage,
  { cause }: MessageInvalid,
): Failure => {
  const segments = [message.header, ...message.segments, message.trailer]
  const segment = cause.position.segment - 1

  // The envelope around the Message is the engine's own, so a failure in it is in no Mapping.
  const fieldPath = targetPathAt({ ...cause.position, segment })

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
      details: null,
    },
    problem: {
      reason: 'invalidContent',
      fixTarget: fieldPath === undefined ? null : mappingTarget(pinned, fieldPath),
    },
  }
}

// The Run's Document is the whole Interchange, so a position counts its segments from the UNA or UNB.
const segmentTagsOf = (
  content: string,
  { delimiters, hasServiceStringAdvice }: ParsedInterchange,
) => {
  const tags = hasServiceStringAdvice ? ['UNA'] : []
  // A UNA declares a space as the release character when there is none.
  const hasRelease = delimiters.release !== ' '
  let start = hasServiceStringAdvice ? "UNA:+.? '".length : 0

  for (let index = start; index < content.length; index++) {
    if (hasRelease && content[index] === delimiters.release) {
      index++
    } else if (content[index] === delimiters.segment) {
      tags.push(content.slice(start, index).trim().slice(0, 3))
      start = index + 1
    }
  }

  return tags
}

const positionIn = (tags: readonly string[], position: Position): RunError['position'] => {
  const tag = segmentTagSchema.safeParse(tags[position.segment - 1])

  return tag.success
    ? {
        segment: position.segment,
        tag: tag.data,
        element: position.element ?? null,
        component: position.component ?? null,
      }
    : null
}

type TradingPartner = { id: string; name: string }

// The Trading Partner fixes an inbound Message that breaks at parse or validation by sending it again.
const resendTarget = ({ id, name }: TradingPartner): FixTarget => ({
  kind: 'tradingPartner',
  tradingPartnerId: id,
  name,
})

const parseFailure = (
  content: string,
  sender: TradingPartner,
  { cause, interchange }: MessageUnreadable,
): Failure => ({
  stage: 'parse',
  error: {
    code: cause.code,
    message: cause.message,
    position: positionIn(segmentTagsOf(content, interchange), cause.position),
    details: null,
  },
  problem: { reason: 'unreadable', fixTarget: resendTarget(sender) },
})

type ReadMessage = { interchange: ParsedInterchange; message: Message; messageIndex: number }

// Validation sees the Message alone in its Interchange, so its positions map back to the real ones.
const inboundValidationFailure = (
  content: string,
  sender: TradingPartner,
  { interchange, message, messageIndex }: ReadMessage,
  { cause }: MessageInvalid,
): Failure => {
  const tags = segmentTagsOf(content, interchange)
  const headers = tags.flatMap((tag, index) => (tag === 'UNH' ? [index + 1] : []))
  const validatedHeader = (interchange.hasServiceStringAdvice ? 1 : 0) + 2
  const validatedTrailer = validatedHeader + message.segments.length + 1
  const shift = (headers[messageIndex - 1] ?? validatedHeader) - validatedHeader
  const { segment } = cause.position

  const shifted =
    segment < validatedHeader
      ? segment
      : segment <= validatedTrailer
        ? segment + shift
        : tags.lastIndexOf('UNZ') + 1

  return {
    stage: 'validation',
    error: {
      code: cause.code,
      message: cause.message,
      position: positionIn(tags, {
        ...cause.position,
        segment: shifted,
      }),
      details: null,
    },
    problem: { reason: 'invalidContent', fixTarget: resendTarget(sender) },
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

type DeliveryError =
  | DeliveryFailed
  | GlnMissing
  | CharacterSetUnsupported
  | ChannelDefect
  | DeliveryDefect

const deliveryFailure = (
  failure: DeliveryError,
  { workspace, tradingPartner, channel }: Destination,
): Failure =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      DeliveryFailed: ({ reason, details }): Failure => ({
        stage: 'delivery',
        error: {
          code: reason,
          message: deliveryReasons[reason],
          position: null,
          details: details ?? null,
        },
        problem: {
          reason: 'unreachable',
          fixTarget: { kind: 'channel', channelId: channel.id, name: channel.name },
        },
      }),
      GlnMissing: ({ party }): Failure => ({
        stage: 'delivery',
        error: {
          code: 'glnMissing',
          message: `${glnOwners[party]} has no GLN for the Interchange`,
          position: null,
          details: null,
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
          details: null,
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
      ChannelDefect: (): Failure => ({
        stage: 'delivery',
        error: {
          code: 'channelDefect',
          message: 'The Channel could not be used for the delivery',
          position: null,
          details: null,
        },
        problem: {
          reason: 'incompleteSetup',
          fixTarget: { kind: 'channelCredential', channelId: channel.id, name: channel.name },
        },
      }),
      DeliveryDefect: (): Failure => ({
        stage: 'delivery',
        error: {
          code: 'deliveryDefect',
          message: 'The delivery stopped on an unexpected error',
          position: null,
          details: null,
        },
        problem: { reason: 'defect', fixTarget: null },
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

type ClaimedRun = typeof runs.$inferSelect

// A defect after the hand-over leaves the Run failed at delivery, and its Retry must not deliver again.
const handOver = (
  run: ClaimedRun,
  lease: StepLease,
  channel: Destination['channel'],
  document: OutboundDocument,
) =>
  Effect.gen(function* () {
    if (run.handedOverAt !== null) {
      return
    }

    yield* ensureOwned(lease)

    const delivery = yield* Delivery

    yield* delivery(channel, document).pipe(
      Effect.catchDefect((defect) => Effect.fail(new ChannelDefect({ defect }))),
    )

    const db = yield* Database
    const handedOverAt = yield* DateTime.nowAsDate

    // Recorded even when the sweep failed the Run meanwhile, so its Retry does not hand it over again.
    yield* Effect.promise(() => db.update(runs).set({ handedOverAt }).where(eq(runs.id, run.id)))
  })

const segmentSchema = z.object({ tag: z.string(), elements: z.array(z.array(z.string())) })

const messageSchema = z.object({
  header: segmentSchema,
  segments: z.array(segmentSchema),
  trailer: segmentSchema,
})

// The Interchange is built once, at its first successful envelope; a Retry delivers it again.
const buildInterchange = (
  queued: QueuedRun,
  run: ClaimedRun,
  lease: StepLease,
  { workspace, tradingPartner }: Destination,
) =>
  Effect.gen(function* () {
    const db = yield* Database
    const { characterSet } = tradingPartner
    // The pipeline stored the delivery input itself, so one that breaks its schema is a defect.
    const message = yield* Effect.orDie(parse(messageSchema, run.deliveryInput))

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

    const content = yield* encoded(interchange, characterSet)

    // A stalled worker must not replace the Interchange that a Retry of the Run delivered.
    const stored = yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        if (!(await isLeased(tx, lease))) {
          return false
        }

        await tx.update(runs).set({ output: interchange }).where(eq(runs.id, run.id))

        return true
      }),
    )

    if (!stored) {
      return yield* new RunNotOwned({ runId: run.id })
    }

    return { reference, content }
  })

const deliverInterchange =
  (
    queued: QueuedRun,
    run: ClaimedRun,
    messageType: MessageType,
    destination: Destination,
    isRetry: boolean,
  ) =>
  (lease: StepLease) =>
    Effect.gen(function* () {
      // Only UNOA to UNOC encode, all as ISO 8859-1, so a stored Interchange was written in it.
      const { reference, content } =
        run.output !== null && run.controlReference !== null
          ? { reference: run.controlReference, content: Buffer.from(run.output, 'latin1') }
          : yield* buildInterchange(queued, run, lease, destination)

      // The name carries the control reference, so a Retry uploads under the name of its first attempt.
      yield* handOver(run, lease, destination.channel, {
        name: `${messageType}-${String(reference)}.edi`,
        content,
        mediaType: 'application/edifact',
        isRetry,
      })
    })

const documentFormats = {
  json: { extension: 'json', mediaType: 'application/json' },
  csv: { extension: 'csv', mediaType: 'text/csv' },
} as const

const encodingOf = (structure: DocumentStructure) =>
  structure.format === 'csv' ? structure.csv.encoding : 'utf-8'

const deliverDocument =
  (run: ClaimedRun, pinned: Pinned, destination: Destination, isRetry: boolean) =>
  (lease: StepLease) =>
    Effect.gen(function* () {
      const { structure } = pinned

      if (run.output === null) {
        return yield* Effect.die(new Error(`Run ${run.id} has no output to deliver`))
      }

      const { extension, mediaType } = documentFormats[structure.format]

      yield* handOver(run, lease, destination.channel, {
        name: `${pinned.messageType}-${run.id}.${extension}`,
        content: Buffer.from(encodeText(run.output, encodingOf(structure))),
        mediaType,
        isRetry,
      })
    })

const orderNumberOf = ({ segments }: Message) =>
  segments.find(({ tag, elements }) => tag === 'RFF' && elements[0]?.[0] === 'ON')
    ?.elements[0]?.[1] ?? null

const loadPinned = (workspaceId: string, mappingVersionId: string, direction: Direction) =>
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

    if (directionOf(mapping) !== direction) {
      return yield* Effect.die(new Error(`Mapping ${mapping.id} is not ${direction}`))
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
      return new Map() satisfies LoadedLookupTables
    }

    const db = yield* Database

    const rows = yield* Effect.promise(() =>
      db
        .select({
          lookupTableId: lookupTables.id,
          name: lookupTables.name,
          entry: {
            sourceCode: lookupTableEntries.sourceCode,
            targetCode: lookupTableEntries.targetCode,
          },
        })
        .from(lookupTables)
        .leftJoin(lookupTableEntries, eq(lookupTableEntries.lookupTableId, lookupTables.id))
        .where(and(eq(lookupTables.workspaceId, workspaceId), inArray(lookupTables.id, ids)))
        .orderBy(asc(lookupTableEntries.position)),
    )

    const loaded = new Map<string, LoadedLookupTable>()

    for (const { lookupTableId, name, entry } of rows) {
      const table = loaded.get(lookupTableId) ?? { id: lookupTableId, name, entries: [] }

      loaded.set(lookupTableId, table)

      if (entry !== null) {
        table.entries.push(entry)
      }
    }

    return loaded satisfies LoadedLookupTables
  })

// A worker owns a step while it runs with the start this worker wrote.
type StepLease = { runId: string; stage: RunStepStage; startedAt: Date }

const leased = ({ runId, stage, startedAt }: StepLease) =>
  and(
    eq(runSteps.runId, runId),
    eq(runSteps.stage, stage),
    eq(runSteps.status, 'running'),
    eq(runSteps.startedAt, startedAt),
  )

// A worker that stalled past the stuck bound lost its Run to the sweep, so it stops.
const ensureOwned = (lease: StepLease) =>
  Effect.gen(function* () {
    const db = yield* Database

    const [owned] = yield* Effect.promise(() =>
      db.select({ runId: runSteps.runId }).from(runSteps).where(leased(lease)),
    )

    if (owned === undefined) {
      return yield* new RunNotOwned({ runId: lease.runId })
    }
  })

// Locks the Run first, so the sweep cannot take it between this check and the write after it.
const isLeased = async (tx: Transaction, lease: StepLease) => {
  await tx.select({ id: runs.id }).from(runs).where(eq(runs.id, lease.runId)).for('update')

  const [owned] = await tx.select({ runId: runSteps.runId }).from(runSteps).where(leased(lease))

  return owned !== undefined
}

// A step starts only from pending on a processing Run, so two workers never both start it.
const startStep = (runId: string, stage: RunStepStage) =>
  Effect.gen(function* () {
    const db = yield* Database
    const startedAt = yield* DateTime.nowAsDate

    const [started] = yield* Effect.promise(() =>
      db
        .update(runSteps)
        .set({ status: 'running', startedAt })
        .where(
          and(
            eq(runSteps.runId, runId),
            eq(runSteps.stage, stage),
            eq(runSteps.status, 'pending'),
            exists(
              db
                .select()
                .from(runs)
                .where(and(eq(runs.id, runId), eq(runs.status, 'processing'))),
            ),
          ),
        )
        .returning({ runId: runSteps.runId }),
    )

    if (started === undefined) {
      return yield* new RunNotOwned({ runId })
    }

    return { runId, stage, startedAt } satisfies StepLease
  })

// What a step stores for later steps goes into its finish, so only the worker that owns the Run stores it.
const step = <A, E, R>(
  runId: string,
  stage: RunStepStage,
  run: (lease: StepLease) => Effect.Effect<A, E, R>,
  succeeded: (tx: Transaction, value: A) => Promise<void> = () => Promise.resolve(),
) =>
  Effect.gen(function* () {
    const lease = yield* startStep(runId, stage)

    const result = yield* Effect.result(run(lease))
    const db = yield* Database
    const finishedAt = yield* DateTime.nowAsDate

    const finished = yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const [own] = await tx
          .update(runSteps)
          .set({ status: Result.isSuccess(result) ? 'succeeded' : 'failed', finishedAt })
          .where(leased(lease))
          .returning({ runId: runSteps.runId })

        if (own !== undefined && Result.isSuccess(result)) {
          await succeeded(tx, result.success)
        }

        return own !== undefined
      }),
    )

    if (!finished) {
      return yield* new RunNotOwned({ runId })
    }

    return result
  })

// Only a processing Run fails, so a defect never overwrites a Run that already failed.
const failRun = async (tx: Transaction, runId: string, failure: Failure, position: number) => {
  const [failed] = await tx
    .update(runs)
    .set({
      status: 'failed',
      failureStage: failure.stage,
      error: failure.error,
      problem: failure.problem,
    })
    .where(and(eq(runs.id, runId), eq(runs.status, 'processing')))
    .returning({ id: runs.id })

  if (failed === undefined) {
    return false
  }

  await tx
    .update(runSteps)
    .set({ status: 'skipped' })
    .where(and(eq(runSteps.runId, runId), gt(runSteps.position, position)))

  return true
}

const fail = (runId: string, failure: Failure) =>
  Effect.gen(function* () {
    const db = yield* Database

    yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const [failed] = await tx
          .select({ position: runSteps.position })
          .from(runSteps)
          .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, failure.stage)))

        await failRun(tx, runId, failure, failed?.position ?? 0)
      }),
    )
  })

const defectFailure = (stage: FailureStage): Failure => ({
  stage,
  error: {
    code: 'processingDefect',
    message: 'The processing stopped on an unexpected error',
    position: null,
    details: null,
  },
  problem: { reason: 'defect', fixTarget: null },
})

// A defect can stop a Run before its first step starts or after its step failed.
export const failOnDefect = (runId: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    const finishedAt = yield* DateTime.nowAsDate

    return yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const steps = await tx
          .select({ stage: runSteps.stage, status: runSteps.status, position: runSteps.position })
          .from(runSteps)
          .where(eq(runSteps.runId, runId))
          .orderBy(asc(runSteps.position))

        const stopped = steps.find(({ status }) => status !== 'succeeded' && status !== 'skipped')
        const stage = failureStageSchema.safeParse(stopped?.stage)

        if (stopped === undefined || !stage.success) {
          return false
        }

        const failed = await failRun(tx, runId, defectFailure(stage.data), stopped.position)

        if (!failed || stopped.status === 'failed') {
          return failed
        }

        // A failed step has its timings, so a step that never started fails at the defect.
        await tx
          .update(runSteps)
          .set({
            status: 'failed',
            ...(stopped.status === 'pending' && { startedAt: finishedAt }),
            finishedAt,
          })
          .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, stopped.stage)))

        return true
      }),
    )
  })

// Claims a received Run, so a Run handed out twice is processed once.
const claim = ({ workspaceId, runId }: QueuedRun) =>
  Effect.gen(function* () {
    const db = yield* Database

    const [found] = yield* Effect.promise(() =>
      db
        .select({
          run: runs,
          flow: flows,
          tradingPartner: { id: tradingPartners.id, name: tradingPartners.name },
        })
        .from(runs)
        .innerJoin(flows, eq(flows.id, runs.flowId))
        .innerJoin(tradingPartners, eq(tradingPartners.id, runs.tradingPartnerId))
        .where(
          and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId), eq(runs.status, 'received')),
        ),
    )

    if (found === undefined) {
      return undefined
    }

    // A retried Run keeps the Mapping Version it was processed with.
    const [claimed] = yield* Effect.promise(() =>
      db
        .update(runs)
        .set({
          status: 'processing',
          mappingVersionId: found.run.mappingVersionId ?? found.flow.mappingVersionId,
        })
        .where(and(eq(runs.id, runId), eq(runs.status, 'received')))
        .returning(),
    )

    return (
      claimed && {
        run: claimed,
        direction: directionOf(found.flow),
        tradingPartner: found.tradingPartner,
      }
    )
  })

const replaceWaitingRun = (run: ClaimedRun, direction: Direction) =>
  Effect.gen(function* () {
    const { businessReference } = run

    if (businessReference === null || run.replacesRunId !== null) {
      return
    }

    const db = yield* Database
    const replacing = alias(runs, 'replacing')

    yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        const candidates = await tx
          .select({ id: runs.id, failureStage: runs.failureStage, problem: runs.problem })
          .from(runs)
          .where(
            and(
              eq(runs.workspaceId, run.workspaceId),
              eq(runs.flowId, run.flowId),
              eq(runs.businessReference, businessReference),
              eq(runs.status, 'failed'),
              lt(runs.receivedAt, run.receivedAt),
              notExists(tx.select().from(replacing).where(eq(replacing.replacesRunId, runs.id))),
            ),
          )
          .orderBy(desc(runs.receivedAt))

        // The Run shares the Flow of the resend, so it shares its Direction.
        const waiting = candidates.find(
          (candidate) => whoFixes({ ...candidate, direction }) === 'tradingPartner',
        )

        if (waiting === undefined) {
          return
        }

        // Locks the waiting Run, so two resends delivered at once replace it once.
        await tx.select({ id: runs.id }).from(runs).where(eq(runs.id, waiting.id)).for('update')

        // A resend that waited for the lock reads the link the other one committed.
        const [replaced] = await tx
          .select({ id: runs.id })
          .from(runs)
          .where(eq(runs.replacesRunId, waiting.id))

        if (replaced !== undefined) {
          return
        }

        await tx.update(runs).set({ replacesRunId: waiting.id }).where(eq(runs.id, run.id))
        await tx
          .update(runs)
          .set({ waitingForTradingPartnerSince: null })
          .where(eq(runs.id, waiting.id))
      }),
    ).pipe(
      // The Document is already handed over, so the Run stays delivered without the link.
      Effect.catchCause((cause) =>
        Effect.logError(`Delivered Run ${run.id} replaced no waiting Run`, cause),
      ),
    )
  })

const deliveryStep = (
  run: ClaimedRun,
  destination: Destination,
  delivering: (
    lease: StepLease,
  ) => Effect.Effect<void, DeliveryError | RunNotOwned, Database | Delivery>,
) =>
  Effect.gen(function* () {
    const delivered = yield* step(
      run.id,
      'delivery',
      (lease) =>
        delivering(lease).pipe(
          Effect.catchDefect((defect) => Effect.fail(new DeliveryDefect({ defect }))),
        ),
      async (tx) => {
        await tx
          .update(runs)
          .set({ status: 'delivered' })
          .where(and(eq(runs.id, run.id), eq(runs.status, 'processing')))
      },
    )

    if (Result.isSuccess(delivered)) {
      return true
    }

    const { failure } = delivered

    if (Predicate.isTagged(failure, 'RunNotOwned')) {
      return yield* failure
    }

    yield* fail(run.id, deliveryFailure(failure, destination))

    if (
      Predicate.isTagged(failure, 'ChannelDefect') ||
      Predicate.isTagged(failure, 'DeliveryDefect')
    ) {
      return yield* Effect.die(failure.defect)
    }

    return false
  })

type Processing = {
  queued: QueuedRun
  run: ClaimedRun
  content: string
  pinned: Pinned
  lookupTables: LoadedLookupTables
  tradingPartner: TradingPartner
}

const processOutbound = ({ queued, run, content, pinned, lookupTables }: Processing) =>
  Effect.gen(function* () {
    const mapped = yield* step(run.id, 'mapping', () =>
      readDocument(pinned.structure, content).pipe(
        Effect.flatMap((document) =>
          mapMessage(
            { ...pinned.graph, target: { kind: 'messageType', messageType: pinned.messageType } },
            document,
            { lookupTables: entriesOf(lookupTables) },
          ),
        ),
      ),
    )

    if (Result.isFailure(mapped)) {
      return yield* fail(run.id, mappingFailure(pinned, lookupTables, mapped.failure))
    }

    const { message } = mapped.success
    const destination = yield* loadDestination(queued)
    const delivering = { ...run, businessReference: orderNumberOf(message), deliveryInput: message }

    const checked = yield* step(
      run.id,
      'validation',
      () => validated(message, destination.tradingPartner.characterSet),
      async (tx) => {
        await tx
          .update(runs)
          .set({
            businessReference: delivering.businessReference,
            deliveryInput: delivering.deliveryInput,
          })
          .where(eq(runs.id, run.id))
      },
    )

    if (Result.isFailure(checked)) {
      return yield* fail(run.id, validationFailure(pinned, mapped.success, checked.failure))
    }

    yield* deliveryStep(
      delivering,
      destination,
      deliverInterchange(queued, delivering, pinned.messageType, destination, false),
    )
  })

// Receipt routed the Message by this envelope, so the Interchange reads again here.
const readMessage = (content: string, messageIndex: number | null) =>
  Effect.gen(function* () {
    const interchange = parseMessages(content)
    const message = messageIndex === null ? undefined : interchange.messages[messageIndex - 1]

    if (messageIndex === null || message === undefined) {
      return yield* Effect.die(new Error(`The Interchange has no Message ${String(messageIndex)}`))
    }

    if (isBrokenMessage(message)) {
      return yield* new MessageUnreadable({ cause: message.error, interchange })
    }

    return { interchange, message, messageIndex } satisfies ReadMessage
  })

const validatedInbound = ({ interchange, message }: ReadMessage) =>
  Effect.try({
    try: () => validate({ ...interchange, messages: [message] }),
    catch: (cause) => {
      if (cause instanceof ValidationError) {
        return new MessageInvalid({ cause })
      }

      throw cause
    },
  })

const documentNumberOf = ({ segments }: Message) =>
  segments.find(({ tag }) => tag === 'BGM')?.elements[1]?.[0] ?? null

const processInbound = ({
  queued,
  run,
  content,
  pinned,
  lookupTables,
  tradingPartner,
}: Processing) =>
  Effect.gen(function* () {
    // A waiting Run needs its Business Reference, so a resend can replace it.
    const read = yield* step(
      run.id,
      'parse',
      () => readMessage(content, run.messageIndex),
      async (tx, { message }) => {
        await tx
          .update(runs)
          .set({ businessReference: documentNumberOf(message) })
          .where(eq(runs.id, run.id))
      },
    )

    if (Result.isFailure(read)) {
      return yield* fail(run.id, parseFailure(content, tradingPartner, read.failure))
    }

    const { message } = read.success
    const checked = yield* step(run.id, 'validation', () => validatedInbound(read.success))

    if (Result.isFailure(checked)) {
      return yield* fail(
        run.id,
        inboundValidationFailure(content, tradingPartner, read.success, checked.failure),
      )
    }

    const { structure } = pinned

    const mapped = yield* step(
      run.id,
      'mapping',
      () =>
        applyInboundMappingVersion(
          { ...pinned.graph, source: { kind: 'messageType', messageType: pinned.messageType } },
          structure,
          message,
          { lookupTables: entriesOf(lookupTables) },
        ).pipe(
          Effect.flatMap((document) => writeDocument(structure, document)),
          Effect.map((written) => new TextDecoder(encodingOf(structure)).decode(written)),
        ),
      async (tx, output) => {
        await tx.update(runs).set({ output }).where(eq(runs.id, run.id))
      },
    )

    if (Result.isFailure(mapped)) {
      return yield* fail(run.id, mappingFailure(pinned, lookupTables, mapped.failure))
    }

    const delivering = {
      ...run,
      businessReference: documentNumberOf(message),
      output: mapped.success,
    }

    const destination = yield* loadDestination(queued)

    const delivered = yield* deliveryStep(
      delivering,
      destination,
      deliverDocument(delivering, pinned, destination, false),
    )

    if (delivered) {
      yield* replaceWaitingRun(delivering, 'inbound')
    }
  })

// A Retry leaves every step before the delivery succeeded.
const isOnlyDeliveryLeft = (runId: string) =>
  Effect.gen(function* () {
    const db = yield* Database

    const steps = yield* Effect.promise(() =>
      db
        .select({ stage: runSteps.stage, status: runSteps.status })
        .from(runSteps)
        .where(eq(runSteps.runId, runId)),
    )

    return steps.every(({ stage, status }) => stage === 'delivery' || status === 'succeeded')
  })

const processClaimed = (
  queued: QueuedRun,
  {
    run,
    direction,
    tradingPartner,
  }: { run: ClaimedRun; direction: Direction; tradingPartner: TradingPartner },
) =>
  Effect.gen(function* () {
    const { mappingVersionId } = run

    if (mappingVersionId === null) {
      return yield* Effect.die(new Error(`Run ${run.id} has no Mapping Version`))
    }

    const pinned = yield* loadPinned(queued.workspaceId, mappingVersionId, direction)

    if (yield* isOnlyDeliveryLeft(run.id)) {
      const destination = yield* loadDestination(queued)

      const delivered = yield* deliveryStep(
        run,
        destination,
        direction === 'outbound'
          ? deliverInterchange(queued, run, pinned.messageType, destination, true)
          : deliverDocument(run, pinned, destination, true),
      )

      if (delivered) {
        yield* replaceWaitingRun(run, direction)
      }

      return
    }

    const documents = yield* Documents
    const document = yield* Effect.promise(() => documents.read(queued.workspaceId, run.documentId))

    if (document === undefined) {
      return yield* Effect.die(new Error(`Document ${run.documentId} of Run ${run.id} is missing`))
    }

    const lookupTables = yield* loadLookupTables(queued.workspaceId, pinned.graph)

    const processing = {
      queued,
      run,
      content: document.content,
      pinned,
      lookupTables,
      tradingPartner,
    }

    yield* direction === 'outbound' ? processOutbound(processing) : processInbound(processing)
  })

export const processRun = (queued: QueuedRun) =>
  Effect.gen(function* () {
    const claimed = yield* claim(queued)

    if (claimed === undefined) {
      return
    }

    // The defect still dies, so the worker reports it.
    yield* processClaimed(queued, claimed).pipe(
      Effect.tapDefect(() => failOnDefect(claimed.run.id)),
      Effect.catchTag('RunNotOwned', (error) =>
        Effect.logWarning('A stalled worker stopped processing a Run it lost', error),
      ),
    )
  })
