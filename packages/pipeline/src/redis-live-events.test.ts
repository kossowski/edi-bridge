import { Effect } from 'effect'
import { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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

describe('live events over Redis', () => {
  it('hands a subscriber the live events of its Workspace only', async () => {
    const publisher = redisLiveEvents(redis.url)
    const subscriber = liveEventSubscriber(redis.url)
    const workspaceId = randomUUID()
    const received: unknown[] = []

    try {
      await subscriber.ready
      subscriber.subscribe(workspaceId, (event) => received.push(event))

      const other = changed(runOf('received'))
      const own = changed(runOf('delivered'))

      await Effect.runPromise(
        publisher.service.publish({ workspaceId: randomUUID(), event: other }),
      )
      await Effect.runPromise(publisher.service.publish({ workspaceId, event: own }))

      await vi.waitFor(() => {
        expect(received).toEqual([own])
      })
    } finally {
      publisher.close()
      subscriber.close()
    }
  })

  it('stops handing live events to a subscriber that unsubscribed', async () => {
    const publisher = redisLiveEvents(redis.url)
    const subscriber = liveEventSubscriber(redis.url)
    const workspaceId = randomUUID()
    const left: unknown[] = []
    const staying: unknown[] = []

    try {
      await subscriber.ready
      const unsubscribe = subscriber.subscribe(workspaceId, (event) => left.push(event))
      subscriber.subscribe(workspaceId, (event) => staying.push(event))

      unsubscribe()

      const event = changed(runOf('received'))

      await Effect.runPromise(publisher.service.publish({ workspaceId, event }))

      await vi.waitFor(() => {
        expect(staying).toEqual([event])
      })
      expect(left).toEqual([])
    } finally {
      publisher.close()
      subscriber.close()
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
      await subscriber.ready
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
      })
      expect(warn).toHaveBeenCalledTimes(2)
    } finally {
      warn.mockRestore()
      other.disconnect()
      publisher.close()
      subscriber.close()
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
