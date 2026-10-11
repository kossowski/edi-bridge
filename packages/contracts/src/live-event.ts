import { z } from 'zod'

import { type EventStreamEndpoint, parseStreamEvent } from './endpoint'
import { runSummarySchema } from './run'

export const runChangedEventSchema = z.object({
  type: z.literal('run.changed'),
  run: runSummarySchema,
})

export type RunChangedEvent = z.infer<typeof runChangedEventSchema>

export const liveEventSchema = z.discriminatedUnion('type', [runChangedEventSchema])

export type LiveEvent = z.infer<typeof liveEventSchema>

export type LiveEventType = LiveEvent['type']

export const liveEventsEndpoint: EventStreamEndpoint<LiveEvent> = {
  path: '/events',
  event: liveEventSchema,
}

export function parseLiveEvent(data: string): LiveEvent | null {
  return parseStreamEvent(liveEventsEndpoint, data)
}
