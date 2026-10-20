import { describe, expect, it } from 'vitest'

import { channelDirectionsOf, neededDirectionsOf } from './trading-partner-activity'

describe('neededDirectionsOf', () => {
  it('needs the direction of each chosen Message Type', () => {
    expect(neededDirectionsOf({ messageTypes: ['ORDERS'], flows: [] })).toEqual(['inbound'])
    expect(neededDirectionsOf({ messageTypes: ['INVOIC', 'DESADV'], flows: [] })).toEqual([
      'outbound',
    ])
  })

  it('needs the direction of each Flow', () => {
    expect(neededDirectionsOf({ messageTypes: null, flows: [{ messageType: 'DESADV' }] })).toEqual([
      'outbound',
    ])
  })

  it('joins the directions of the chosen Message Types and the Flows', () => {
    expect(
      neededDirectionsOf({ messageTypes: ['ORDERS'], flows: [{ messageType: 'INVOIC' }] }),
    ).toEqual(['inbound', 'outbound'])
  })

  it('needs both directions without chosen Message Types or Flows', () => {
    expect(neededDirectionsOf({ messageTypes: null, flows: [] })).toEqual(['inbound', 'outbound'])
    expect(neededDirectionsOf({ messageTypes: [], flows: [] })).toEqual(['inbound', 'outbound'])
  })
})

describe('channelDirectionsOf', () => {
  it('names each direction a Channel exists for once', () => {
    expect(
      channelDirectionsOf([
        { direction: 'outbound' },
        { direction: 'inbound' },
        { direction: 'outbound' },
      ]),
    ).toEqual(['inbound', 'outbound'])
  })

  it('names no direction without Channels', () => {
    expect(channelDirectionsOf([])).toEqual([])
  })
})
