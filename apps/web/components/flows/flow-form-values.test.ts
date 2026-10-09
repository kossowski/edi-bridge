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
  const names = (choices: ReadonlyArray<{ name: string }>) => choices.map(({ name }) => name)

  it("takes an inbound Message Type from the Trading Partner's Channel to own systems", () => {
    expect(names(channelChoices(channels, 'inboundChannelId', filled))).toEqual([
      'Hansemarkt SFTP inbox',
    ])
    expect(names(channelChoices(channels, 'destinationChannelId', filled))).toEqual([
      'ERP HTTP delivery',
    ])
  })

  it("takes an outbound Message Type from own systems to the Trading Partner's Channel", () => {
    const desadv = { ...filled, messageType: 'DESADV' } as const

    expect(names(channelChoices(channels, 'inboundChannelId', desadv))).toEqual(['ERP webhook'])
    expect(names(channelChoices(channels, 'destinationChannelId', desadv))).toEqual([
      'Hansemarkt SFTP outbox',
    ])
  })

  it('offers no Trading Partner Channel while no Trading Partner is chosen', () => {
    expect(channelChoices(channels, 'inboundChannelId', toFormValues())).toEqual([])
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
    expect(chooseMessageType(filled, 'CONTRL', channels)).toMatchObject({
      messageType: 'CONTRL',
      mappingVersionId: '',
    })
    expect(chooseMessageType(filled, 'ORDERS', channels)).toBe(filled)
  })

  it('clears the chosen Channels when the direction changes', () => {
    expect(chooseMessageType(filled, 'INVOIC', channels)).toMatchObject({
      inboundChannelId: '',
      destinationChannelId: '',
    })
  })

  it('keeps the chosen Channels when the direction stays the same', () => {
    expect(chooseMessageType(filled, 'CONTRL', channels)).toMatchObject({
      inboundChannelId: filled.inboundChannelId,
      destinationChannelId: filled.destinationChannelId,
    })
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
  it('sends only the name and the Channels', () => {
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
