import { Effect } from 'effect'
import { PassThrough } from 'node:stream'

import type { FastifyReply } from 'fastify'

import type { LiveEvent } from '@edi-bridge/contracts'
import type { LiveEventListener, LiveEventsService } from '@edi-bridge/pipeline'

export interface LiveEventHub {
  service: LiveEventsService
  subscribe: (workspaceId: string, listener: LiveEventListener) => () => void
}

// Without Redis, the api announces nothing and its streams carry only heartbeats.
export const silentLiveEvents: LiveEventHub = {
  service: { publish: () => Effect.void },
  subscribe: () => () => {},
}

// Cloudflare and Traefik end a response idle for 100 s, so a comment keeps the stream open.
export const defaultHeartbeatMs = 25_000

// Proxies pass the stream on as it is written instead of buffering it.
const eventStreamHeaders = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
}

const frame = (event: LiveEvent) => `data:${JSON.stringify(event)}\n\n`

export function liveEventStreams(hub: LiveEventHub, heartbeatMs: number) {
  const open = new Set<() => void>()

  return {
    stream: (reply: FastifyReply, workspaceId: string) => {
      const stream = new PassThrough()

      const unsubscribe = hub.subscribe(workspaceId, (event) => {
        stream.write(frame(event))
      })

      const heartbeat = setInterval(() => {
        stream.write(':heartbeat\n\n')
      }, heartbeatMs)

      const end = () => {
        clearInterval(heartbeat)
        unsubscribe()
        open.delete(end)
        stream.end()
      }

      open.add(end)
      reply.raw.once('close', end)

      // The first bytes make proxies forward the headers at once.
      stream.write(':connected\n\n')

      return reply.headers(eventStreamHeaders).send(stream)
    },
    // A closing server waits for open responses, so it ends every stream first.
    endAll: () => {
      for (const end of open) {
        end()
      }
    },
  }
}
