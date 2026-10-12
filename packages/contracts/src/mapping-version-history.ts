import { z } from 'zod'

import { flowSummarySchema } from './flow'
import { mappingVersionSummarySchema } from './mapping-version'
import { sessionUserSchema } from './session'
import { tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'

export const pinnedFlowSchema = flowSummarySchema.pick({ id: true, name: true }).extend({
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
