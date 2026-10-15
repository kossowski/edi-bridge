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
} from '@edi-bridge/contracts'
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

import { loadDocumentStructure } from './document-structure.js'
import { NotFound, Unprocessable } from './errors.js'
import { loadLookupTableEntries } from './lookup-table.js'
import { chosenLookupTableIds, loadRow } from './mapping.js'

import type { ValidationError } from './parse.js'

// Until Runs (#187), only an outbound Mapping has a Sample Document: its structure's sample.
const samplesOfStructure = (structure: DocumentStructure): Effect.Effect<MappingSample[]> => {
  const { sample } = structure

  if (sample === null) {
    return Effect.succeed([])
  }

  return readDocument(structure, sample.text).pipe(
    Effect.match({
      // An unreadable sample leaves the editor in its no-sample state instead of failing it.
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

type Written = { document: DocumentContent; entries: OutputEntry[] }

type Engine = {
  empty: DocumentContent
  run: (graph: MappingGraph) => Effect.Effect<Written, MappingError>
}

const sampleWithoutMessage = new Unprocessable({
  message: 'The Sample Document holds no readable Message.',
})

const messageOf = (text: string) =>
  Effect.try({ try: () => parse(text).messages[0], catch: () => sampleWithoutMessage }).pipe(
    Effect.flatMap((message) =>
      message === undefined ? Effect.fail(sampleWithoutMessage) : Effect.succeed(message),
    ),
  )

const engineOf = (
  messageType: MessageType,
  structure: DocumentStructure,
  source: DocumentContent,
  lookupTables: ReadonlyMap<string, ReadonlyArray<LookupTableEntry>>,
): Effect.Effect<Engine, Unprocessable> => {
  const options = { lookupTables }

  if (source.format === 'json') {
    return Effect.succeed({
      empty: { format: 'edifact', content: '' },
      run: (graph) =>
        Effect.map(
          applyMappingVersion(
            { ...graph, target: { kind: 'messageType', messageType } },
            source.content,
            options,
          ),
          (message) => ({
            document: { format: 'edifact', content: serializeMessage(message) },
            entries: messageEntries(messageType, message),
          }),
        ),
    })
  }

  return Effect.map(messageOf(source.content), (message) => ({
    empty: { format: 'json', content: {} },
    run: (graph) =>
      Effect.map(
        applyInboundMappingVersion(
          { ...graph, source: { kind: 'messageType', messageType } },
          structure,
          message,
          options,
        ),
        (content) => ({
          document: { format: 'json', content },
          entries: documentEntries(structure, content),
        }),
      ),
  }))
}

// The engine stops at its first error, so a failed run leaves the whole target empty.
const outputOf = (engine: Engine, graph: MappingGraph) =>
  Effect.match(engine.run(graph), {
    onFailure: (error) => ({ document: engine.empty, notes: [noteOf(error)], entries: [] }),
    onSuccess: (written) => ({ ...written, notes: [] }),
  })

type Loaded = {
  mapping: { messageType: MessageType }
  structure: DocumentStructure
  samples: ReadonlyArray<MappingSample>
}

const startEngine = (
  { mapping, structure, samples }: Loaded,
  sampleId: string,
  graphs: ReadonlyArray<MappingGraph>,
) =>
  Effect.gen(function* () {
    const sample = samples.find((candidate) => candidate.id === sampleId)

    if (!sample) {
      return yield* Effect.fail(new NotFound())
    }

    const lookupTables = yield* loadLookupTableEntries(graphs.flatMap(chosenLookupTableIds))

    return yield* engineOf(mapping.messageType, structure, sample.document, lookupTables)
  })

export const previewWith = (loaded: Loaded, { sampleId, graph }: PreviewMappingBody) =>
  Effect.gen(function* () {
    const { document, notes } = yield* outputOf(
      yield* startEngine(loaded, sampleId, [graph]),
      graph,
    )

    return { sampleId, document, notes } satisfies MappingPreview
  })

export const compareOutputsWith = (
  loaded: Loaded,
  sampleId: string,
  before: MappingGraph,
  after: MappingGraph,
) =>
  Effect.gen(function* () {
    const engine = yield* startEngine(loaded, sampleId, [before, after])
    const from = yield* outputOf(engine, before)
    const to = yield* outputOf(engine, after)

    return {
      sampleId,
      from: { document: from.document, notes: from.notes },
      to: { document: to.document, notes: to.notes },
      differences: outputDifferences(from.entries, to.entries),
    } satisfies ComparisonOutputs
  })

export const previewMapping = (
  id: string,
  input: Effect.Effect<PreviewMappingBody, ValidationError>,
) =>
  Effect.gen(function* () {
    const loaded = yield* loadSamples(id)

    return yield* previewWith(loaded, yield* input)
  })

export const compareOutputs = (
  mappingId: string,
  sampleId: string,
  before: MappingGraph,
  after: MappingGraph,
) =>
  Effect.flatMap(loadSamples(mappingId), (loaded) =>
    compareOutputsWith(loaded, sampleId, before, after),
  )
