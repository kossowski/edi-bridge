import { describe, expect, it, vi } from 'vitest'

import {
  acknowledgementTimeLimitHours,
  type ChannelInput,
  channelKinds,
  type CreateMappingBody,
  type Flow,
  type FlowInput,
  type MappingSummary,
  type TradingPartnerInput,
} from '@edi-bridge/contracts'
import { createChannel, createTradingPartner, toChannel } from '@edi-bridge/mocks'

import { toFormValues } from '../channels/channel-form-values'
import { type PlanChannel, setupPlan, type SetupContext } from './partner-setup-plan'
import {
  type FinishApi,
  finishSetup,
  forLater,
  leftOver,
  nothingForLater,
  nothingLeft,
  routeInput,
  setupSummary,
} from './partner-wizard-finish'
import { type WizardResult } from './partner-wizard-state'

const tradingPartner = createTradingPartner({ name: 'Kieler Kontor', gln: null })

const erpDelivery = {
  id: '20000000-0000-4000-8000-000000000001',
  name: 'ERP HTTP delivery',
  direction: 'outbound',
  tradingPartnerId: null,
} as const satisfies PlanChannel

const erpWebhook = {
  id: '20000000-0000-4000-8000-000000000002',
  name: 'ERP webhook',
  direction: 'inbound',
  tradingPartnerId: null,
} as const satisfies PlanChannel

const ordersVersion = {
  id: '30000000-0000-4000-8000-000000000001',
  mappingId: '30000000-0000-4000-8000-000000000002',
  mappingName: 'ORDERS to ERP JSON',
  version: 3,
  publishedAt: '2026-03-02T09:00:00.000Z',
}

const invoicVersion = {
  ...ordersVersion,
  id: '30000000-0000-4000-8000-000000000003',
  mappingName: 'ERP JSON to INVOIC',
}

const context: SetupContext<PlanChannel> = {
  channels: [erpDelivery, erpWebhook],
  mappingVersions: [ordersVersion, invoicVersion],
  names: {
    connection: (kind) => `Kieler Kontor ${kind}`,
    route: (messageType) => `${messageType} route`,
  },
}

const httpValues = { ...toFormValues(), sendAuthorization: false }

const result: WizardResult = {
  partner: { name: 'Kieler Kontor', gln: null },
  documents: ['ORDERS', 'DESADV', 'INVOIC'],
  connections: {
    inbound: { way: 'web', values: toFormValues() },
    outbound: {
      way: 'web',
      values: { ...httpValues, url: 'https://edi.kieler-kontor.de/inbox' },
    },
  },
  mappings: {
    ORDERS: { way: 'existing', mappingVersionId: ordersVersion.id },
    DESADV: { way: 'ai' },
    INVOIC: { way: 'existing', mappingVersionId: invoicVersion.id },
  },
}

const plan = setupPlan(result, context)

function createdChannel(input: ChannelInput) {
  const kind = channelKinds.find(
    ({ type, direction }) => type === input.type && direction === input.direction,
  )

  const channel = toChannel(createChannel(kind), 'https://api.example')

  return {
    channel: { ...channel, name: input.name, tradingPartnerId: input.tradingPartnerId },
    webhookToken: input.type === 'webhook' ? 'whk_token' : null,
  }
}

function createdMapping({ messageType }: CreateMappingBody): MappingSummary {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    name: `New ${messageType} mapping`,
    direction: 'outbound',
    messageType,
    documentStructureId: '40000000-0000-4000-8000-000000000002',
    documentStructureName: 'ERP JSON',
    latestVersion: null,
    latestVersionPublishedAt: null,
    unpublishedChanges: true,
    draftUpdatedAt: '2026-10-12T08:00:00.000Z',
    partners: [],
    documentsLast7Days: 0,
    failedRunsLast7Days: 0,
  }
}

function createdFlow({ mappingVersionId, ...input }: FlowInput): Flow {
  return {
    ...input,
    id: crypto.randomUUID(),
    mappingVersion: mappingVersionId === ordersVersion.id ? ordersVersion : invoicVersion,
    newerMappingVersions: [],
  }
}

