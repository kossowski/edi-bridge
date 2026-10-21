import { Cause, Context, Effect, Result } from 'effect'

export type DefectCode =
  | 'processingDefect'
  | 'channelDefect'
  | 'deliveryDefect'
  | 'sweepDefect'
  | 'pollingDefect'

export type DefectCause = { name: string; frames: string[] }

// A defect of a poll or the sweep has no Run, and one of the whole polling loop no Workspace either.
export type DefectReport = {
  workspaceId: string | null
  runId: string | null
  tradingPartnerId: string | null
  channelId: string | null
  code: DefectCode
  cause: DefectCause
}

export type RunDefectIds = { workspaceId: string; runId: string; tradingPartnerId: string | null }

export type DefectReporterService = {
  report: (report: DefectReport) => Effect.Effect<void>
}

export const DefectReporter = Context.Reference<DefectReporterService>(
  '@edi-bridge/pipeline/DefectReporter',
  { defaultValue: () => ({ report: () => Effect.void }) },
)

const reportTimeout = '5 seconds'

// The message and properties of a defect can carry query parameters, a Channel row or a secret.
export const defectCauseOf = (cause: unknown): DefectCause => {
  if (!(cause instanceof Error)) {
    return { name: 'UnknownDefect', frames: [] }
  }

  return {
    name: cause.name,
    frames: (cause.stack ?? '')
      .split('\n')
      .filter((line) => /^\s+at /.test(line))
      .map((line) => line.trim()),
  }
}

const defectSubjectOf = ({ runId, channelId, code }: Omit<DefectReport, 'cause'>) => {
  if (runId !== null) {
    return `of Run ${runId}`
  }

  return channelId === null ? code : `of Channel ${channelId}`
}

// A reporter that breaks or hangs must not hide the defect it reports or hold the worker job.
export const reportDefect = (report: Omit<DefectReport, 'cause'>, cause: unknown) =>
  Effect.gen(function* () {
    const reporter = yield* DefectReporter

    yield* reporter.report({ ...report, cause: defectCauseOf(cause) })
  }).pipe(
    Effect.timeout(reportTimeout),
    Effect.catchCause((failure) =>
      Effect.logError(`Defect ${defectSubjectOf(report)} not reported`, failure),
    ),
  )

// An expected failure, such as an unreachable queue or SFTP server, is no defect.
export const reportDefectOf = (
  report: Omit<DefectReport, 'cause'>,
  cause: Cause.Cause<unknown>,
) => {
  const defect = Cause.findDefect(cause)

  return Result.isSuccess(defect) ? reportDefect(report, defect.success) : Effect.void
}

// Every failure is logged, and only a defect is reported to error monitoring.
export const logAndReportDefect =
  (report: Omit<DefectReport, 'cause'>, message: string) => (cause: Cause.Cause<unknown>) =>
    Effect.logError(message, cause).pipe(Effect.andThen(reportDefectOf(report, cause)))

// A defect the pipeline finds itself has no cause to report but its own.
export const reportFoundDefect = (message: string, ids: RunDefectIds) =>
  Effect.gen(function* () {
    const defect = new Error(message)

    yield* Effect.logError(message)
    yield* reportDefect({ ...ids, channelId: null, code: 'processingDefect' }, defect)
  })
