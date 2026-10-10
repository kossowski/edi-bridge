import { z } from 'zod'

import { messageTypeSchema } from './message-type'
import { directionSchema } from './run'

import type { Endpoint } from './endpoint'

export const mappingSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  direction: directionSchema,
  messageType: messageTypeSchema,
  documentStructureId: z.uuid(),
  documentStructureName: z.string().min(1),
  latestVersion: z.number().int().min(1).nullable(),
  draftUpdatedAt: z.iso.datetime(),
})

export type MappingSummary = z.infer<typeof mappingSummarySchema>

export const documentStructureSideSchema = z.object({
  kind: z.literal('documentStructure'),
  documentStructureId: z.uuid(),
  name: z.string().min(1),
})

export type DocumentStructureSide = z.infer<typeof documentStructureSideSchema>

export const messageTypeSideSchema = z.object({
  kind: z.literal('messageType'),
  messageType: messageTypeSchema,
})

export type MessageTypeSide = z.infer<typeof messageTypeSideSchema>

export const mappingSideSchema = z.discriminatedUnion('kind', [
  documentStructureSideSchema,
  messageTypeSideSchema,
])

export type MappingSide = z.infer<typeof mappingSideSchema>

// A link copies the value at a source path into a target path, e.g. `buyer.gln` into
// `SG2+BY/NAD+BY/C082/3039`. Combining several sources into one target needs a transform.
export const mappingLinkSchema = z.object({
  sourcePath: z.string().min(1),
  targetPath: z.string().min(1),
})

export type MappingLink = z.infer<typeof mappingLinkSchema>

export const mappingLinksSchema = z
  .array(mappingLinkSchema)
  .refine(
    (links) => new Set(links.map(({ targetPath }) => targetPath)).size === links.length,
    'A target is linked at most once',
  )

const draftFields = {
  mappingId: z.uuid(),
  name: z.string().min(1),
  links: mappingLinksSchema,
  updatedAt: z.iso.datetime(),
}

// Outbound Mappings turn the own systems' Document into EDIFACT, inbound ones the other way.
export const mappingDraftSchema = z.discriminatedUnion('direction', [
  z.object({
    ...draftFields,
    direction: z.literal('outbound'),
    source: documentStructureSideSchema,
    target: messageTypeSideSchema,
  }),
  z.object({
    ...draftFields,
    direction: z.literal('inbound'),
    source: messageTypeSideSchema,
    target: documentStructureSideSchema,
  }),
])

export type MappingDraft = z.infer<typeof mappingDraftSchema>

export const saveMappingLinksBodySchema = z.object({ links: mappingLinksSchema })

export type SaveMappingLinksBody = z.infer<typeof saveMappingLinksBodySchema>

export const mappingsEndpoint: Endpoint<MappingSummary[]> = {
  method: 'GET',
  path: '/mappings',
  response: z.array(mappingSummarySchema),
}

export const mappingDraftEndpoint: Endpoint<
  MappingDraft,
  undefined,
  undefined,
  '/mappings/:id/draft'
> = {
  method: 'GET',
  path: '/mappings/:id/draft',
  response: mappingDraftSchema,
}

export const saveMappingLinksEndpoint: Endpoint<
  MappingDraft,
  undefined,
  SaveMappingLinksBody,
  '/mappings/:id/draft/links'
> = {
  method: 'PUT',
  path: '/mappings/:id/draft/links',
  body: saveMappingLinksBodySchema,
  response: mappingDraftSchema,
}
