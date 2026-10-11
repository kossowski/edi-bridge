import { describe, expect, it } from 'vitest'

import { openMessageTypes, orderLifecycleQuerySchema } from './order-lifecycle'

describe('openMessageTypes', () => {
  it('lists DESADV and INVOIC as open steps while only the ORDERS arrived', () => {
    expect(openMessageTypes([{ messageType: 'ORDERS' }])).toEqual(['DESADV', 'INVOIC'])
  })

  it('has no open step once ORDERS, DESADV and INVOIC happened', () => {
    expect(
      openMessageTypes([
        { messageType: 'ORDERS' },
        { messageType: 'DESADV' },
        { messageType: 'DESADV' },
        { messageType: 'INVOIC' },
      ]),
    ).toEqual([])
  })
})

describe('orderLifecycleQuerySchema', () => {
  it('searches for the Business Reference without surrounding spaces', () => {
    expect(orderLifecycleQuerySchema.parse({ businessReference: ' 4711 ' })).toEqual({
      businessReference: '4711',
    })
  })

  it('rejects an empty Business Reference', () => {
    expect(orderLifecycleQuerySchema.safeParse({ businessReference: '  ' }).success).toBe(false)
  })
})
