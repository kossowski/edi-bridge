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

export function testRejected({ onboarding }: Pick<TradingPartner, 'onboarding'>) {
  return onboarding.testRejectedAt !== null
}

export function awaitsReceiptConfirmation(
  tradingPartner: Pick<TradingPartner, 'testMode' | 'onboarding'>,
) {
  return (
    tradingPartner.testMode &&
    tradingPartner.onboarding.testInterchangeSentAt !== null &&
    tradingPartner.onboarding.contrlReceivedAt === null &&
    !testRejected(tradingPartner)
  )
}

// The api answers the test send before the worker hands the test Interchange over.
export function awaitsTestHandover(
  tradingPartner: Pick<TradingPartner, 'testMode' | 'onboarding'>,
  testSent: boolean,
) {
  return (
    testSent && tradingPartner.testMode && tradingPartner.onboarding.testInterchangeSentAt === null
  )
}

// One indexed row per check, so an open page polling every 10 s is cheap for the api.
const onboardingPollMs = 10_000

export function onboardingPollInterval(
  tradingPartner: Pick<TradingPartner, 'testMode' | 'onboarding'> | undefined,
  testSent: boolean,
) {
  return tradingPartner &&
    (awaitsTestHandover(tradingPartner, testSent) || awaitsReceiptConfirmation(tradingPartner))
    ? onboardingPollMs
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
