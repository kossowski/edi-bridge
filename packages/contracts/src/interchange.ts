import { z } from 'zod'

import { controlReferenceSchema } from './edifact'
import { directionSchema, messageTypeSchema } from './message-type'
import { many, runSummarySchema } from './run'
import { tradingPartnerSummarySchema } from './trading-partner'

import type { Endpoint } from './endpoint'

export const interchangePartySchema = z.object({
  gln: z.string().regex(/^\d{13}$/),
  name: z.string().min(1),
})

export type InterchangeParty = z.infer<typeof interchangePartySchema>

export const interchangeRunSchema = runSummarySchema.and(
  z.object({ messageReference: z.string().min(1).max(14) }),
)

export type InterchangeRun = z.infer<typeof interchangeRunSchema>

export const interchangeSchema = z.object({
  id: z.uuid(),
  controlReference: controlReferenceSchema,
  direction: directionSchema,
  sender: interchangePartySchema,
  receiver: interchangePartySchema,
  raw: z.string().min(1),
  runs: z.array(interchangeRunSchema),
})

export type Interchange = z.infer<typeof interchangeSchema>

export const interchangeEndpoint: Endpoint<Interchange, undefined, undefined, '/interchanges/:id'> =
  {
    method: 'GET',
    path: '/interchanges/:id',
    response: interchangeSchema,
  }

export const interchangeSummarySchema = z.object({
  id: z.uuid(),
  controlReference: controlReferenceSchema,
  direction: directionSchema,
  tradingPartner: tradingPartnerSummarySchema,
  preparedAt: z.iso.datetime(),
  runs: z.array(runSummarySchema).min(1),
})

export type InterchangeSummary = z.infer<typeof interchangeSummarySchema>

export const interchangeListQuerySchema = z.object({
  tradingPartnerId: many(z.uuid()),
  messageType: many(messageTypeSchema),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export type InterchangeListQuery = z.output<typeof interchangeListQuerySchema>

export const interchangeListSchema = z.object({
  interchanges: z.array(interchangeSummarySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
})

export type InterchangeList = z.infer<typeof interchangeListSchema>

export const interchangesEndpoint: Endpoint<InterchangeList, InterchangeListQuery> = {
  method: 'GET',
  path: '/interchanges',
  query: interchangeListQuerySchema,
  response: interchangeListSchema,
}
