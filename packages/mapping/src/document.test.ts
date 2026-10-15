import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  type CsvSettings,
  defaultCsvSettings,
  inferDocumentStructure,
  toEncodedFile,
} from '@edi-bridge/contracts'

import { readDocument } from './index'

const csvStructure = (sample: string, csv: Partial<CsvSettings> = {}) =>
  inferDocumentStructure({
    kind: 'csvDocument',
    document: toEncodedFile('lines.csv', sample),
    csv: { ...defaultCsvSettings, ...csv },
  })

const jsonStructure = (sample: string) =>
  inferDocumentStructure({ kind: 'jsonDocument', document: toEncodedFile('order.json', sample) })

const lineSample = 'gtin;quantity\n4000862141404;12\n'

const read = (...args: Parameters<typeof readDocument>) => Effect.runPromise(readDocument(...args))

const failure = (...args: Parameters<typeof readDocument>) =>
  Effect.runPromise(Effect.flip(readDocument(...args)))

describe('readDocument', () => {
  it('reads each row of a CSV Document as an item of the root list, keyed by its columns', async () => {
    const document = 'gtin;quantity\r\n4000862141404;12\r\n4000862141411;\r\n'

    expect(await read(csvStructure(lineSample), document)).toEqual({
      rows: [
        { gtin: '4000862141404', quantity: '12' },
        { gtin: '4000862141411', quantity: '' },
      ],
    })
  })

  it('reads the columns of a CSV Document by their position, not by the header row', async () => {
    const document = 'GTIN;Menge\n4000862141404;12\n'

    expect(await read(csvStructure(lineSample), document)).toEqual({
      rows: [{ gtin: '4000862141404', quantity: '12' }],
    })
  })

  it('reads the first row of a CSV Document without a header row as data', async () => {
    const structure = csvStructure('4000862141404,12\n', { delimiter: ',', headerRow: false })

    expect(await read(structure, '4000862141404,12\n4000862141411,5')).toEqual({
      rows: [
        { column1: '4000862141404', column2: '12' },
        { column1: '4000862141411', column2: '5' },
      ],
    })
  })

  it('reads a column under the name the Document Structure gave it', async () => {
    const structure = csvStructure('unit.code;unit.code\nPCE;KGM\n')

    expect(await read(structure, 'unit.code;unit.code\nST;KG\n')).toEqual({
      rows: [{ unit_code: 'ST', unit_code_2: 'KG' }],
    })
  })

  it('reads quoted CSV cells with the delimiter, quotes and line breaks in them', async () => {
    const document = 'gtin;quantity\n"4000862141404";"12;5 ""approx.""\nper box"\n'

    expect(await read(csvStructure(lineSample), document)).toEqual({
      rows: [{ gtin: '4000862141404', quantity: '12;5 "approx."\nper box' }],
    })
  })

  it('fails naming the line of a CSV quote that is never closed', async () => {
    expect(
      await failure(
        csvStructure(lineSample),
        'gtin;quantity\n4000862141404;12\n"4000862141411;5\n',
      ),
    ).toMatchObject({ code: 'invalidCsv', line: 3 })
  })

  it('fails naming the line of a CSV row with more cells than the structure has columns', async () => {
    expect(
      await failure(
        csvStructure(lineSample),
        'gtin;quantity\n4000862141404;12\n4000862141411;5;7\n',
      ),
    ).toMatchObject({ code: 'invalidCsv', line: 3 })
  })

  it('reads a JSON Document whose root is a list as the items of its root list', async () => {
    const structure = jsonStructure('[{ "gtin": "4000862141404" }]')

    expect(
      await read(structure, '[{ "gtin": "4000862141411" }, { "gtin": "4000862141428" }]'),
    ).toEqual({ items: [{ gtin: '4000862141411' }, { gtin: '4000862141428' }] })
  })

  it('reads a JSON Document whose root is an object as it is', async () => {
    const structure = jsonStructure('{ "orderNumber": "PO-4711" }')

    expect(await read(structure, '{ "orderNumber": "PO-4712", "lines": [] }')).toEqual({
      orderNumber: 'PO-4712',
      lines: [],
    })
  })

  it.each([
    ['a list', 'an object', '[{ "gtin": "4000862141404" }]', '{ "gtin": "4000862141404" }'],
    ['an object', 'a list', '{ "orderNumber": "PO-4711" }', '[{ "orderNumber": "PO-4711" }]'],
    ['an object', 'a text', '{ "orderNumber": "PO-4711" }', '"PO-4711"'],
  ])(
    'fails when the structure has %s at the root and the JSON Document %s',
    async (_, __, sample, document) => {
      expect(await failure(jsonStructure(sample), document)).toMatchObject({
        code: 'unexpectedRoot',
        line: null,
      })
    },
  )

  it('fails for a JSON Document that does not parse', async () => {
    expect(
      await failure(jsonStructure('{ "orderNumber": "PO-4711" }'), '{ "orderNumber": '),
    ).toMatchObject({ code: 'invalidJson', line: null })
  })
})
