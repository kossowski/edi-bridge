import { delay, http, HttpResponse } from 'msw'

import {
  directionOf,
  type DocumentContent,
  type DocumentStructure,
  type MappingPreview,
  mappingPreviewEndpoint,
  mappingSamplesEndpoint,
  type PreviewNote,
} from '@edi-bridge/contracts'

import { seedDocumentStructures } from './document-structure'
import { documentValues, renderEdifact, renderJson } from './document-values'
import {
  linkProblem,
  type MappingDraftRecord,
  type MappingDraftStore,
  sideLeaves,
  toMappingDraftStore,
} from './mapping'
import { type MappingSampleRecord, seedMappingSamples, toMappingSample } from './mapping-sample'
import { messageTypeStructures } from './message-type-structure'
import { evaluateExpressions, previewEntries } from './preview-engine'
import { badRequest, notFound } from './responses'

function distinct(notes: ReadonlyArray<PreviewNote>) {
  const seen = new Set<string>()

  return notes.filter((note) => {
    const key = `${note.targetPath}|${note.transformId}|${note.code}`

    return !seen.has(key) && seen.add(key)
  })
}

export function mappingPreviewHandlers(
  apiUrl: string,
  {
    mappings,
    samples = seedMappingSamples,
    documentStructures = seedDocumentStructures,
  }: {
    mappings?: ReadonlyArray<MappingDraftRecord> | MappingDraftStore
    samples?: ReadonlyArray<MappingSampleRecord>
    documentStructures?: ReadonlyArray<DocumentStructure>
  } = {},
) {
  const store = toMappingDraftStore(mappings)

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

        const invalidLink = linkProblem(graph, sideLeaves(mapping, documentStructures))

        if (invalidLink) {
          return invalidLink
        }

        const outbound = directionOf(mapping) === 'outbound'

        const expressions = await evaluateExpressions(
          graph,
          sample.document.format === 'json' ? sample.document.content : undefined,
        )

        const { entries, notes } = previewEntries(
          graph,
          documentValues(sample.entries),
          expressions,
        )

        const values = documentValues(entries)

        const documentStructure = documentStructures.find(
          ({ id }) => id === mapping.documentStructureId,
        )

        const document: DocumentContent = outbound
          ? {
              format: 'edifact',
              content: renderEdifact(messageTypeStructures[mapping.messageType], values),
            }
          : {
              format: 'json',
              content: documentStructure ? renderJson(documentStructure, values) : {},
            }

        await delay()

        return HttpResponse.json({
          sampleId,
          document,
          notes: distinct(notes),
        } satisfies MappingPreview)
      },
    ),
  ]
}
