import { describe, expect, it } from 'vitest'

import { messageTypes } from '@edi-bridge/contracts'

import messages from '../messages/en.json'
import { glossaryEntries, helpHref } from './glossary'

describe('glossaryEntries', () => {
  it('has one entry for every term and Message Type', () => {
    expect(glossaryEntries.map((entry) => entry.key).toSorted()).toEqual(
      [...Object.keys(messages.Help.terms), ...messageTypes].toSorted(),
    )
  })

  it('gives every entry a unique anchor id', () => {
    const ids = glossaryEntries.map((entry) => entry.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => /^[a-z]+(-[a-z]+)*$/.test(id))).toBe(true)
  })
})

describe('helpHref', () => {
  it('links to the entry on the help page', () => {
    expect(helpHref('lookupTable')).toBe('/help#lookup-table')
    expect(helpHref('ORDERS')).toBe('/help#orders')
  })
})
