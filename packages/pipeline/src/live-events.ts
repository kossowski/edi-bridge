import { Context, Effect } from 'effect'

import type { LiveEvent } from '@edi-bridge/contracts'

import { runSummariesOf } from './run-summary'
import { Database } from './services'

export type PublishedLiveEvent = { workspaceId: string; event: LiveEvent }

export type LiveEventsService = {
  publish: (published: PublishedLiveEvent) => Effect.Effect<void>
}

// Where no publisher is provided, Run changes go unannounced.
export const LiveEvents = Context.Reference<LiveEventsService>('@edi-bridge/pipeline/LiveEvents', {
  defaultValue: () => ({ publish: () => Effect.void }),
})

// A live event only hurries a refresh, so a change that fails to publish never fails the Run.
export const publishRunChanges = (runIds: readonly string[]) =>
  Effect.gen(function* () {
    if (runIds.length === 0) {
      return
    }

    const db = yield* Database
    const live = yield* LiveEvents
    const summaries = yield* Effect.promise(() => runSummariesOf(db, runIds))

    yield* Effect.forEach(
      summaries,
      ({ workspaceId, run }) => live.publish({ workspaceId, event: { type: 'run.changed', run } }),
      // Concurrently, so an outage delays the caller by one publish timeout, not one per Run.
      { concurrency: 'unbounded', discard: true },
    )
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning(`Changes of Runs ${runIds.join(', ')} not published`, cause),
    ),
  )
