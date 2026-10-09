import { describe, expect, it } from 'vitest'

import {
  fitsFlow,
  type Flow,
  type FlowInput,
  flowInputSchema,
  flowSchema,
  flowSummarySchema,
  flowUpdateSchema,
  moveFlowMappingVersionBodySchema,
} from './flow'
import { publishedMappingVersionsQuerySchema } from './mapping-version'

const input: FlowInput = {
  name: 'Hansemarkt ORDERS inbound',
  tradingPartnerId: '00000001-0000-4000-8000-000000000001',
  messageType: 'ORDERS',
  inboundChannelId: '00000003-0000-4000-8000-000000000003',
  destinationChannelId: '00000003-0000-4000-8000-000000000002',
  mappingVersionId: '00000005-0000-4000-8000-000000000002',
}

function version(number: number) {
  return {
    id: `00000005-0000-4000-8000-00000000000${number}`,
    mappingId: '00000004-0000-4000-8000-000000000001',
    mappingName: 'Hansemarkt: ORDERS to ERP JSON',
    version: number,
    publishedAt: '2026-03-02T09:00:00.000Z',
  }
}

const flow: Flow = {
  id: '00000002-0000-4000-8000-000000000001',
  name: input.name,
  tradingPartnerId: input.tradingPartnerId,
  messageType: input.messageType,
  inboundChannelId: input.inboundChannelId,
  destinationChannelId: input.destinationChannelId,
  mappingVersion: version(2),
  newerMappingVersions: [version(3)],
}

describe('flowInputSchema', () => {
  it('accepts a Flow pinned to a Mapping Version', () => {
    expect(flowInputSchema.parse(input)).toEqual(input)
  })

  it('trims the name and rejects a blank one', () => {
    expect(flowInputSchema.parse({ ...input, name: '  Orders  ' }).name).toBe('Orders')
    expect(flowInputSchema.safeParse({ ...input, name: '   ' }).success).toBe(false)
  })

  it.each(['inboundChannelId', 'destinationChannelId', 'mappingVersionId'] as const)(
    'requires %s',
    (field) => {
      expect(flowInputSchema.safeParse({ ...input, [field]: undefined }).success).toBe(false)
    },
  )

  it('rejects an unknown Message Type', () => {
    expect(flowInputSchema.safeParse({ ...input, messageType: 'APERAK' }).success).toBe(false)
  })
})

describe('flowUpdateSchema', () => {
  it('leaves the Trading Partner, Message Type and Mapping Version out', () => {
    expect(flowUpdateSchema.parse(input)).toEqual({
      name: input.name,
      inboundChannelId: input.inboundChannelId,
      destinationChannelId: input.destinationChannelId,
    })
  })
})

describe('flowSchema', () => {
  it('carries the pinned Mapping Version and the newer ones', () => {
    expect(flowSchema.parse(flow)).toEqual(flow)
  })

  it('is still a FlowSummary for the screens that only need one', () => {
    expect(flowSummarySchema.parse(flow)).toEqual({
      id: flow.id,
      name: flow.name,
      tradingPartnerId: flow.tradingPartnerId,
      messageType: flow.messageType,
    })
  })
})

describe('moveFlowMappingVersionBodySchema', () => {
  it('names the Mapping Version to move to', () => {
    expect(moveFlowMappingVersionBodySchema.safeParse({ mappingVersionId: 'latest' }).success).toBe(
      false,
    )
  })
})

describe('publishedMappingVersionsQuerySchema', () => {
  it('filters by Message Type or lists everything', () => {
    expect(publishedMappingVersionsQuerySchema.parse({ messageType: 'INVOIC' })).toEqual({
      messageType: 'INVOIC',
    })
    expect(publishedMappingVersionsQuerySchema.parse({})).toEqual({})
  })
})

describe('fitsFlow', () => {
  const tradingPartnerId = '00000001-0000-4000-8000-000000000001'
  const otherPartnerId = '00000001-0000-4000-8000-000000000002'

  const channel = (direction: 'inbound' | 'outbound', owner: string | null) => ({
    direction,
    tradingPartnerId: owner,
  })

  it.each([
    ['ORDERS', 'inboundChannelId', channel('inbound', tradingPartnerId), true],
    ['ORDERS', 'inboundChannelId', channel('inbound', null), false],
    ['ORDERS', 'destinationChannelId', channel('outbound', null), true],
    ['ORDERS', 'destinationChannelId', channel('outbound', tradingPartnerId), false],
    ['DESADV', 'inboundChannelId', channel('inbound', null), true],
    ['DESADV', 'inboundChannelId', channel('inbound', tradingPartnerId), false],
    ['DESADV', 'destinationChannelId', channel('outbound', tradingPartnerId), true],
    ['DESADV', 'destinationChannelId', channel('outbound', null), false],
    ['ORDERS', 'inboundChannelId', channel('outbound', tradingPartnerId), false],
    ['ORDERS', 'inboundChannelId', channel('inbound', otherPartnerId), false],
  ] as const)('%s %s on %o: %s', (messageType, field, candidate, fits) => {
    expect(fitsFlow(candidate, field, { messageType, tradingPartnerId })).toBe(fits)
  })
})
