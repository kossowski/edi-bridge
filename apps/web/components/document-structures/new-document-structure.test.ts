import { describe, expect, it } from 'vitest'

import type { DocumentField, DocumentStructureNode } from '@edi-bridge/contracts'

import { namesToCheck, readingSteps, saveBlock } from './new-document-structure'

function field(path: string, label: string, labelUnsure = false): DocumentField {
  return {
    path,
    name: path.split('.').at(-1)!,
    label,
    labelReason: 'Read from the column name.',
    labelUnsure,
    required: true,
    kind: 'field',
    type: 'string',
  }
}

const invoiceRows: DocumentStructureNode[] = [
  {
    path: 'rows[]',
    name: 'rows',
    label: 'Rows',
    labelReason: 'Each line of the file.',
    labelUnsure: false,
    required: true,
    kind: 'array',
    items: {
      path: 'rows[]',
      name: 'rows',
      label: 'Rows',
      labelReason: 'Each line of the file.',
      labelUnsure: false,
      required: true,
      kind: 'object',
      children: [
        field('rows[].RechNr', 'Invoice number'),
        field('rows[].ME', 'Unit', true),
        field('rows[].EPreis', 'Unit price', true),
      ],
    },
  },
]

describe('namesToCheck', () => {
  it('lists the unsure names nobody has confirmed or renamed yet, in file order', () => {
    expect(namesToCheck(invoiceRows, new Map()).map(({ path }) => path)).toEqual([
      'rows[].ME',
      'rows[].EPreis',
    ])
  })

  it('drops a name once it is confirmed or renamed', () => {
    const choices = new Map([['rows[].EPreis', 'Price per unit']])

    expect(namesToCheck(invoiceRows, choices).map(({ path }) => path)).toEqual(['rows[].ME'])
  })
})

describe('readingSteps', () => {
  it('opens the file before anything else', () => {
    expect(readingSteps('opening')).toEqual([
      { key: 'opening', state: 'active' },
      { key: 'finding', state: 'pending' },
      { key: 'naming', state: 'pending' },
    ])
  })

  it('finds the fields while the file is being read', () => {
    expect(readingSteps('reading')).toEqual([
      { key: 'opening', state: 'done' },
      { key: 'finding', state: 'active' },
      { key: 'naming', state: 'pending' },
    ])
  })

  it('has every step done once the file is read', () => {
    expect(readingSteps('read').map(({ state }) => state)).toEqual(['done', 'done', 'done'])
  })
})

describe('saveBlock', () => {
  it('asks to check the names first while any is left', () => {
    expect(saveBlock(2, '')).toEqual({ reason: 'names', count: 2 })
  })

  it('asks for a name once every name is checked', () => {
    expect(saveBlock(0, '   ')).toEqual({ reason: 'name' })
  })

  it('lets a named format with every name checked be saved', () => {
    expect(saveBlock(0, 'Invoice export')).toBeNull()
  })
})
