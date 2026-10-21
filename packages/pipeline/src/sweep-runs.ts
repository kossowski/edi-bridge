import { type Duration, Effect, Schedule } from 'effect'

import { sendAcknowledgements } from './acknowledgement'
import { defectSource } from './defect-report'
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

// Each step is a source of its own, so a defect of one step is reported apart from the others.
const sweepStep = <E, R>(step: Effect.Effect<void, E, R>, message: string) => {
  const defects = defectSource(sweepDefect)

  return step.pipe(defects.succeeding, Effect.catchCause(defects.logAndReport(message)))
}

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
      sweepStep(sweepStuckRuns(stuckAfter), 'Stuck Runs not swept'),
      sweepStep(queueReceivedRuns, 'Received Runs not queued'),
      sweepStep(markOverdueInterchanges, 'Overdue Interchanges not marked'),
      // A CONTRL attempt older than the bound of a stuck Run was cut off or failed.
      sweepStep(sendAcknowledgements(stuckAfter), 'CONTRLs not sent'),
      sweepStep(deleteExpiredDocuments, 'Expired Documents not deleted'),
    ],
    { discard: true },
  ).pipe(Effect.repeat(Schedule.spaced(interval)))
