import { z } from 'zod'

import { mappingGraphSchema } from './mapping'

import type { Endpoint } from './endpoint'

export const jsonContentSchema = z.json()

export type JsonContent = z.infer<typeof jsonContentSchema>

// A Document in the form its side of the Mapping takes: parsed JSON for a Document Structure,
// raw EDIFACT text for a Message Type.
export const documentContentSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('json'), content: jsonContentSchema }),
  z.object({ format: z.literal('edifact'), content: z.string() }),
])

export type DocumentContent = z.infer<typeof documentContentSchema>

export const mappingSampleSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  document: documentContentSchema,
})

export type MappingSample = z.infer<typeof mappingSampleSchema>

export const previewNoteCodes = [
  'invalidTransform',
  'noLookupMatch',
  'expressionFailed',
  'expressionNotPreviewed',
] as const

export type PreviewNoteCode = (typeof previewNoteCodes)[number]

// Says why a linked target stayed empty in the preview, and which transform it was waiting on.
export const previewNoteSchema = z.object({
  targetPath: z.string().min(1),
  transformId: z.uuid().nullable(),
  code: z.enum(previewNoteCodes),
})

export type PreviewNote = z.infer<typeof previewNoteSchema>

// The graph comes from the client rather than the saved Draft, so the preview already shows a
// change whose save is still on its way.
export const previewMappingBodySchema = z.object({
  sampleId: z.uuid(),
  graph: mappingGraphSchema,
})

export type PreviewMappingBody = z.infer<typeof previewMappingBodySchema>

export const mappingPreviewSchema = z.object({
  sampleId: z.uuid(),
  document: documentContentSchema,
  notes: z.array(previewNoteSchema),
})

export type MappingPreview = z.infer<typeof mappingPreviewSchema>

export const mappingSamplesEndpoint: Endpoint<
  MappingSample[],
  undefined,
  undefined,
  '/mappings/:id/samples'
> = {
  method: 'GET',
  path: '/mappings/:id/samples',
  response: z.array(mappingSampleSchema),
}

export const mappingPreviewEndpoint: Endpoint<
  MappingPreview,
  undefined,
  PreviewMappingBody,
  '/mappings/:id/preview'
> = {
  method: 'POST',
  path: '/mappings/:id/preview',
  body: previewMappingBodySchema,
  response: mappingPreviewSchema,
}
