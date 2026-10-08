import type { z } from 'zod'

export interface Endpoint<Response> {
  method: 'GET'
  path: string
  response: z.ZodType<Response>
}
