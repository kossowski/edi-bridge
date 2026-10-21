import { type Duration, Effect, Schedule } from 'effect'

import { sendAcknowledgements } from './acknowledgement'
import { logAndReportDefect } from './defect-report'
import { deleteExpiredDocuments } from './delete-expired-documents'
import { markOverdueInterchanges } from './mark-overdue-interchanges'
import { queueReceivedRuns } from './queue-received-runs'
import { sweepStuckRuns } from './sweep-stuck-runs'

const sweepDefect = {
  workspaceId: null,
  runId: null,
  tradingPartnerId: null,
  channelId: null,
  code: 'sweepDefect',
} as const

const logAndReport = (message: string) => logAndReportDefect(sweepDefect, message)

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
      sweepStuckRuns(stuckAfter).pipe(Effect.catchCause(logAndReport('Stuck Runs not swept'))),
      queueReceivedRuns.pipe(Effect.catchCause(logAndReport('Received Runs not queued'))),
      markOverdueInterchanges.pipe(
        Effect.catchCause(logAndReport('Overdue Interchanges not marked')),
      ),
      // A CONTRL attempt older than the bound of a stuck Run was cut off or failed.
      sendAcknowledgements(stuckAfter).pipe(Effect.catchCause(logAndReport('CONTRLs not sent'))),
      deleteExpiredDocuments.pipe(Effect.catchCause(logAndReport('Expired Documents not deleted'))),
    ],
    { discard: true },
  ).pipe(Effect.repeat(Schedule.spaced(interval)))
