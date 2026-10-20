import { type Duration, Effect, Schedule } from 'effect'

import { sendAcknowledgements } from './acknowledgement'
import { markOverdueInterchanges } from './mark-overdue-interchanges'
import { queueReceivedRuns } from './queue-received-runs'
import { sweepStuckRuns } from './sweep-stuck-runs'

// A failed sweep leaves its Runs as they are, and the next one tries them again.
export const sweepRunsEvery = ({
  interval,
  stuckAfter,
}: {
  interval: Duration.Input
  stuckAfter: Duration.Input
}) =>
  Effect.all(
    [
      sweepStuckRuns(stuckAfter).pipe(
        Effect.catchCause((cause) => Effect.logError('Stuck Runs not swept', cause)),
      ),
      queueReceivedRuns.pipe(
        Effect.catchCause((cause) => Effect.logError('Received Runs not queued', cause)),
      ),
      markOverdueInterchanges.pipe(
        Effect.catchCause((cause) => Effect.logError('Overdue Interchanges not marked', cause)),
      ),
      // A CONTRL attempt older than the bound of a stuck Run was cut off or failed.
      sendAcknowledgements(stuckAfter).pipe(
        Effect.catchCause((cause) => Effect.logError('CONTRLs not sent', cause)),
      ),
    ],
    { discard: true },
  ).pipe(Effect.repeat(Schedule.spaced(interval)))
