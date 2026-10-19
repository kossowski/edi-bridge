import { Queue } from 'bullmq'
import { type Duration, Effect } from 'effect'
import { Redis } from 'ioredis'

import { RunNotQueued } from './errors'

import type { QueuedRun, RunQueueService } from './services'

export const runQueueName = 'runs'

export function bullmqRunQueue(
  redisUrl: string,
  { timeout = '5 seconds' }: { timeout?: Duration.Input } = {},
) {
  // Without the offline queue, an unreachable Redis fails the enqueue instead of holding it.
  const redis = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })

  // A failed enqueue reports the outage as RunNotQueued, so ioredis need not log it too.
  redis.on('error', () => {})

  const queue = new Queue<QueuedRun>(runQueueName, { connection: redis })

  const service: RunQueueService = {
    enqueue: (run) =>
      Effect.tryPromise({
        try: async () => {
          const died = await queue.getJob(run.runId)

          // A Run that died keeps its failed job, which would swallow the job of its Retry.
          if (died !== undefined && (await died.isFailed())) {
            await died.remove()
          }

          // The Run id as job id keeps a Run queued twice from being processed twice.
          return queue.add('process', run, { jobId: run.runId, removeOnComplete: true })
        },
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
