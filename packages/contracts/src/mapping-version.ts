import { z } from 'zod'

import { messageTypeSchema } from './message-type'

import type { Endpoint } from './endpoint'

export const mappingVersionSummarySchema = z.object({
  id: z.uuid(),
  mappingId: z.uuid(),
  mappingName: z.string().min(1),
  version: z.number().int().min(1),
  publishedAt: z.iso.datetime(),
})

export type MappingVersionSummary = z.infer<typeof mappingVersionSummarySchema>

export const mappingVersionsEndpoint: Endpoint<
  MappingVersionSummary[],
  undefined,
  undefined,
  '/mappings/:mappingId/versions'
> = {
  method: 'GET',
  path: '/mappings/:mappingId/versions',
  response: z.array(mappingVersionSummarySchema),
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
