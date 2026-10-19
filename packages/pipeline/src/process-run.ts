import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import { Data, DateTime, Effect, Predicate, Result } from 'effect'

import {
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
  documentStructures,
  flows,
  lookupTableEntries,
  lookupTables,
  mappings,
  mappingVersions,
  runs,
  runSteps,
} from '@edi-bridge/db'
import {
  type Interchange,
  type Message,
  type Segment,
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

import { Database, Documents, type QueuedRun } from './services'

export class MessageInvalid extends Data.TaggedError('MessageInvalid')<{
  readonly cause: ValidationError
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

const envelopeHeader: Segment = { tag: 'UNB', elements: [] }

const envelopeTrailer: Segment = { tag: 'UNZ', elements: [] }

// Delivery wraps the Message in its own Interchange; validation needs only a frame around it.
const framed = (message: Message): Interchange => ({
  hasServiceStringAdvice: false,
  delimiters: {
    component: ':',
    element: '+',
    decimal: '.',
    release: '?',
    repetition: ' ',
    segment: "'",
  },
  header: envelopeHeader,
  messages: [message],
  trailer: envelopeTrailer,
})

const validated = (message: Message) =>
  Effect.suspend(() => {
    try {
      validate(framed(message))

      return Effect.void
    } catch (cause) {
      return cause instanceof ValidationError
        ? Effect.fail(new MessageInvalid({ cause }))
        : Effect.die(cause)
    }
  })

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

    return {
      mappingId: mapping.id,
      mappingName: mapping.name,
      graph: version.graph,
      messageType: mapping.messageType,
      structure: documentStructureSchema.parse({
        id: structure.id,
        name: structure.name,
        format: structure.format,
        ...(structure.format === 'json' ? { root: structure.jsonRoot } : { csv: structure.csv }),
        sample: null,
        children: structure.children,
      }),
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

const step = <A, E, R>(runId: string, stage: RunStepStage, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* updateStep(runId, stage, { status: 'running', startedAt: yield* DateTime.nowAsDate })

    const result = yield* Effect.result(effect)

    yield* updateStep(runId, stage, {
      status: Result.isSuccess(result) ? 'succeeded' : 'failed',
      finishedAt: yield* DateTime.nowAsDate,
    })

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

    // Inbound processing (parse, validation, mapping to the own systems) comes with #191.
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
    const checked = yield* step(run.id, 'validation', validated(message))

    if (Result.isFailure(checked)) {
      return yield* fail(run.id, validationFailure(message, checked.failure))
    }

    const db = yield* Database

    yield* Effect.promise(() =>
      db
        .update(runs)
        .set({ output: serializeMessage(message), businessReference: orderNumberOf(message) })
        .where(eq(runs.id, run.id)),
    )
  })
