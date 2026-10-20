import { Context, Effect } from 'effect'

export type DefectReport = {
  workspaceId: string
  runId: string
  tradingPartnerId: string | null
  defect: unknown
}

export type DefectReporterService = {
  report: (report: DefectReport) => Effect.Effect<void>
}

// Where no error monitoring is provided, a defect is only logged.
export const DefectReporter = Context.Reference<DefectReporterService>(
  '@edi-bridge/pipeline/DefectReporter',
  { defaultValue: () => ({ report: () => Effect.void }) },
)

// A reporter that breaks must not hide the defect it reports.
export const reportDefect = (report: DefectReport) =>
  Effect.gen(function* () {
    const reporter = yield* DefectReporter

    yield* reporter.report(report)
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError(`Defect of Run ${report.runId} not reported`, cause),
    ),
  )
