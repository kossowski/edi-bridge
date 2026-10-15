import { asc, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  directionOf,
  type DocumentContent,
  type DocumentStructure,
  type LookupTableEntry,
  type MappingGraph,
  type MappingPreview,
  type MappingSample,
  type MessageType,
  type PreviewMappingBody,
  type PreviewNote,
} from '@edi-bridge/contracts'
import { lookupTableEntries, lookupTables } from '@edi-bridge/db'
import { parse, serializeMessage } from '@edi-bridge/edifact'
import {
  applyInboundMappingVersion,
  applyMappingVersion,
  type MappingError,
  type MappingErrorCode,
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

const loadLookupTables = (graph: MappingGraph) =>
  Effect.gen(function* () {
    const chosen = chosenLookupTableIds(graph)

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

type Run = {
  messageType: MessageType
  structure: DocumentStructure
  graph: MappingGraph
  lookupTables: ReadonlyMap<string, ReadonlyArray<LookupTableEntry>>
}

function messageOf(text: string) {
  const [message] = parse(text).messages

  if (!message) {
    throw new Error('The Sample Document holds no Message')
  }

  return message
}

// The engine stops at its first error, so a failed run leaves the whole target empty.
const outputOf = (
  { messageType, structure, graph, lookupTables: tables }: Run,
  source: DocumentContent,
): Effect.Effect<Pick<MappingPreview, 'document' | 'notes'>> => {
  const options = { lookupTables: tables }

  const run: Effect.Effect<DocumentContent, MappingError> =
    source.format === 'json'
      ? Effect.map(
          applyMappingVersion(
            { ...graph, target: { kind: 'messageType', messageType } },
            source.content,
            options,
          ),
          (message) => ({ format: 'edifact', content: serializeMessage(message) }),
        )
      : Effect.map(
          applyInboundMappingVersion(
            { ...graph, source: { kind: 'messageType', messageType } },
            structure,
            messageOf(source.content),
            options,
          ),
          (content) => ({ format: 'json', content }),
        )

  const empty: DocumentContent =
    source.format === 'json' ? { format: 'edifact', content: '' } : { format: 'json', content: {} }

  return Effect.match(run, {
    onFailure: (error) => ({ document: empty, notes: [noteOf(error)] }),
    onSuccess: (document) => ({ document, notes: [] }),
  })
}

export const previewMapping = (
  id: string,
  input: Effect.Effect<PreviewMappingBody, ValidationError>,
) =>
  Effect.gen(function* () {
    const { mapping, structure, samples } = yield* loadSamples(id)
    const { sampleId, graph } = yield* input

    const sample = samples.find((candidate) => candidate.id === sampleId)

    if (!sample) {
      return yield* Effect.fail(new NotFound())
    }

    const run = {
      messageType: mapping.messageType,
      structure,
      graph,
      lookupTables: yield* loadLookupTables(graph),
    }

    return { sampleId, ...(yield* outputOf(run, sample.document)) } satisfies MappingPreview
  })
