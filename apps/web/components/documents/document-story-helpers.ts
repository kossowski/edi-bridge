import {
  type FailureStage,
  type MessageType,
  type RunStatus,
  type TradingPartnerSummary,
} from '@edi-bridge/contracts'
import { createRun, seedFlows, seedTradingPartners } from '@edi-bridge/mocks'

export const partner = seedTradingPartners[0]!

export function flowFor(messageType: MessageType, tradingPartner: TradingPartnerSummary = partner) {
  return seedFlows.find(
    (candidate) =>
      candidate.tradingPartnerId === tradingPartner.id && candidate.messageType === messageType,
  )!
}

export function storyRunFactory({ idPrefix, hour }: { idPrefix: string; hour: string }) {
  return function storyRun(
    index: number,
    messageType: MessageType,
    outcome: FailureStage | Exclude<RunStatus, 'failed'>,
    {
      tradingPartner = partner,
      ...changes
    }: {
      receivedAt?: string
      manualSubmission?: boolean
      defect?: boolean
      tradingPartner?: TradingPartnerSummary
    } = {},
  ) {
    const flow = flowFor(messageType, tradingPartner)

    const run = {
      id: `${idPrefix}-0000-4000-8000-${String(index).padStart(12, '0')}`,
      receivedAt: `2026-10-08T${hour}:${String(index).padStart(2, '0')}:13.000Z`,
      tradingPartner,
      messageType,
      flow: { id: flow.id, name: flow.name },
      manualSubmission: false,
      ...changes,
    }

    return outcome === 'parse' ||
      outcome === 'validation' ||
      outcome === 'mapping' ||
      outcome === 'delivery'
      ? createRun({ ...run, status: 'failed', failureStage: outcome })
      : createRun({ ...run, status: outcome, failureStage: null })
  }
}
