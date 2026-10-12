import {
  createOverdueAcknowledgement,
  createRun,
  createTradingPartner,
  emptyTasksData,
  type TasksData,
} from '@edi-bridge/mocks'

const hour = 60 * 60 * 1000

const hoursAgo = (hours: number) => new Date(Date.now() - hours * hour).toISOString()

export const hansemarkt = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Hansemarkt GmbH',
  testMode: false,
})

const rheinkauf = createTradingPartner({
  id: '10000000-0000-4000-8000-000000000003',
  name: 'Rheinkauf eG',
  testMode: false,
})

function failedRun(
  tradingPartner: typeof hansemarkt,
  messageType: 'ORDERS' | 'DESADV' | 'INVOIC',
  failureStage: 'parse' | 'validation' | 'mapping' | 'delivery',
  hours: number,
) {
  return createRun({
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
    messageType,
    status: 'failed',
    failureStage,
    receivedAt: hoursAgo(hours),
  })
}

function deliveredRun(tradingPartner: typeof hansemarkt, hours: number) {
  return createRun({
    tradingPartner: { id: tradingPartner.id, name: tradingPartner.name },
    status: 'delivered',
    failureStage: null,
    receivedAt: hoursAgo(hours),
  })
}

export function everyKind(): TasksData {
  return {
    ...emptyTasksData,
    tradingPartners: [hansemarkt, rheinkauf],
    runs: [
      failedRun(hansemarkt, 'INVOIC', 'delivery', 1),
      failedRun(hansemarkt, 'DESADV', 'mapping', 2),
      failedRun(hansemarkt, 'ORDERS', 'parse', 3),
      ...Array.from({ length: 12 }, (_, index) => deliveredRun(rheinkauf, index + 1)),
    ],
    overdueAcknowledgements: [
      createOverdueAcknowledgement({
        tradingPartner: { id: rheinkauf.id, name: rheinkauf.name },
        messageType: 'DESADV',
        acknowledgementTimeLimitHours: 24,
        overdueSince: hoursAgo(5),
      }),
    ],
  }
}
