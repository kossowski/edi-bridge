import { z } from 'zod'

import { controlReferenceSchema } from './edifact'
import { directionSchema, runSummarySchema } from './run'

import type { Endpoint } from './endpoint'

export const interchangePartySchema = z.object({
  gln: z.string().regex(/^\d{13}$/),
  name: z.string().min(1),
})

export type InterchangeParty = z.infer<typeof interchangePartySchema>

export const interchangeSchema = z.object({
  id: z.uuid(),
  controlReference: controlReferenceSchema,
  direction: directionSchema,
  sender: interchangePartySchema,
  receiver: interchangePartySchema,
  raw: z.string().min(1),
  runs: z.array(runSummarySchema),
})

export type Interchange = z.infer<typeof interchangeSchema>

export const interchangeEndpoint: Endpoint<Interchange, undefined, undefined, '/interchanges/:id'> =
  {
    method: 'GET',
    path: '/interchanges/:id',
    response: interchangeSchema,
  }
