import { Context, Effect } from 'effect'

export type DefectCode = 'processingDefect' | 'channelDefect' | 'deliveryDefect'

export type DefectCause = { name: string; frames: string[] }

export type DefectReport = {
  workspaceId: string
  runId: string
  tradingPartnerId: string | null
  channelId: string | null
  code: DefectCode
  cause: DefectCause
}

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

// A reporter that breaks or hangs must not hide the defect it reports or hold the worker job.
export const reportDefect = (report: Omit<DefectReport, 'cause'>, cause: unknown) =>
  Effect.gen(function* () {
    const reporter = yield* DefectReporter

    yield* reporter.report({ ...report, cause: defectCauseOf(cause) })
  }).pipe(
    Effect.timeout(reportTimeout),
    Effect.catchCause((failure) =>
      Effect.logError(`Defect of Run ${report.runId} not reported`, failure),
    ),
  )

// A defect the pipeline finds itself has no cause to report but its own.
export const reportFoundDefect = (
  message: string,
  ids: Omit<DefectReport, 'channelId' | 'code' | 'cause'>,
) =>
  Effect.gen(function* () {
    const defect = new Error(message)

    yield* Effect.logError(message)
    yield* reportDefect({ ...ids, channelId: null, code: 'processingDefect' }, defect)
  })
