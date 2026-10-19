import { Context } from 'effect'
import { z } from 'zod'

import type { Redis } from 'ioredis'

const windowMs = 60_000

const countInWindow = `
redis.call('SET', KEYS[1], 0, 'PX', ARGV[1], 'NX')
return { redis.call('INCR', KEYS[1]), redis.call('PTTL', KEYS[1]) }
`

const countedWindowSchema = z.tuple([z.number(), z.number()])

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number }

export interface WebhookRateLimiter {
  take: (channelId: string, limitPerMinute: number) => Promise<RateLimitDecision>
}

export class WebhookRateLimit extends Context.Service<WebhookRateLimit, WebhookRateLimiter>()(
  'WebhookRateLimit',
) {}

const decide = (count: number, limitPerMinute: number, remainingMs: number): RateLimitDecision =>
  count <= limitPerMinute
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) }

// One script call opens the window and counts in it atomically, for every api instance.
export function redisWebhookRateLimiter(redis: Redis): WebhookRateLimiter {
  return {
    take: async (channelId, limitPerMinute) => {
      const key = `webhook-rate-limit:${channelId}`

      const [count, remainingMs] = countedWindowSchema.parse(
        await redis.eval(countInWindow, 1, key, windowMs),
      )

      return decide(count, limitPerMinute, remainingMs)
    },
  }
}

export function memoryWebhookRateLimiter(now: () => number = Date.now): WebhookRateLimiter {
  const windows = new Map<string, { count: number; endsAt: number }>()

  return {
    take: (channelId, limitPerMinute) => {
      const at = now()
      const open = windows.get(channelId)

      const window =
        open !== undefined && open.endsAt > at ? open : { count: 0, endsAt: at + windowMs }

      window.count += 1
      windows.set(channelId, window)

      return Promise.resolve(decide(window.count, limitPerMinute, window.endsAt - at))
    },
  }
}
