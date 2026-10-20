import { describe, expect, it } from 'vitest'

import { isBrokenMessage, parseMessages } from '@edi-bridge/edifact'

import { businessReferenceOf } from './business-reference'
import { golden } from './testing'

// The segments between UNH and UNT, so a test can add or drop one and keep the count right.
const bodyOf = (interchange: string) =>
  interchange.split('\n').filter((line) => line !== '' && !/^UN[BHTZ]/.test(line))

const messageOf = (messageType: string, body: string[]) => {
  const [message] = parseMessages(
    [
      "UNB+UNOC:3+4389876511113:14+4071615111110:14+000320:1200+1'",
      `UNH+1+${messageType}:D:96A:UN:EAN008'`,
      ...body,
      `UNT+${body.length + 2}+1'`,
      "UNZ+1+1'",
    ].join('\n'),
  ).messages

  if (message === undefined || isBrokenMessage(message)) {
    throw new Error('The Interchange holds no readable Message')
  }

  return message
}

const without = (body: string[], segment: RegExp) => body.filter((line) => !segment.test(line))

const orders = bodyOf(golden('orders-reference.edi', 'latin1'))

const invoic = bodyOf(golden('invoic-reference.edi', 'latin1'))

const desadv = [
  "BGM+351+73000152018851234+9'",
  "DTM+137:20221201:102'",
  "RFF+ON:73500010009921111'",
  "NAD+SU+7300015200000::9'",
  "NAD+BY+7350000001204::9'",
  "CPS+1'",
  "LIN+1++07300015200154:SRV'",
  "QTY+12:1500:GRM'",
]

describe('the Business Reference of a Message', () => {
  it('is the BGM document number of an ORDERS', () => {
    expect(businessReferenceOf(messageOf('ORDERS', orders))).toBe('128576')
  })

  it('is the order number of a DESADV', () => {
    expect(businessReferenceOf(messageOf('DESADV', desadv))).toBe('73500010009921111')
  })

  it('is the order number of an INVOIC', () => {
    expect(businessReferenceOf(messageOf('INVOIC', invoic))).toBe('4711')
  })

  it('is the order number of an ORDERS that names one', () => {
    const [bgm = '', ...rest] = orders

    expect(businessReferenceOf(messageOf('ORDERS', [bgm, "RFF+ON:4500017'", ...rest]))).toBe(
      '4500017',
    )
  })

  it('is the BGM document number of a DESADV or INVOIC without an order number', () => {
    expect(businessReferenceOf(messageOf('DESADV', without(desadv, /^RFF\+ON/)))).toBe(
      '73000152018851234',
    )
    expect(businessReferenceOf(messageOf('INVOIC', without(invoic, /^RFF\+ON/)))).toBe('87441')
  })

  it('is the BGM document number of a Message whose order number is empty', () => {
    const [bgm = '', ...rest] = without(desadv, /^RFF\+ON/)

    expect(businessReferenceOf(messageOf('DESADV', [bgm, "RFF+ON'", ...rest]))).toBe(
      '73000152018851234',
    )
    expect(businessReferenceOf(messageOf('DESADV', [bgm, "RFF+ON:'", ...rest]))).toBe(
      '73000152018851234',
    )
  })

  it('is missing from a Message with neither an order number nor a document number', () => {
    expect(businessReferenceOf(messageOf('INVOIC', without(invoic, /^(RFF\+ON|BGM)/)))).toBeNull()
  })
})
