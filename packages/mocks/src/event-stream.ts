import type { z } from 'zod'

const encoder = new TextEncoder()

export const eventStreamOpened = encoder.encode(': connected\n\n')

export const eventStreamHeaders = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
}

export function eventFrame<Event>(endpoint: { event: z.ZodType<Event> }, event: Event) {
  return encoder.encode(`data:${JSON.stringify(endpoint.event.parse(event))}\n\n`)
}
