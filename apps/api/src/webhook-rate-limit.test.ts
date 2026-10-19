import { Redis } from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startTestRedis, type TestRedis } from '@edi-bridge/pipeline/testing'

import {
  memoryWebhookRateLimiter,
  redisWebhookRateLimiter,
  type WebhookRateLimiter,
} from './webhook-rate-limit.js'

const takeTimes = async (
  limiter: WebhookRateLimiter,
  channelId: string,
  limit: number,
  times: number,
) => {
  const decisions = []

  for (let taken = 0; taken < times; taken += 1) {
    decisions.push(await limiter.take(channelId, limit))
  }

  return decisions
}

describe('redisWebhookRateLimiter', () => {
  let testRedis: TestRedis
  let redis: Redis

  beforeAll(async () => {
    testRedis = await startTestRedis()
    redis = new Redis(testRedis.url)
  }, 60_000)

  afterAll(async () => {
    redis.disconnect()
    await testRedis.stop()
  })

  it('allows a Channel up to its limit per minute and rejects it after, with the rest of the window', async () => {
    const limiter = redisWebhookRateLimiter(redis)

    const decisions = await takeTimes(limiter, 'channel-a', 2, 3)

    expect(decisions.slice(0, 2)).toEqual([{ allowed: true }, { allowed: true }])
    expect(decisions[2]).toEqual({ allowed: false, retryAfterSeconds: 60 })
  })

  it('shares the count between api instances and keeps Channels apart', async () => {
    const first = redisWebhookRateLimiter(redis)
    const otherConnection = new Redis(testRedis.url)
    const second = redisWebhookRateLimiter(otherConnection)

    expect(await first.take('channel-b', 1)).toEqual({ allowed: true })
    expect(await second.take('channel-b', 1)).toMatchObject({ allowed: false })
    expect(await second.take('channel-c', 1)).toEqual({ allowed: true })

    otherConnection.disconnect()
  })
})

describe('memoryWebhookRateLimiter', () => {
  it('opens a new window a minute after the first request of the last one', async () => {
    let now = 0
    const limiter = memoryWebhookRateLimiter(() => now)

    await limiter.take('channel-a', 1)
    now = 59_500

    expect(await limiter.take('channel-a', 1)).toEqual({ allowed: false, retryAfterSeconds: 1 })

    now = 60_000

    expect(await limiter.take('channel-a', 1)).toEqual({ allowed: true })
  })
})
