import { Effect } from 'effect'
import { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { setImmediate } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { RunSummary } from '@edi-bridge/contracts'

import { liveEventsChannel, liveEventSubscriber, redisLiveEvents } from './index'
import { startTestRedis, type TestRedis } from './testing'

let redis: TestRedis

beforeAll(async () => {
  redis = await startTestRedis()
}, 120_000)

afterAll(async () => {
  await redis.stop()
})

const runOf = (status: 'received' | 'delivered'): RunSummary => ({
  id: randomUUID(),
  receivedAt: '2026-10-20T08:00:00.000Z',
  tradingPartner: { id: randomUUID(), name: 'Hanse Retail' },
  messageType: 'INVOIC',
  direction: 'outbound',
  flow: { id: randomUUID(), name: 'Invoices to Hanse Retail' },
  manualSubmission: false,
  businessReference: null,
  interchange: null,
  status,
  failureStage: null,
  problem: null,
})

const changed = (run: RunSummary) => ({ type: 'run.changed' as const, run })

// Under parallel test load delivery can exceed vitest's 1 s default; 2 s stays well under the 5 s test timeout.
const delivery = { timeout: 2_000 }

describe('live events over Redis', () => {
  it('hands a subscriber the live events of its Workspace only', async () => {
    const publisher = redisLiveEvents(redis.url)
    const subscriber = liveEventSubscriber(redis.url)
    const workspaceId = randomUUID()
    const received: unknown[] = []

    try {
      await Promise.all([publisher.ready, subscriber.ready])
      subscriber.subscribe(workspaceId, (event) => received.push(event))

      const other = changed(runOf('received'))
      const own = changed(runOf('delivered'))

      await Effect.runPromise(
        publisher.service.publish({ workspaceId: randomUUID(), event: other }),
      )
      await Effect.runPromise(publisher.service.publish({ workspaceId, event: own }))

      await vi.waitFor(() => {
        expect(received).toEqual([own])
      }, delivery)
    } finally {
      publisher.close()
      await subscriber.close()
    }
  })

  it('stops handing live events to a subscriber that unsubscribed', async () => {
    const publisher = redisLiveEvents(redis.url)
    const subscriber = liveEventSubscriber(redis.url)
    const workspaceId = randomUUID()
    const left: unknown[] = []
    const staying: unknown[] = []

    try {
      await Promise.all([publisher.ready, subscriber.ready])
      const unsubscribe = subscriber.subscribe(workspaceId, (event) => left.push(event))
      subscriber.subscribe(workspaceId, (event) => staying.push(event))

      unsubscribe()

      const event = changed(runOf('received'))

      await Effect.runPromise(publisher.service.publish({ workspaceId, event }))

      await vi.waitFor(() => {
        expect(staying).toEqual([event])
      }, delivery)
      expect(left).toEqual([])
    } finally {
      publisher.close()
      await subscriber.close()
    }
  })

  it('hands a live event to every listener of the Workspace when one of them throws', async () => {
    const publisher = redisLiveEvents(redis.url)
    const subscriber = liveEventSubscriber(redis.url)
    const workspaceId = randomUUID()
    const received: unknown[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await Promise.all([publisher.ready, subscriber.ready])
      subscriber.subscribe(workspaceId, () => {
        throw new Error('The stream is closed')
      })
      subscriber.subscribe(workspaceId, (event) => received.push(event))

      const event = changed(runOf('received'))

      await Effect.runPromise(publisher.service.publish({ workspaceId, event }))

      await vi.waitFor(() => {
        expect(received).toEqual([event])
      }, delivery)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('The stream is closed'))
    } finally {
      warn.mockRestore()
      publisher.close()
      await subscriber.close()
    }
  })

  it('skips a message that is no live event and hands on the next', async () => {
    const publisher = redisLiveEvents(redis.url)
    const subscriber = liveEventSubscriber(redis.url)
    const other = new Redis(redis.url)
    const workspaceId = randomUUID()
    const received: unknown[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await Promise.all([publisher.ready, subscriber.ready])
      subscriber.subscribe(workspaceId, (event) => received.push(event))

      await other.publish(liveEventsChannel, 'not json')
      await other.publish(
        liveEventsChannel,
        JSON.stringify({ workspaceId, event: { type: 'run.gone' } }),
      )

      const event = changed(runOf('received'))

      await Effect.runPromise(publisher.service.publish({ workspaceId, event }))

      await vi.waitFor(() => {
        expect(received).toEqual([event])
      }, delivery)
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
      other.disconnect()
      publisher.close()
      await subscriber.close()
    }
  })

  it('closes a subscriber before its subscription is ready without an unhandled rejection', async () => {
    let unhandled = 0

    const record = () => {
      unhandled += 1
    }

    process.on('unhandledRejection', record)

    try {
      await liveEventSubscriber(redis.url).close()

      // Node reports an unhandled rejection only after the turn in which it happened.
      await setImmediate()

      expect(unhandled).toBe(0)
    } finally {
      process.off('unhandledRejection', record)
    }
  })

  it('drops a live event at once while Redis does not answer', async () => {
    const silent = createServer(() => {})

    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))

    const { port } = z.object({ port: z.number() }).parse(silent.address())
    const publisher = redisLiveEvents(`redis://127.0.0.1:${port}`)
    const startedAt = Date.now()

    try {
      await Effect.runPromise(
        publisher.service.publish({
          workspaceId: randomUUID(),
          event: changed(runOf('received')),
        }),
      )

      expect(Date.now() - startedAt).toBeLessThan(1_000)
    } finally {
      publisher.close()
      silent.close()
    }
  })

  it('drops a live event when Redis is unreachable instead of failing', async () => {
    const publisher = redisLiveEvents('redis://127.0.0.1:1', { timeout: '200 millis' })

    try {
      await expect(
        Effect.runPromise(
          publisher.service.publish({
            workspaceId: randomUUID(),
            event: changed(runOf('received')),
          }),
        ),
      ).resolves.toBeUndefined()
    } finally {
      publisher.close()
    }
  })
})
