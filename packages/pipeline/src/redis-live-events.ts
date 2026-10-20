import { type Duration, Effect } from 'effect'
import { Redis } from 'ioredis'
import { z } from 'zod'

import { type LiveEvent, liveEventSchema } from '@edi-bridge/contracts'

import type { LiveEventsService } from './live-events'

export const liveEventsChannel = 'live-events'

const publishedLiveEventSchema = z
  .string()
  .transform((message, context) => {
    try {
      const parsed: unknown = JSON.parse(message)

      return parsed
    } catch {
      context.addIssue({ code: 'custom', message: 'The message is no JSON' })

      return z.NEVER
    }
  })
  .pipe(z.object({ workspaceId: z.uuid(), event: liveEventSchema }))

export function redisLiveEvents(
  redisUrl: string,
  { timeout = '5 seconds' }: { timeout?: Duration.Input } = {},
) {
  // During an outage a publish fails at once instead of waiting in a queue for Redis to return.
  const redis = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })

  // A failed publish reports the outage itself, so ioredis need not log it too.
  redis.on('error', () => {})

  const service: LiveEventsService = {
    publish: (published) =>
      Effect.tryPromise(() => redis.publish(liveEventsChannel, JSON.stringify(published))).pipe(
        Effect.timeout(timeout),
        Effect.catchCause((cause) =>
          Effect.logWarning(
            `Live event for Workspace ${published.workspaceId} not published`,
            cause,
          ),
        ),
        Effect.asVoid,
      ),
  }

  return {
    service,
    close: () => {
      redis.disconnect()
    },
  }
}

export type LiveEventListener = (event: LiveEvent) => void

export function liveEventSubscriber(redisUrl: string) {
  // The subscription waits for Redis to come up, and ioredis renews it after a reconnect.
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const listeners = new Map<string, Set<LiveEventListener>>()

  redis.on('error', (error: NodeJS.ErrnoException) => {
    console.warn(`live event subscriber redis error: ${error.code ?? error.message}`)
  })

  redis.on('message', (_channel: string, message: string) => {
    const published = publishedLiveEventSchema.safeParse(message)

    if (!published.success) {
      console.warn(`live event dropped: ${z.prettifyError(published.error)}`)

      return
    }

    for (const listener of listeners.get(published.data.workspaceId) ?? []) {
      try {
        listener(published.data.event)
      } catch (error) {
        console.warn(
          `live event listener failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  })

  const ready = redis.subscribe(liveEventsChannel).then(() => undefined)

  return {
    ready,
    subscribe: (workspaceId: string, listener: LiveEventListener) => {
      const ofWorkspace = listeners.get(workspaceId) ?? new Set()

      ofWorkspace.add(listener)
      listeners.set(workspaceId, ofWorkspace)

      return () => {
        ofWorkspace.delete(listener)

        if (ofWorkspace.size === 0) {
          listeners.delete(workspaceId)
        }
      }
    },
    close: () => {
      listeners.clear()
      redis.disconnect()
    },
  }
}
