import { delay, http, HttpResponse } from 'msw'

import {
  type DocumentContent,
  type DocumentStructure,
  type MappingGraph,
  type MappingPreview,
  mappingPreviewEndpoint,
  mappingSamplesEndpoint,
  messageTypeStructures,
  type PreviewNote,
  previewNoteKey,
} from '@edi-bridge/contracts'

import {
  type DocumentStructureStore,
  seedDocumentStructures,
  toDocumentStructureStore,
} from './document-structure'
import { documentValues, type Entry, renderEdifact, renderJson } from './document-values'
import {
  type LookupTableRecord,
  type LookupTableStore,
  seedLookupTables,
  toLookupTableStore,
} from './lookup-table'
import {
  type MappingDraftRecord,
  type MappingDraftStore,
  oriented,
  sideLeaves,
  toMappingDraftStore,
  unknownPaths,
} from './mapping'
import { type MappingSampleRecord, seedMappingSamples, toMappingSample } from './mapping-sample'
import { evaluateExpressions, type LookUp, previewEntries } from './preview-engine'
import { badRequest, notFound } from './responses'

function distinct(notes: ReadonlyArray<PreviewNote>) {
  const seen = new Set<string>()

  return notes.filter((note) => {
    const key = previewNoteKey(note)

    return !seen.has(key) && seen.add(key)
  })
}

export function lookUpIn(lookupTables: LookupTableStore): LookUp {
  return (lookupTableId, value) =>
    lookupTableId === null ? undefined : lookupTables.translate(lookupTableId, value)
}

export async function previewOutput({
  mapping,
  graph,
  sample,
  documentStructures,
  lookUp,
}: {
  mapping: MappingDraftRecord
  graph: MappingGraph
  sample: MappingSampleRecord
  documentStructures: ReadonlyArray<DocumentStructure>
  lookUp: LookUp
}): Promise<{ document: DocumentContent; notes: PreviewNote[]; entries: ReadonlyArray<Entry> }> {
  const expressions = await evaluateExpressions(
    graph,
    sample.document.format === 'json' ? sample.document.content : undefined,
  )

  const { entries, notes } = previewEntries(graph, documentValues(sample.entries), expressions, {
    unknown: unknownPaths(graph, sideLeaves(mapping, documentStructures)),
    lookUp,
  })

  const values = documentValues(entries)

  const documentStructure = documentStructures.find(({ id }) => id === mapping.documentStructureId)

  const document = oriented<() => DocumentContent>(mapping.messageType, {
    document: () => ({
      format: 'json',
      content: documentStructure ? renderJson(documentStructure, values) : {},
    }),
    edifact: () => ({
      format: 'edifact',
      content: renderEdifact(messageTypeStructures[mapping.messageType], values),
    }),
  }).target()

  return { document, notes: distinct(notes), entries }
}

export function mappingPreviewHandlers(
  apiUrl: string,
  {
    mappings,
    samples = seedMappingSamples,
    documentStructures = seedDocumentStructures,
    lookupTables = seedLookupTables,
  }: {
    mappings?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
    samples?: ReadonlyArray<MappingSampleRecord>
    documentStructures?: ReadonlyArray<DocumentStructure> | DocumentStructureStore
    lookupTables?: ReadonlyArray<LookupTableRecord> | LookupTableStore
  } = {},
) {
  const store = toMappingDraftStore(mappings)
  const structures = toDocumentStructureStore(documentStructures)
  const lookUp = lookUpIn(toLookupTableStore(lookupTables))

  return [
    http.get<{ id: string }>(`${apiUrl}${mappingSamplesEndpoint.path}`, ({ params }) =>
      store.get(params.id)
        ? HttpResponse.json(
            samples.filter(({ mappingId }) => mappingId === params.id).map(toMappingSample),
          )
        : notFound(),
    ),
    http.post<{ id: string }>(
      `${apiUrl}${mappingPreviewEndpoint.path}`,
      async ({ params, request }) => {
        const mapping = store.get(params.id)

        if (!mapping) {
          return notFound()
        }

        const body = mappingPreviewEndpoint.body.safeParse(await request.json())

        if (!body.success) {
          return badRequest(body.error.message)
        }

        const { sampleId, graph } = body.data

        const sample = samples.find(
          ({ id, mappingId }) => id === sampleId && mappingId === mapping.id,
        )

        if (!sample) {
          return notFound()
        }

        const { document, notes } = await previewOutput({
          mapping,
          graph,
          sample,
          documentStructures: structures.all(),
          lookUp,
        })

        await delay()

        return HttpResponse.json({
          sampleId,
          document,
          notes,
        } satisfies MappingPreview)
      },
    ),
  ]
}
