import { describe, expect, it } from 'vitest'

import { messageTypeStructures } from '@edi-bridge/contracts'
import { seedDocumentStructureOf } from '@edi-bridge/mocks'

import { failingFieldName, findFailingField, repetitionFree } from './failing-field'
import { documentTree, edifactTree } from './mapping-tree'

const outbound = {
  source: documentTree(seedDocumentStructureOf.DESADV),
  target: edifactTree(messageTypeStructures.DESADV, 'en'),
}

const inbound = {
  source: edifactTree(messageTypeStructures.ORDERS, 'en'),
  target: documentTree(seedDocumentStructureOf.ORDERS),
}

describe('repetitionFree', () => {
  it('turns a numbered repetition into the tree notation', () => {
    expect(repetitionFree('packages[3].lines[12].gtin')).toBe('packages[].lines[].gtin')
  })

  it('keeps a path without repetitions', () => {
    expect(repetitionFree(' buyer.gln ')).toBe('buyer.gln')
  })
})

describe('findFailingField', () => {
  it('finds a source field inside repeating parts, with the parts that hold it', () => {
    const found = findFailingField('packages[].lines[].gtin', outbound)

    expect(found?.row).toEqual({ side: 'source', path: 'packages[].lines[].gtin' })
    expect(found?.item.label).toBe('gtin')
    expect(found?.ancestors.map(({ path }) => path)).toEqual(['packages[]', 'packages[].lines[]'])
  })

  it('finds a field of one numbered repetition', () => {
    expect(findFailingField('packages[0].lines[4].gtin', outbound)?.row).toEqual({
      side: 'source',
      path: 'packages[].lines[].gtin',
    })
  })

  it('finds a field written without the repetition marks', () => {
    expect(findFailingField('lines.gtin', inbound)?.row).toEqual({
      side: 'target',
      path: 'lines[].gtin',
    })
  })

  it('finds a target field of a Document Structure', () => {
    const found = findFailingField('buyer.gln', inbound)

    expect(found?.row).toEqual({ side: 'target', path: 'buyer.gln' })
    expect(found?.ancestors.map(({ label }) => label)).toEqual(['buyer'])
  })

  it('finds an EDIFACT element by its segment path', () => {
    const found = findFailingField('SG25/LIN/C212/7140', inbound)

    expect(found?.row).toEqual({ side: 'source', path: 'SG25/LIN/C212/7140' })
    expect(found?.ancestors.map(({ path }) => path)).toEqual(['SG25', 'SG25/LIN', 'SG25/LIN/C212'])
  })

  it('finds a target element of a qualified segment, as a fix link names it', () => {
    const invoice = {
      source: documentTree(seedDocumentStructureOf.INVOIC),
      target: edifactTree(messageTypeStructures.INVOIC, 'en'),
    }

    expect(findFailingField('BGM/1004', invoice)?.row).toEqual({ side: 'target', path: 'BGM/1004' })

    const found = findFailingField('SG25/IMD+A/C273/7008', invoice)

    expect(found?.row).toEqual({ side: 'target', path: 'SG25/IMD+A/C273/7008' })
    expect(found?.ancestors.map(({ path }) => path)).toEqual([
      'SG25',
      'SG25/IMD+A',
      'SG25/IMD+A/C273',
    ])
  })

  it('finds nothing for a path neither side has', () => {
    expect(findFailingField('nowhere.field', inbound)).toBeNull()
    expect(findFailingField('  ', inbound)).toBeNull()
  })
})

describe('failingFieldName', () => {
  it('names a field by the parts down to it, with its plain name', () => {
    expect(failingFieldName(findFailingField('lines[].gtin', inbound)!)).toBe(
      'lines › gtin (Article number (GTIN))',
    )
  })

  it('adds the meaning of an EDIFACT element', () => {
    expect(failingFieldName(findFailingField('SG25/LIN/1082', inbound)!)).toBe(
      'SG25 › LIN › 1082 (Line item number)',
    )
  })
})
