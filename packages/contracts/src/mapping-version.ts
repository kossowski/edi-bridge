import { z } from 'zod'

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
