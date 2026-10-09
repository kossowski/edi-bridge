import { describe, expect, it } from 'vitest'

import {
  createMappingCatalogue,
  seedChannels,
  seedFlows,
  seedMappings,
  toChannel,
  toFlow,
} from '@edi-bridge/mocks'

import {
  channelChoices,
  chooseMessageType,
  chooseTradingPartner,
  type FlowFormValues,
  toFormValues,
  validateFlowUpdate,
  validateNewFlow,
} from './flow-form-values'

const channels = seedChannels.map((record) => toChannel(record, 'http://localhost'))

function channelNamed(name: string) {
  return channels.find((channel) => channel.name === name)!
}

const hansemarktInbox = channelNamed('Hansemarkt SFTP inbox')

const erpDelivery = channelNamed('ERP HTTP delivery')

const hansemarktId = hansemarktInbox.tradingPartnerId!

const alpenfrischId = channelNamed('Alpenfrisch SFTP inbox').tradingPartnerId!

const ordersVersion = seedMappings.find(({ messageType }) => messageType === 'ORDERS')!.versions[0]!

const filled: FlowFormValues = {
  name: 'Hansemarkt ORDERS',
  tradingPartnerId: hansemarktId,
  messageType: 'ORDERS',
  inboundChannelId: hansemarktInbox.id,
  destinationChannelId: erpDelivery.id,
  mappingVersionId: ordersVersion.id,
}

describe('toFormValues', () => {
  it('starts a new Flow without any choice made except the Message Type', () => {
    expect(toFormValues()).toEqual({
      name: '',
      tradingPartnerId: '',
      messageType: 'ORDERS',
      inboundChannelId: '',
      destinationChannelId: '',
      mappingVersionId: '',
    })
  })

  it('takes the pinned Mapping Version of a saved Flow', () => {
    const flow = toFlow(seedFlows[0]!, createMappingCatalogue(seedMappings))

    expect(toFormValues(flow)).toMatchObject({
      name: flow.name,
      mappingVersionId: flow.mappingVersion.id,
    })
  })
})

describe('channelChoices', () => {
  it("offers own systems' Channels and the Trading Partner's own, by name", () => {
    expect(channelChoices(channels, 'inbound', hansemarktId).map(({ name }) => name)).toEqual([
      'ERP webhook',
      'Hansemarkt SFTP inbox',
    ])
  })

  it('offers only own systems while no Trading Partner is chosen', () => {
    expect(channelChoices(channels, 'outbound', '').map(({ name }) => name)).toEqual([
      'ERP HTTP delivery',
    ])
  })
})

describe('chooseTradingPartner', () => {
  it("clears a chosen Channel of the previous Trading Partner and keeps own systems'", () => {
    expect(chooseTradingPartner(filled, alpenfrischId, channels)).toMatchObject({
      tradingPartnerId: alpenfrischId,
      inboundChannelId: '',
      destinationChannelId: erpDelivery.id,
    })
  })
})

describe('chooseMessageType', () => {
  it('clears the Mapping Version when the Message Type changes', () => {
    expect(chooseMessageType(filled, 'INVOIC')).toMatchObject({
      messageType: 'INVOIC',
      mappingVersionId: '',
    })
    expect(chooseMessageType(filled, 'ORDERS')).toBe(filled)
  })
})

describe('validateNewFlow', () => {
  it('turns complete values into the API input', () => {
    expect(validateNewFlow({ ...filled, name: ' Hansemarkt ORDERS ' })).toEqual({
      input: filled,
    })
  })

  it('reports every missing choice at once', () => {
    expect(validateNewFlow({ ...toFormValues(), name: 'x'.repeat(71) })).toEqual({
      errors: {
        name: 'tooLong',
        tradingPartnerId: 'required',
        inboundChannelId: 'required',
        destinationChannelId: 'required',
        mappingVersionId: 'required',
      },
    })
  })
})

describe('validateFlowUpdate', () => {
  it('sends only the name and the route', () => {
    expect(validateFlowUpdate(filled)).toEqual({
      input: {
        name: filled.name,
        inboundChannelId: filled.inboundChannelId,
        destinationChannelId: filled.destinationChannelId,
      },
    })
  })

  it('requires a destination Channel', () => {
    expect(validateFlowUpdate({ ...filled, destinationChannelId: '' })).toEqual({
      errors: { destinationChannelId: 'required' },
    })
  })
})
