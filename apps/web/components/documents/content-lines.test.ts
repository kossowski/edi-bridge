import { describe, expect, it } from 'vitest'

import type { ParsedMessage, ParsedSegment } from '@edi-bridge/contracts'

import {
  contentColumns,
  contentLines,
  isMissing,
  isNumeric,
  missingPieceOf,
  shownColumns,
} from './content-lines'

function seg(tag: string, ...elements: Array<string | string[]>): ParsedSegment {
  return { tag, name: null, elements: elements.map((element) => [element].flat()) }
}

function message(...segments: ParsedSegment[]): ParsedMessage {
  return { reference: '1', messageType: 'ORDERS', segments: [seg('UNH', '1'), ...segments] }
}

describe('contentLines', () => {
  it('reads the line number, GTIN, quantity and unit of each line', () => {
    const lines = contentLines(
      message(
        seg('BGM', '220', 'PO4711', '9'),
        seg('LIN', '1', '', ['4006381333931', 'EN']),
        seg('QTY', ['21', '40', 'PCE']),
        seg('LIN', '2', '', ['4006381333948', 'EN']),
        seg('QTY', ['21', '12', 'KRT']),
        seg('UNS', 'S'),
      ),
    )

    expect(lines).toEqual([
      {
        line: '1',
        item: null,
        gtin: '4006381333931',
        quantity: '40',
        unit: 'PCE',
        amount: null,
      },
      {
        line: '2',
        item: null,
        gtin: '4006381333948',
        quantity: '12',
        unit: 'KRT',
        amount: null,
      },
    ])
  })

  it('reads the item description and the line amount', () => {
    const [line] = contentLines(
      message(
        seg('LIN', '1', '', ['4006381333931', 'EN']),
        seg('IMD', 'F', '', ['', '', '', 'Garden hose 25 m']),
        seg('QTY', ['47', '40', 'PCE']),
        seg('MOA', ['203', '399.60']),
        seg('MOA', ['86', '399.60']),
      ),
    )

    expect(line).toMatchObject({ item: 'Garden hose 25 m', amount: '399.60' })
  })

  it('leaves an empty GTIN as missing', () => {
    const [line] = contentLines(message(seg('LIN', '1', '', ['', 'EN'])))

    expect(line!.gtin).toBeNull()
  })

  it('has no lines when the message has no line items', () => {
    expect(contentLines(message(seg('UCI', '1')))).toEqual([])
  })
})

describe('shownColumns', () => {
  it('shows item and amount only when a line has them', () => {
    const lines = contentLines(
      message(seg('LIN', '1', '', ['4006381333931', 'EN']), seg('QTY', ['21', '1', 'PCE'])),
    )

    expect(shownColumns(lines)).toEqual(['gtin', 'quantity', 'unit'])
  })
})

describe('isNumeric', () => {
  it('treats quantity and amount as numbers', () => {
    expect(contentColumns.filter((column) => isNumeric(column))).toEqual(['quantity', 'amount'])
  })
})

describe('missingPieceOf', () => {
  it('finds the code a code translation lacks', () => {
    expect(
      missingPieceOf({
        kind: 'lookupTable',
        lookupTableId: '00000000-0000-4000-8000-000000000001',
        name: 'Units of measure',
        code: 'KRT',
      }),
    ).toEqual({ kind: 'code', code: 'KRT' })
  })

  it('finds the line column of a missing mapping field', () => {
    expect(
      missingPieceOf({
        kind: 'mapping',
        mappingId: '00000000-0000-4000-8000-000000000001',
        name: 'INVOIC',
        fieldPath: 'packages[].lines[].gtin',
      }),
    ).toEqual({ kind: 'field', column: 'gtin' })
  })

  it('ignores fields outside the lines', () => {
    expect(
      missingPieceOf({
        kind: 'mapping',
        mappingId: '00000000-0000-4000-8000-000000000001',
        name: 'DESADV',
        fieldPath: 'buyer.gln',
      }),
    ).toBeNull()
  })

  it('has nothing to point at without a fix target', () => {
    expect(missingPieceOf(null)).toBeNull()
  })
})

describe('isMissing', () => {
  const line = {
    line: '1',
    item: null,
    gtin: null,
    quantity: '12',
    unit: 'KRT',
    amount: null,
  }

  it('marks the cell holding the untranslated code', () => {
    expect(isMissing(line, 'unit', { kind: 'code', code: 'KRT' })).toBe(true)
    expect(isMissing(line, 'quantity', { kind: 'code', code: 'KRT' })).toBe(false)
  })

  it('marks an empty cell of the missing field', () => {
    expect(isMissing(line, 'gtin', { kind: 'field', column: 'gtin' })).toBe(true)
    expect(isMissing(line, 'item', { kind: 'field', column: 'gtin' })).toBe(false)
  })
})
