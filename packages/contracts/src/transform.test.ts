import { describe, expect, it } from 'vitest'

import { mappingDraftSchema } from './mapping'
import {
  type MappingTransform,
  mappingTransformSchema,
  transformConfigIssues,
  transformConfigSchemas,
  transformPorts,
} from './transform'

let next = 0

function node(transform: Pick<MappingTransform, 'kind' | 'config'>): MappingTransform {
  next += 1

  return mappingTransformSchema.parse({
    id: `0000000a-0000-4000-8000-${String(next).padStart(12, '0')}`,
    position: { x: 0, y: 0 },
    ...transform,
  })
}

const valid: ReadonlyArray<Pick<MappingTransform, 'kind' | 'config'>> = [
  { kind: 'constant', config: { value: '380' } },
  { kind: 'concatenate', config: { inputCount: 2, separator: ' ' } },
  { kind: 'split', config: { separator: '-', index: 0 } },
  { kind: 'substring', config: { start: 0, length: 35 } },
  { kind: 'substring', config: { start: 3, length: null } },
  { kind: 'dateFormat', config: { from: 'yyyy-MM-dd', to: 'yyyyMMdd' } },
  { kind: 'dateFormat', config: { from: 'dd.MM.yyyy HH:mm', to: 'yyyyMMddHHmm' } },
  { kind: 'numberFormat', config: { decimalPlaces: 2, decimalSeparator: '.' } },
  { kind: 'numberFormat', config: { decimalPlaces: null, decimalSeparator: ',' } },
  {
    kind: 'lookupTable',
    config: { lookupTableId: '00000008-0000-4000-8000-000000000001', fallback: 'keepValue' },
  },
  { kind: 'conditional', config: { operator: 'equals', compareTo: 'true' } },
  { kind: 'conditional', config: { operator: 'isEmpty', compareTo: '' } },
  { kind: 'loop', config: { counterStart: 1 } },
  { kind: 'jsonata', config: { expression: '$sum(lines.lineAmount)' } },
]

describe('transformConfigIssues', () => {
  it.each(valid.map((transform) => [transform.kind, transform] as const))(
    'finds nothing wrong with a configured %s node',
    (_, transform) => {
      expect(transformConfigIssues(node(transform))).toEqual([])
    },
  )

  it.each([
    [
      'a constant without a value',
      { kind: 'constant', config: { value: '' } },
      'value',
      'required',
    ],
    [
      'a concatenation of a single part',
      { kind: 'concatenate', config: { inputCount: 1, separator: '' } },
      'inputCount',
      'outOfRange',
    ],
    [
      'a split without a separator',
      { kind: 'split', config: { separator: '', index: 0 } },
      'separator',
      'required',
    ],
    [
      'a split taking a part before the first',
      { kind: 'split', config: { separator: '-', index: -1 } },
      'index',
      'outOfRange',
    ],
    [
      'a substring starting before the first character',
      { kind: 'substring', config: { start: -1, length: 3 } },
      'start',
      'outOfRange',
    ],
    [
      'a substring of no characters',
      { kind: 'substring', config: { start: 0, length: 0 } },
      'length',
      'outOfRange',
    ],
    [
      'a date format without an input pattern',
      { kind: 'dateFormat', config: { from: '', to: 'yyyyMMdd' } },
      'from',
      'required',
    ],
    [
      'a date format with an unknown token',
      { kind: 'dateFormat', config: { from: 'yyyy-MM-dd', to: 'CCYYMMDD' } },
      'to',
      'invalidPattern',
    ],
    [
      'a date format without a day',
      { kind: 'dateFormat', config: { from: 'yyyy-MM', to: 'yyyyMMdd' } },
      'from',
      'invalidPattern',
    ],
    [
      'a number format with too many decimal places',
      { kind: 'numberFormat', config: { decimalPlaces: 7, decimalSeparator: '.' } },
      'decimalPlaces',
      'outOfRange',
    ],
    [
      'a Lookup Table node without a table',
      { kind: 'lookupTable', config: { lookupTableId: null, fallback: 'fail' } },
      'lookupTableId',
      'required',
    ],
    [
      'a comparison without a value to compare to',
      { kind: 'conditional', config: { operator: 'contains', compareTo: '' } },
      'compareTo',
      'required',
    ],
    [
      'a loop counting from below zero',
      { kind: 'loop', config: { counterStart: -1 } },
      'counterStart',
      'outOfRange',
    ],
    [
      'an empty JSONata expression',
      { kind: 'jsonata', config: { expression: '  ' } },
      'expression',
      'required',
    ],
    [
      'a JSONata expression that does not parse',
      { kind: 'jsonata', config: { expression: '$sum(lines.lineAmount' } },
      'expression',
      'invalidExpression',
    ],
  ] as const)('reports %s', (_, transform, field, code) => {
    expect(transformConfigIssues(node(transform))).toEqual([{ field, code }])
  })

  it('reports every field that is wrong', () => {
    const split = node({ kind: 'split', config: { separator: '', index: -2 } })

    expect(transformConfigIssues(split)).toEqual([
      { field: 'separator', code: 'required' },
      { field: 'index', code: 'outOfRange' },
    ])
  })

  it('keeps a Draft with invalid configurations loadable', () => {
    const constant = node({ kind: 'constant', config: { value: '' } })

    const draft = {
      mappingId: '00000007-0000-4000-8000-000000000001',
      name: 'Hansemarkt: ERP JSON to DESADV',
      direction: 'outbound',
      source: {
        kind: 'documentStructure',
        documentStructureId: '00000006-0000-4000-8000-000000000002',
        name: 'ERP dispatch advice',
      },
      target: { kind: 'messageType', messageType: 'DESADV' },
      links: [],
      transforms: [constant],
      transformLinks: [],
      updatedAt: '2026-09-14T08:30:00.000Z',
    }

    expect(mappingDraftSchema.safeParse(draft).success).toBe(true)
    expect(transformConfigIssues(constant)).toHaveLength(1)
  })
})

describe('transformConfigSchemas', () => {
  it('validates a configuration on its own, e.g. in a form', () => {
    expect(transformConfigSchemas.substring.safeParse({ start: 2, length: 4 }).success).toBe(true)
    expect(transformConfigSchemas.substring.safeParse({ start: 2, length: 0 }).success).toBe(false)
  })
})

describe('transformPorts', () => {
  it('gives a concatenation one input per part', () => {
    const concatenate = node({ kind: 'concatenate', config: { inputCount: 3, separator: '' } })

    expect(transformPorts(concatenate)).toEqual({
      inputs: ['part1', 'part2', 'part3'],
      outputs: ['value'],
    })
  })

  it('lets a loop repeat a part and count its items', () => {
    expect(transformPorts(node({ kind: 'loop', config: { counterStart: 1 } }))).toEqual({
      inputs: ['items'],
      outputs: ['items', 'counter'],
    })
  })
})
