import { describe, expect, it } from 'vitest'

import { parsePage, setPage } from './search-params'

describe('parsePage', () => {
  it('reads a positive page and falls back to the first page', () => {
    expect(parsePage(new URLSearchParams('page=3'))).toBe(3)
    expect(parsePage(new URLSearchParams('page=0'))).toBe(1)
    expect(parsePage(new URLSearchParams('page=1234567'))).toBe(1)
    expect(parsePage(new URLSearchParams(''))).toBe(1)
  })
})

describe('setPage', () => {
  it('leaves the first page out of the URL', () => {
    const params = new URLSearchParams()

    setPage(params, 1)
    expect(params.toString()).toBe('')
    setPage(params, 2)
    expect(params.toString()).toBe('page=2')
  })
})
