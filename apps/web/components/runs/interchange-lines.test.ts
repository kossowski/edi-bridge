import { describe, expect, it } from 'vitest'

import { interchangeLines } from './interchange-lines'

const raw =
  "UNA:+.? 'UNB+UNOC:3+0212345000004:14+0298765000006:14+261001:0800+42'" +
  "UNH+1+ORDERS:D:96A:UN:EAN008'DTM+137:20261341:102'NAD+SU+::9'UNT+4+1'UNZ+1+42'"

function highlighted(result: ReturnType<typeof interchangeLines>) {
  const line = result.lines.find(({ highlight }) => highlight !== null)

  return line && line.text.slice(line.highlight![0], line.highlight![1])
}

describe('interchangeLines', () => {
  it('puts the service string advice and each segment on its own numbered line', () => {
    const { lines } = interchangeLines(raw, null)

    expect(lines.map(({ number, text }) => [number, text])).toEqual([
      [null, "UNA:+.? '"],
      [1, "UNB+UNOC:3+0212345000004:14+0298765000006:14+261001:0800+42'"],
      [2, "UNH+1+ORDERS:D:96A:UN:EAN008'"],
      [3, "DTM+137:20261341:102'"],
      [4, "NAD+SU+::9'"],
      [5, "UNT+4+1'"],
      [6, "UNZ+1+42'"],
    ])
  })

  it('highlights the component an error names', () => {
    const result = interchangeLines(raw, { segment: 3, tag: 'DTM', element: 1, component: 2 })

    expect(result.precision).toBe('component')
    expect(highlighted(result)).toBe('20261341')
  })

  it('highlights a whole composite element when the error names no component', () => {
    const result = interchangeLines(raw, { segment: 2, tag: 'UNH', element: 2, component: null })

    expect(result.precision).toBe('element')
    expect(highlighted(result)).toBe('ORDERS:D:96A:UN:EAN008')
  })

  it('highlights the segment without its terminator when the error names no element', () => {
    const result = interchangeLines(raw, { segment: 5, tag: 'UNT', element: null, component: null })

    expect(result.precision).toBe('segment')
    expect(highlighted(result)).toBe('UNT+4+1')
  })

  it('marks an empty component as an empty range at its place', () => {
    const result = interchangeLines(raw, { segment: 4, tag: 'NAD', element: 2, component: 1 })
    const line = result.lines[4]!

    expect(result.precision).toBe('component')
    expect(line.highlight).toEqual([7, 7])
  })

  it('falls back to the element when the component is missing from it', () => {
    const result = interchangeLines(raw, { segment: 3, tag: 'DTM', element: 1, component: 5 })

    expect(result.precision).toBe('element')
    expect(highlighted(result)).toBe('137:20261341:102')
  })

  it('falls back to the segment when the element is missing from it', () => {
    const result = interchangeLines(raw, { segment: 5, tag: 'UNT', element: 4, component: null })

    expect(result.precision).toBe('segment')
    expect(highlighted(result)).toBe('UNT+4+1')
  })

  it('highlights nothing when the segment does not exist', () => {
    const result = interchangeLines(raw, { segment: 99, tag: 'LIN', element: 1, component: null })

    expect(result.precision).toBeNull()
    expect(result.lines.every(({ highlight }) => highlight === null)).toBe(true)
  })

  it('honours the release character and the separators declared in UNA', () => {
    const custom = 'UNA|*.# ~UNB*UNOC|3*SENDER*RECEIVER~FTX*AAI***Price #*2 #~ #| ok~UNZ*0*1~'

    const result = interchangeLines(custom, { segment: 2, tag: 'FTX', element: 4, component: 1 })

    expect(result.lines.map(({ text }) => text)).toEqual([
      'UNA|*.# ~',
      'UNB*UNOC|3*SENDER*RECEIVER~',
      'FTX*AAI***Price #*2 #~ #| ok~',
      'UNZ*0*1~',
    ])
    expect(highlighted(result)).toBe('Price #*2 #~ #| ok')
  })

  it('uses the default separators without UNA and ignores line breaks between segments', () => {
    const { lines } = interchangeLines("UNB+UNOC:3+A+B'\r\nUNZ+0+1'\n", null)

    expect(lines.map(({ number, text }) => [number, text])).toEqual([
      [1, "UNB+UNOC:3+A+B'"],
      [2, "UNZ+0+1'"],
    ])
  })

  it.each([
    ['a byte order mark', '\uFEFF'],
    ['leading line breaks and spaces', '\r\n  '],
  ])('recognises UNA after %s', (_, prefix) => {
    const result = interchangeLines(`${prefix}${raw}`, {
      segment: 3,
      tag: 'DTM',
      element: 1,
      component: 2,
    })

    expect(result.lines[0]).toMatchObject({ number: null, text: "UNA:+.? '" })
    expect(highlighted(result)).toBe('20261341')
  })

  it('treats a space in the release position as no release character', () => {
    const { lines } = interchangeLines("UNA:+.  'UNB+UNOC:3+A 'UNZ+0+1'", null)

    expect(lines.map(({ number, text }) => [number, text])).toEqual([
      [null, "UNA:+.  '"],
      [1, "UNB+UNOC:3+A '"],
      [2, "UNZ+0+1'"],
    ])
  })

  it('highlights nothing when the segment at the position has another tag', () => {
    const result = interchangeLines(raw, { segment: 3, tag: 'NAD', element: 1, component: null })

    expect(result.precision).toBeNull()
    expect(result.lines.every(({ highlight }) => highlight === null)).toBe(true)
  })
})
