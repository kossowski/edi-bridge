import { z } from 'zod'

import {
  checkGraph,
  graphFields,
  inboundSides,
  type MappingDraft,
  mappingDraftSchema,
  mappingLinkSchema,
  outboundSides,
} from './mapping'
import { documentContentSchema, previewNoteSchema } from './mapping-preview'
import { messageTypeSchema } from './message-type'
import { sessionUserSchema } from './session'
import { tradingPartnerSummarySchema } from './trading-partner'
import { mappingTransformSchema, transformLinkSchema } from './transform'

import type { Endpoint } from './endpoint'

export const mappingVersionSummarySchema = z.object({
  id: z.uuid(),
  mappingId: z.uuid(),
  mappingName: z.string().min(1),
  version: z.number().int().min(1),
  publishedAt: z.iso.datetime(),
})

export type MappingVersionSummary = z.infer<typeof mappingVersionSummarySchema>

export const pinnedFlowSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  tradingPartner: tradingPartnerSummarySchema,
})

export type PinnedFlow = z.infer<typeof pinnedFlowSchema>

export const mappingVersionEntrySchema = mappingVersionSummarySchema.extend({
  changeNote: z.string().min(1).nullable(),
  publishedBy: sessionUserSchema.pick({ id: true, name: true }),
  flows: z.array(pinnedFlowSchema),
})

export type MappingVersionEntry = z.infer<typeof mappingVersionEntrySchema>

export const mappingVersionsEndpoint: Endpoint<
  MappingVersionEntry[],
  undefined,
  undefined,
  '/mappings/:mappingId/versions'
> = {
  method: 'GET',
  path: '/mappings/:mappingId/versions',
  response: z.array(mappingVersionEntrySchema),
}

export const publishedMappingVersionsQuerySchema = z.object({
  messageType: messageTypeSchema.optional(),
})

export type PublishedMappingVersionsQuery = z.infer<typeof publishedMappingVersionsQuerySchema>

export const publishedMappingVersionsEndpoint: Endpoint<
  MappingVersionSummary[],
  PublishedMappingVersionsQuery
> = {
  method: 'GET',
  path: '/mapping-versions',
  query: publishedMappingVersionsQuerySchema,
  response: z.array(mappingVersionSummarySchema),
}

const summaryFields = mappingVersionSummarySchema.shape

export const mappingVersionSchema = z
  .discriminatedUnion('direction', [
    z.object({ ...summaryFields, ...graphFields, ...outboundSides }),
    z.object({ ...summaryFields, ...graphFields, ...inboundSides }),
  ])
  .superRefine(checkGraph)

export type MappingVersion = z.infer<typeof mappingVersionSchema>

export const mappingVersionEndpoint: Endpoint<
  MappingVersion,
  undefined,
  undefined,
  '/mappings/:mappingId/versions/:versionId'
> = {
  method: 'GET',
  path: '/mappings/:mappingId/versions/:versionId',
  response: mappingVersionSchema,
}

export const maxChangeNoteLength = 500

export const publishMappingDraftBodySchema = z.object({
  changeNote: z.string().trim().max(maxChangeNoteLength),
  moveFlowIds: z
    .array(z.uuid())
    .default([])
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each Flow is chosen once' }),
})

export type PublishMappingDraftBody = z.infer<typeof publishMappingDraftBodySchema>

export const publishMappingDraftEndpoint: Endpoint<
  MappingVersionEntry,
  undefined,
  PublishMappingDraftBody,
  '/mappings/:mappingId/versions'
> = {
  method: 'POST',
  path: '/mappings/:mappingId/versions',
  body: publishMappingDraftBodySchema,
  response: mappingVersionEntrySchema,
}

export const restoreMappingVersionEndpoint: Endpoint<
  MappingDraft,
  undefined,
  undefined,
  '/mappings/:mappingId/versions/:versionId/restore'
> = {
  method: 'POST',
  path: '/mappings/:mappingId/versions/:versionId/restore',
  response: mappingDraftSchema,
}

export const differenceChanges = ['added', 'removed', 'changed'] as const

export type DifferenceChange = (typeof differenceChanges)[number]

function differenceOf<Kind extends string, Part extends z.ZodType>(kind: Kind, part: Part) {
  return z.object({
    kind: z.literal(kind),
    change: z.enum(differenceChanges),
    before: part.nullable(),
    after: part.nullable(),
  })
}

const presentSides = {
  added: { before: false, after: true },
  removed: { before: true, after: false },
  changed: { before: true, after: true },
} as const satisfies Record<DifferenceChange, { before: boolean; after: boolean }>

// Links are matched by their target, transforms by their id; a moved transform is no difference.
export const mappingDifferenceSchema = z
  .discriminatedUnion('kind', [
    differenceOf('link', mappingLinkSchema),
    differenceOf('transform', mappingTransformSchema),
    differenceOf('transformLink', transformLinkSchema),
  ])
  .refine(
    ({ change, before, after }) =>
      (before !== null) === presentSides[change].before &&
      (after !== null) === presentSides[change].after,
    { message: 'Only a removed part lacks an after, only an added part lacks a before' },
  )
  .refine(({ kind, change }) => kind !== 'transformLink' || change !== 'changed', {
    message: 'A transform link is added or removed, never changed',
  })

export type MappingDifference = z.infer<typeof mappingDifferenceSchema>

export const outputDifferenceSchema = z
  .object({
    path: z.string().min(1),
    repetitions: z.array(z.number().int().min(0)),
    before: z.string().nullable(),
    after: z.string().nullable(),
  })
  .refine(({ before, after }) => before !== after, {
    message: 'An output difference changes the value',
  })

export type OutputDifference = z.infer<typeof outputDifferenceSchema>

export const versionOutputSchema = z.object({
  document: documentContentSchema,
  notes: z.array(previewNoteSchema),
})

export type VersionOutput = z.infer<typeof versionOutputSchema>

export const comparisonOutputsSchema = z.object({
  sampleId: z.uuid(),
  from: versionOutputSchema,
  to: versionOutputSchema,
  differences: z.array(outputDifferenceSchema),
})

export type ComparisonOutputs = z.infer<typeof comparisonOutputsSchema>

export const mappingComparisonSchema = z
  .object({
    mappingId: z.uuid(),
    from: mappingVersionSummarySchema,
    to: mappingVersionSummarySchema,
    differences: z.array(mappingDifferenceSchema),
    outputs: comparisonOutputsSchema.nullable(),
  })
  .refine(({ mappingId, from, to }) => from.mappingId === mappingId && to.mappingId === mappingId, {
    message: 'Both versions belong to the compared Mapping',
  })
  .refine(({ from, to }) => from.id !== to.id, { message: 'Two different versions are compared' })

export type MappingComparison = z.infer<typeof mappingComparisonSchema>

export const mappingComparisonQuerySchema = z
  .object({
    from: z.uuid(),
    to: z.uuid(),
    sampleId: z.uuid().optional(),
  })
  .refine(({ from, to }) => from !== to, { message: 'Two different versions are compared' })

export type MappingComparisonQuery = z.infer<typeof mappingComparisonQuerySchema>

export const mappingComparisonEndpoint: Endpoint<
  MappingComparison,
  MappingComparisonQuery,
  undefined,
  '/mappings/:mappingId/comparison'
> = {
  method: 'GET',
  path: '/mappings/:mappingId/comparison',
  query: mappingComparisonQuerySchema,
  response: mappingComparisonSchema,
}
