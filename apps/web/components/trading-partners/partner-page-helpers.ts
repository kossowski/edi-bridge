import { type ActivityDay, type OpenProblem, type TradingPartner } from '@edi-bridge/contracts'

export const partnerTabs = ['overview', 'settings'] as const

export type PartnerTab = (typeof partnerTabs)[number]

export function partnerTabOf(value: string | null): PartnerTab {
  return partnerTabs.find((tab) => tab === value) ?? 'overview'
}

export function awaitsReceiptConfirmation({
  testMode,
  onboarding,
}: Pick<TradingPartner, 'testMode' | 'onboarding'>) {
  return (
    testMode && onboarding.testInterchangeSentAt !== null && onboarding.contrlReceivedAt === null
  )
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
