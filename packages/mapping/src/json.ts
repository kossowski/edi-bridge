import { z } from 'zod'

import { jsonContentSchema } from '@edi-bridge/contracts'

export const jsonObjectSchema = z.record(z.string(), jsonContentSchema)

export const jsonListSchema = z.array(jsonContentSchema)