function fakeApi(failing: ReadonlyArray<keyof FinishApi> = []) {
  function respond<Result>(endpoint: keyof FinishApi, result: () => Result) {
    return failing.includes(endpoint)
      ? Promise.reject(new Error(endpoint))
      : Promise.resolve(result())
  }

  return {
    createTradingPartner: vi.fn((input: TradingPartnerInput) =>
      respond('createTradingPartner', () => ({ ...tradingPartner, ...input })),
    ),
    createChannel: vi.fn((input: ChannelInput) =>
      respond('createChannel', () => createdChannel(input)),
    ),
    createMapping: vi.fn((body: CreateMappingBody) =>
      respond('createMapping', () => createdMapping(body)),
    ),
    createFlow: vi.fn((input: FlowInput) => respond('createFlow', () => createdFlow(input))),
  } satisfies FinishApi
}

describe('finishSetup', () => {
  it('creates the partner, its connections, the AI drafts and the document routes', async () => {
    const api = fakeApi()
    const finished = await finishSetup(plan, api)

    expect(api.createTradingPartner).toHaveBeenCalledWith({
      name: 'Kieler Kontor',
      gln: null,
      characterSet: 'UNOC',
      acknowledgementTimeLimitHours: acknowledgementTimeLimitHours.default,
    })
    expect(api.createChannel.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({
        type: 'webhook',
        direction: 'inbound',
        name: 'Kieler Kontor webhook-inbound',
        tradingPartnerId: tradingPartner.id,
      }),
      expect.objectContaining({
        type: 'http',
        direction: 'outbound',
        name: 'Kieler Kontor http-outbound',
        tradingPartnerId: tradingPartner.id,
        url: 'https://edi.kieler-kontor.de/inbox',
      }),
    ])
    expect(api.createMapping).toHaveBeenCalledExactlyOnceWith({ messageType: 'DESADV' })
    expect(api.createFlow.mock.calls.map(([input]) => input)).toEqual([
      {
        name: 'ORDERS route',
        tradingPartnerId: tradingPartner.id,
        messageType: 'ORDERS',
        inboundChannelId: finished.channels.inbound?.channel.id,
        destinationChannelId: erpDelivery.id,
        mappingVersionId: ordersVersion.id,
      },
      {
        name: 'INVOIC route',
        tradingPartnerId: tradingPartner.id,
        messageType: 'INVOIC',
        inboundChannelId: erpWebhook.id,
        destinationChannelId: finished.channels.outbound?.channel.id,
        mappingVersionId: invoicVersion.id,
      },
    ])
    expect(finished.channels.inbound?.webhookToken).toBe('whk_token')
    expect(finished.mappings.DESADV?.messageType).toBe('DESADV')
    expect(nothingLeft(leftOver(plan, finished))).toBe(true)
  })

  it('creates nothing else when the partner cannot be created', async () => {
    const api = fakeApi(['createTradingPartner'])

    await expect(finishSetup(plan, api)).rejects.toThrow('createTradingPartner')
    expect(api.createChannel).not.toHaveBeenCalled()
    expect(api.createMapping).not.toHaveBeenCalled()
    expect(api.createFlow).not.toHaveBeenCalled()
  })

  it('keeps the partner and goes on when a later item fails', async () => {
    const api = fakeApi(['createMapping', 'createFlow'])
    const finished = await finishSetup(plan, api)

    expect(finished.tradingPartner.name).toBe('Kieler Kontor')
    expect(Object.keys(finished.channels)).toEqual(['inbound', 'outbound'])
    expect(api.createFlow).toHaveBeenCalledTimes(2)
    expect(leftOver(plan, finished)).toEqual({
      connections: [],
      mappingDrafts: ['DESADV'],
      routes: [
        { messageType: 'ORDERS', name: 'ORDERS route' },
        { messageType: 'INVOIC', name: 'INVOIC route' },
      ],
    })
  })

  it('skips the document route whose partner connection was not created', async () => {
    const api = fakeApi()
    api.createChannel.mockImplementationOnce(() => Promise.reject(new Error('inbound')))

    const finished = await finishSetup(plan, api)

    expect(api.createFlow.mock.calls.map(([input]) => input.messageType)).toEqual(['INVOIC'])
    expect(leftOver(plan, finished)).toEqual({
      connections: [
        {
          direction: 'inbound',
          kind: 'webhook-inbound',
          name: 'Kieler Kontor webhook-inbound',
          reason: 'failed',
        },
      ],
      mappingDrafts: [],
      routes: [{ messageType: 'ORDERS', name: 'ORDERS route' }],
    })
  })

  it('leaves out a connection whose details no longer fit the channel input, as invalid', async () => {
    const api = fakeApi()

    const broken = setupPlan(
      {
        ...result,
        documents: ['INVOIC'],
        connections: { outbound: { way: 'web', values: httpValues } },
      },
      context,
    )

    const finished = await finishSetup(broken, api)

    expect(api.createChannel).not.toHaveBeenCalled()
    expect(leftOver(broken, finished)).toEqual({
      connections: [
        {
          direction: 'outbound',
          kind: 'http-outbound',
          name: 'Kieler Kontor http-outbound',
          reason: 'invalid',
        },
      ],
      mappingDrafts: [],
      routes: [{ messageType: 'INVOIC', name: 'INVOIC route' }],
    })
  })
})

