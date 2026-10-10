import { describe, expect, it } from 'vitest'

import { insertText, jsonataPath, textPosition } from './expression-text'

describe('jsonataPath', () => {
  it.each([
    ['shipTo.country', 'shipTo.country'],
    ['lines[].vatRate', 'lines.vatRate'],
    ['lines[]', 'lines'],
    ['SG25', 'SG25'],
    ['SG2+DP/NAD+DP/3207', '`SG2+DP`.`NAD+DP`.`3207`'],
    ['SG25/LIN/C212/7140', 'SG25.LIN.C212.`7140`'],
  ])('turns %s into %s', (path, expected) => {
    expect(jsonataPath(path)).toBe(expected)
  })
})

describe('textPosition', () => {
  it('points at the last character of the token the parser stopped at', () => {
    expect(textPosition('foo.bar]', 8)).toEqual({ line: 1, column: 8, offset: 8 })
  })

  it('counts lines and columns across line breaks', () => {
    expect(textPosition('x\n  and (', 9)).toEqual({ line: 2, column: 7, offset: 9 })
  })

  it('stays inside the text', () => {
    expect(textPosition('', 3)).toEqual({ line: 1, column: 1, offset: 0 })
    expect(textPosition('ab', 9)).toEqual({ line: 1, column: 2, offset: 2 })
  })
})

describe('insertText', () => {
  it('replaces the selection and puts the caret after the inserted text', () => {
    expect(insertText('$sum()', 5, 5, 'lines.lineAmount')).toEqual({
      value: '$sum(lines.lineAmount)',
      caret: 21,
    })
    expect(insertText('a + b', 4, 5, 'c')).toEqual({ value: 'a + c', caret: 5 })
  })
})
