import { http, HttpResponse } from 'msw'

import {
  directionOf,
  type MessageType,
  messageTypeSchema,
  type RunSummary,
  runSummarySchema,
  submitDocumentEndpoint,
  type TradingPartner,
} from '@edi-bridge/contracts'

import { type ChannelRecord, type ChannelStore, toChannelStore } from './channel'
import { type FlowRecord, type FlowStore, toFlowStore } from './flow'
import { badRequest, unprocessable } from './responses'
import { createRunStore, type RunStore } from './run-store'
import { seedTradingPartners } from './trading-partner'

const interchangeStart = /^\s*UN[AB]/

const messageHeader = /UNH\+[^+']*\+([A-Z]{6})/g

// The prototype reads only the Message Types from the UNH segments; real parsing comes later.
export function messageTypesOf(content: string): MessageType[] | null {
  if (!interchangeStart.test(content)) {
    return null
  }

  return [...content.matchAll(messageHeader)].flatMap(([, type]) => {
    const parsed = messageTypeSchema.safeParse(type)

    return parsed.success ? [parsed.data] : []
  })
}

type Outcome = { flow: FlowRecord; failed: boolean }

// An inbound Flow expects EDIFACT from the Trading Partner, so a Document without a Message fails
// at parsing; an outbound Flow takes JSON or CSV from the own systems.
function outcomesOf(content: string, routed: readonly [FlowRecord, ...FlowRecord[]]): Outcome[] {
  const [fallback] = routed
  const declared = messageTypesOf(content) ?? []

  if (declared.length === 0) {
    return [{ flow: fallback, failed: directionOf(fallback) === 'inbound' }]
  }

  return declared.map((messageType) => ({
    flow: routed.find((flow) => flow.messageType === messageType) ?? fallback,
    failed: false,
  }))
}

export function manualSubmissionHandler(
  apiUrl: string,
  {
    channels,
    flows,
    runs = createRunStore([]),
    tradingPartners = seedTradingPartners,
  }: {
    channels?: ReadonlyArray<ChannelRecord> | ChannelStore
    flows?: ReadonlyArray<FlowRecord> | FlowStore
    runs?: RunStore
    tradingPartners?: ReadonlyArray<TradingPartner>
  } = {},
) {
  const channelStore = toChannelStore(channels)
  const flowStore = toFlowStore(flows)

  return http.post(`${apiUrl}${submitDocumentEndpoint.path}`, async ({ request }) => {
    const body = submitDocumentEndpoint.body.safeParse(await request.json().catch(() => undefined))

    if (!body.success) {
      return badRequest(body.error.message)
    }

    const channel = channelStore.get(body.data.channelId)

    if (!channel) {
      return unprocessable('The Channel does not exist')
    }

    if (channel.direction !== 'inbound') {
      return unprocessable('A Manual Submission needs an inbound Channel')
    }

    const routed = flowStore
      .all()
      .filter((flow) => flow.inboundChannelId === channel.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))

    const [first, ...rest] = routed

    if (!first) {
      return unprocessable('No Flow routes Documents from this Channel')
    }

    const outcomes = outcomesOf(body.data.document.content, [first, ...rest]).map((outcome) => ({
      ...outcome,
      tradingPartner: tradingPartners.find(({ id }) => id === outcome.flow.tradingPartnerId),
    }))

    if (outcomes.some(({ tradingPartner }) => !tradingPartner)) {
      return unprocessable('The Trading Partner of the Flow does not exist')
    }

    const receivedAt = new Date().toISOString()

    const created: RunSummary[] = outcomes.map(({ flow, failed, tradingPartner }) =>
      runSummarySchema.parse({
        id: crypto.randomUUID(),
        receivedAt,
        tradingPartner,
        messageType: flow.messageType,
        flow: { id: flow.id, name: flow.name },
        manualSubmission: true,
        status: failed ? 'failed' : 'delivered',
        failureStage: failed ? 'parse' : null,
      }),
    )

    for (const run of created) {
      runs.set(run)
    }

    return HttpResponse.json(submitDocumentEndpoint.response.parse({ runs: created }), {
      status: 201,
    })
  })
}
