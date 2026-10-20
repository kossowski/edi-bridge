import {
  type ActivityDay,
  type OpenProblem,
  type TradingPartner,
  type TradingPartnerActivityDetail,
} from '@edi-bridge/contracts'

export type PartnerPanelProps = {
  tradingPartner: TradingPartner
}

export type PartnerActivityProps = {
  tradingPartner: TradingPartner
  activity: TradingPartnerActivityDetail
}

export function awaitsReceiptConfirmation({
  testMode,
  onboarding,
}: Pick<TradingPartner, 'testMode' | 'onboarding'>) {
  return (
    testMode &&
    onboarding.testInterchangeSentAt !== null &&
    onboarding.contrlReceivedAt === null &&
    onboarding.testRejectedAt === null
  )
}

// One indexed row per check, so an open page polling every 10 s is cheap for the api.
const receiptConfirmationPollMs = 10_000

export function receiptConfirmationPollInterval(
  tradingPartner: Pick<TradingPartner, 'testMode' | 'onboarding'> | undefined,
) {
  return tradingPartner && awaitsReceiptConfirmation(tradingPartner)
    ? receiptConfirmationPollMs
    : false
}

export function dayTotals(days: ReadonlyArray<ActivityDay>) {
  return days.reduce(
    (totals, day) => ({
      runs: totals.runs + day.runs,
      failed: totals.failed + day.failed,
      busiest: Math.max(totals.busiest, day.runs),
    }),
    { runs: 0, failed: 0, busiest: 0 },
  )
}

export function problemKey(problem: OpenProblem) {
  return problem.kind === 'failedRun'
    ? `run-${problem.run.id}`
    : `interchange-${problem.overdueAcknowledgement.interchange.id}`
}
