import { describe, expect, it } from 'vitest'

import {
  documentFiltersSearch,
  documentsHref,
  emptyDocumentFilters,
  hasSearchFilters,
  parseDocumentFilters,
  statusGroupCount,
  toRunListQuery,
} from './document-filters'

const partnerId = '0b9f8f5e-3c1a-4d4e-9a57-1f2e3d4c5b6a'

describe('parseDocumentFilters', () => {
  it('starts at the documents that need attention', () => {
    expect(parseDocumentFilters(new URLSearchParams())).toEqual(emptyDocumentFilters)
  })

  it('reads every filter from the URL', () => {
    expect(
      parseDocumentFilters(
        new URLSearchParams({
          status: 'done',
          q: 'PO1',
          partner: partnerId,
          type: 'INVOIC',
          page: '3',
        }),
      ),
    ).toEqual({
      status: 'done',
      q: 'PO1',
      tradingPartnerId: partnerId,
      messageType: 'INVOIC',
      page: 3,
    })
  })

  it('ignores values the list cannot show', () => {
    expect(
      parseDocumentFilters(
        new URLSearchParams({ status: 'failed', partner: 'acme', type: 'ORDRSP', page: '0' }),
      ),
    ).toEqual(emptyDocumentFilters)
  })
})

describe('documentFiltersSearch', () => {
  it('writes the status group and only the filters in use', () => {
    expect(documentFiltersSearch(emptyDocumentFilters)).toBe('status=attention')
    expect(
      documentFiltersSearch({ ...emptyDocumentFilters, status: 'all', q: '  ', page: 2 }),
    ).toBe('status=all&page=2')
  })

  it('round-trips through parseDocumentFilters', () => {
    const filters = {
      status: 'progress',
      q: 'Hanse',
      tradingPartnerId: partnerId,
      messageType: 'ORDERS',
      page: 4,
    } as const

    expect(parseDocumentFilters(new URLSearchParams(documentFiltersSearch(filters)))).toEqual(
      filters,
    )
  })
})

describe('documentsHref', () => {
  it('links to the documents of one Trading Partner', () => {
    expect(documentsHref({ status: 'all', tradingPartnerId: partnerId })).toBe(
      `/documents?status=all&partner=${partnerId}`,
    )
  })
})

describe('hasSearchFilters', () => {
  it('counts search, partner and document type but not the status group', () => {
    expect(hasSearchFilters({ ...emptyDocumentFilters, status: 'done' })).toBe(false)
    expect(hasSearchFilters({ ...emptyDocumentFilters, q: 'PO' })).toBe(true)
    expect(hasSearchFilters({ ...emptyDocumentFilters, messageType: 'DESADV' })).toBe(true)
  })
})

describe('toRunListQuery', () => {
  it('asks for the Run Statuses of the chosen group', () => {
    expect(toRunListQuery({ ...emptyDocumentFilters, status: 'progress' }).status).toEqual([
      'received',
      'processing',
    ])
    expect(toRunListQuery({ ...emptyDocumentFilters, status: 'all' }).status).toBeUndefined()
  })

  it('passes the filters and the page', () => {
    expect(
      toRunListQuery({
        status: 'done',
        q: ' PO1 ',
        tradingPartnerId: partnerId,
        messageType: 'INVOIC',
        page: 2,
      }),
    ).toEqual({
      status: ['delivered', 'duplicate'],
      tradingPartnerId: [partnerId],
      messageType: ['INVOIC'],
      q: 'PO1',
      page: 2,
      pageSize: 50,
    })
  })
})

describe('statusGroupCount', () => {
  const statusCounts = { received: 1, processing: 2, delivered: 30, failed: 4, duplicate: 5 }

  it('adds up the Run Statuses of a group', () => {
    expect(statusGroupCount(statusCounts, 'attention')).toBe(4)
    expect(statusGroupCount(statusCounts, 'progress')).toBe(3)
    expect(statusGroupCount(statusCounts, 'done')).toBe(35)
    expect(statusGroupCount(statusCounts, 'all')).toBe(42)
  })
})
