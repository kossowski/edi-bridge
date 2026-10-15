import { asc, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  directionOf,
  type DocumentContent,
  type DocumentStructure,
  type ComparisonOutputs,
  type LookupTableEntry,
  type MappingGraph,
  type MappingPreview,
  type MappingSample,
  type MessageType,
  outputDifferences,
  type OutputEntry,
  type PreviewMappingBody,
  type PreviewNote,
  type VersionOutput,
} from '@edi-bridge/contracts'
import { lookupTableEntries, lookupTables } from '@edi-bridge/db'
import { parse, serializeMessage } from '@edi-bridge/edifact'
import {
  applyInboundMappingVersion,
  applyMappingVersion,
  documentEntries,
  type MappingError,
  type MappingErrorCode,
  messageEntries,
  readDocument,
} from '@edi-bridge/mapping'

import { Db } from './db.js'
import { loadDocumentStructure } from './document-structure.js'
import { NotFound } from './errors.js'
import { chosenLookupTableIds, loadRow } from './mapping.js'
import { inWorkspace } from './rows.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

// Until Runs (#187) keep inbound Documents, only an outbound Mapping has a Sample Document: the
// one its Document Structure was read from, under the structure's id.
const samplesOfStructure = (structure: DocumentStructure): Effect.Effect<MappingSample[]> => {
  const { sample } = structure

  if (sample === null) {
    return Effect.succeed([])
  }

  return readDocument(structure, sample.text).pipe(
    Effect.match({
      onFailure: () => [],
      onSuccess: (content) => [
        { id: structure.id, name: sample.fileName, document: { format: 'json', content } },
      ],
    }),
  )
}

const loadSamples = (id: string) =>
  Effect.gen(function* () {
    const mapping = yield* loadRow(id)
    const structure = yield* loadDocumentStructure(mapping.documentStructureId)

    const samples = directionOf(mapping) === 'inbound' ? [] : yield* samplesOfStructure(structure)

    return { mapping, structure, samples }
  })

export const listMappingSamples = (id: string) =>
  Effect.map(loadSamples(id), ({ samples }) => samples)

const loadLookupTables = (graphs: ReadonlyArray<MappingGraph>) =>
  Effect.gen(function* () {
    const chosen = [...new Set(graphs.flatMap(chosenLookupTableIds))]

    if (chosen.length === 0) {
      return new Map<string, LookupTableEntry[]>()
    }

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const rows = yield* Effect.promise(() =>
      db
        .select({
          lookupTableId: lookupTableEntries.lookupTableId,
          sourceCode: lookupTableEntries.sourceCode,
          targetCode: lookupTableEntries.targetCode,
        })
        .from(lookupTableEntries)
        .innerJoin(lookupTables, eq(lookupTableEntries.lookupTableId, lookupTables.id))
        .where(inWorkspace(lookupTables, workspace.id, inArray(lookupTables.id, chosen)))
        .orderBy(asc(lookupTableEntries.position)),
    )

    return Map.groupBy(rows, ({ lookupTableId }) => lookupTableId)
  })

const noteCodes: Record<MappingErrorCode, PreviewNote['code']> = {
  missingRequiredValue: 'missingRequiredValue',
  outsideLoop: 'outsideLoop',
  unknownSource: 'brokenLink',
  unknownTarget: 'brokenLink',
  invalidTransform: 'invalidTransform',
  invalidDate: 'invalidDate',
  invalidNumber: 'invalidNumber',
  unknownLookupTable: 'unknownLookupTable',
  noLookupMatch: 'noLookupMatch',
  expressionFailed: 'expressionFailed',
}

const noteOf = ({ code, targetPath, transformId }: MappingError): PreviewNote => ({
  targetPath,
  transformId: transformId ?? null,
  code: noteCodes[code],
})

type Sides = { messageType: MessageType; structure: DocumentStructure }

type Run = Sides & {
  lookupTables: ReadonlyMap<string, ReadonlyArray<LookupTableEntry>>
  source: DocumentContent
}

type Output = VersionOutput & { entries: OutputEntry[] }

function messageOf(text: string) {
  const [message] = parse(text).messages

  if (!message) {
    throw new Error('The Sample Document holds no Message')
  }

  return message
}

const written = (
  { messageType, structure, lookupTables: tables, source }: Run,
  graph: MappingGraph,
): Effect.Effect<Omit<Output, 'notes'>, MappingError> => {
  const options = { lookupTables: tables }

  return source.format === 'json'
    ? Effect.map(
        applyMappingVersion(
          { ...graph, target: { kind: 'messageType', messageType } },
          source.content,
          options,
        ),
        (message) => ({
          document: { format: 'edifact', content: serializeMessage(message) },
          entries: messageEntries(messageType, message),
        }),
      )
    : Effect.map(
        applyInboundMappingVersion(
          { ...graph, source: { kind: 'messageType', messageType } },
          structure,
          messageOf(source.content),
          options,
        ),
        (content) => ({
          document: { format: 'json', content },
          entries: documentEntries(structure, content),
        }),
      )
}

// The engine stops at its first error, so a failed run leaves the whole target empty.
const outputOf = (run: Run, graph: MappingGraph): Effect.Effect<Output> =>
  Effect.match(written(run, graph), {
    onFailure: (error) => ({
      document:
        run.source.format === 'json'
          ? { format: 'edifact', content: '' }
          : { format: 'json', content: {} },
      notes: [noteOf(error)],
      entries: [],
    }),
    onSuccess: (output) => ({ ...output, notes: [] }),
  })

type Loaded = Effect.Success<ReturnType<typeof loadSamples>>

const prepareRun = (
  { mapping, structure, samples }: Loaded,
  sampleId: string,
  graphs: ReadonlyArray<MappingGraph>,
) =>
  Effect.gen(function* () {
    const sample = samples.find((candidate) => candidate.id === sampleId)

    if (!sample) {
      return yield* Effect.fail(new NotFound())
    }

    return {
      messageType: mapping.messageType,
      structure,
      lookupTables: yield* loadLookupTables(graphs),
      source: sample.document,
    } satisfies Run
  })

export const previewMapping = (
  id: string,
  input: Effect.Effect<PreviewMappingBody, ValidationError>,
) =>
  Effect.gen(function* () {
    const loaded = yield* loadSamples(id)
    const { sampleId, graph } = yield* input

    const { document, notes } = yield* outputOf(yield* prepareRun(loaded, sampleId, [graph]), graph)

    return { sampleId, document, notes } satisfies MappingPreview
  })

export const compareOutputs = (
  mappingId: string,
  sampleId: string,
  before: MappingGraph,
  after: MappingGraph,
) =>
  Effect.gen(function* () {
    const run = yield* prepareRun(yield* loadSamples(mappingId), sampleId, [before, after])
    const from = yield* outputOf(run, before)
    const to = yield* outputOf(run, after)

    return {
      sampleId,
      from: { document: from.document, notes: from.notes },
      to: { document: to.document, notes: to.notes },
      differences: outputDifferences(from.entries, to.entries),
    } satisfies ComparisonOutputs
  })
