import { z } from 'zod'

import { runSummarySchema } from './run'

export const runChangedEventSchema = z.object({
  type: z.literal('run.changed'),
  run: runSummarySchema,
})

export type RunChangedEvent = z.infer<typeof runChangedEventSchema>

export const liveEventSchema = z.discriminatedUnion('type', [runChangedEventSchema])

export type LiveEvent = z.infer<typeof liveEventSchema>

export type LiveEventType = LiveEvent['type']

export type EventStreamEndpoint<Event> = {
  method: 'GET'
  path: string
  event: z.ZodType<Event>
}

export const liveEventsEndpoint: EventStreamEndpoint<LiveEvent> = {
  method: 'GET',
  path: '/events',
  event: liveEventSchema,
}

export function parseLiveEvent(data: string): LiveEvent | null {
  let json: unknown

  try {
    json = JSON.parse(data)
  } catch {
    return null
  }

  const event = liveEventSchema.safeParse(json)

  return event.success ? event.data : null
}
