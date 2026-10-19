import { Queue } from 'bullmq'
import { type Duration, Effect } from 'effect'
import { Redis } from 'ioredis'

import { RunNotQueued } from './errors'

import type { QueuedRun, RunQueueService } from './services'

export const runQueueName = 'runs'

// Without the offline queue, an unreachable Redis fails the enqueue instead of holding it.
export function bullmqRunQueue(
  redisUrl: string,
  { timeout = '5 seconds' }: { timeout?: Duration.Input } = {},
) {
  const redis = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })

  redis.on('error', () => {})

  const queue = new Queue<QueuedRun>(runQueueName, { connection: redis })

  const service: RunQueueService = {
    enqueue: (run) =>
      Effect.tryPromise({
        // The Run id as job id keeps a Run queued twice from being processed twice.
        try: () => queue.add('process', run, { jobId: run.runId, removeOnComplete: true }),
        catch: (cause) => new RunNotQueued({ runId: run.runId, cause }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.fail(new RunNotQueued({ runId: run.runId, cause: 'timeout' })),
        }),
        Effect.asVoid,
      ),
  }

  return {
    service,
    close: async () => {
      await queue.close()
      redis.disconnect()
    },
  }
}
