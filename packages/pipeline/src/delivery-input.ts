import { z } from 'zod'

const segmentSchema = z.object({ tag: z.string(), elements: z.array(z.array(z.string())) })

export const deliveryInputSchema = z.object({
  header: segmentSchema,
  segments: z.array(segmentSchema),
  trailer: segmentSchema,
})