describe('leftOver', () => {
  it('lists nothing for routes the plan leaves for the partner page', async () => {
    const later = setupPlan(
      { ...result, documents: ['INVOIC'], mappings: { INVOIC: { way: 'later' } } },
      context,
    )

    const finished = await finishSetup(later, fakeApi())

    expect(leftOver(later, finished)).toEqual({ connections: [], mappingDrafts: [], routes: [] })
  })
})

describe('routeInput', () => {
  it('links the created partner connection with the own connection and the mapping', () => {
    const [orders] = plan.documents

    if (orders === undefined || !('route' in orders)) {
      throw new Error('ORDERS has no route')
    }

    expect(
      routeInput({
        messageType: 'ORDERS',
        route: orders.route,
        tradingPartnerId: tradingPartner.id,
        partnerChannelId: '50000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({
      name: 'ORDERS route',
      tradingPartnerId: tradingPartner.id,
      messageType: 'ORDERS',
      inboundChannelId: '50000000-0000-4000-8000-000000000001',
      destinationChannelId: erpDelivery.id,
      mappingVersionId: ordersVersion.id,
    })
  })
})

describe('forLater', () => {
  it('lists nothing when the plan creates every document route', () => {
    expect(
      nothingForLater(forLater(setupPlan({ ...result, documents: ['ORDERS'] }, context))),
    ).toBe(true)
  })

  it('lists the postponed connections and the documents left with their reasons', () => {
    const later = setupPlan(
      {
        ...result,
        connections: { outbound: { way: 'web', values: httpValues } },
        mappings: { ...result.mappings, INVOIC: { way: 'later' } },
      },
      context,
    )

    expect(forLater(later)).toEqual({
      connections: ['inbound'],
      documents: [
        { messageType: 'ORDERS', reasons: ['connectionPostponed'] },
        { messageType: 'DESADV', reasons: ['mappingDraft'] },
        { messageType: 'INVOIC', reasons: ['mappingLater'] },
      ],
    })
  })

  it('names each postponed direction once', () => {
    const later = setupPlan({ ...result, connections: {} }, context)

    expect(forLater(later).connections).toEqual(['inbound', 'outbound'])
  })
})

describe('setupSummary', () => {
  it('names the webhook with its token, the AI drafts and what is left', async () => {
    const finished = await finishSetup(plan, fakeApi(['createFlow']))
    const summary = setupSummary(plan, finished)

    expect(summary.name).toBe('Kieler Kontor')
    expect(summary.webhook).toEqual({
      channel: finished.channels.inbound?.channel,
      token: 'whk_token',
    })
    expect(summary.mappingDrafts).toEqual([
      { messageType: 'DESADV', mapping: finished.mappings.DESADV },
    ])
    expect(summary.left.routes.map(({ messageType }) => messageType)).toEqual(['ORDERS', 'INVOIC'])
    expect(summary.later).toEqual({
      connections: [],
      documents: [{ messageType: 'DESADV', reasons: ['mappingDraft'] }],
    })
  })

  it('has no webhook when only the partner was created', async () => {
    const api = fakeApi(['createChannel', 'createMapping'])
    const summary = setupSummary(plan, await finishSetup(plan, api))

    expect(summary.webhook).toBeNull()
    expect(summary.mappingDrafts).toEqual([])
    expect(summary.left.connections.map(({ direction }) => direction)).toEqual([
      'inbound',
      'outbound',
    ])
  })
})
