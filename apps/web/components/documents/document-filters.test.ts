import { describe, expect, it } from 'vitest'

import {
  documentFiltersSearch,
  documentsHref,
  emptyDocumentFilters,
  hasSearchFilters,
  parseDocumentFilters,
  statusGroupCount,
  toInterchangeListQuery,
  toRunListQuery,
} from './document-filters'

const partnerId = '0b9f8f5e-3c1a-4d4e-9a57-1f2e3d4c5b6a'

const mappingId = '7c2d1e0f-9a8b-4c7d-8e6f-5a4b3c2d1e0f'

describe('parseDocumentFilters', () => {
  it('starts at the documents that need attention', () => {
    expect(parseDocumentFilters(new URLSearchParams())).toEqual(emptyDocumentFilters)
  })

  it('reads every filter from the URL', () => {
    expect(
      parseDocumentFilters(
        new URLSearchParams({
          view: 'transmissions',
          status: 'done',
          q: 'PO1',
          partner: partnerId,
          type: 'INVOIC',
          page: '3',
        }),
      ),
    ).toEqual({
      view: 'transmissions',
      status: 'done',
      q: 'PO1',
      tradingPartnerId: partnerId,
      messageType: 'INVOIC',
      mappingId: '',
      page: 3,
    })
  })

  it('reads the Mapping in the documents view only', () => {
    expect(parseDocumentFilters(new URLSearchParams({ mapping: mappingId })).mappingId).toBe(
      mappingId,
    )
    expect(
      parseDocumentFilters(new URLSearchParams({ view: 'transmissions', mapping: mappingId }))
        .mappingId,
    ).toBe('')
  })

  it('ignores values the list cannot show', () => {
    expect(
      parseDocumentFilters(
        new URLSearchParams({
          view: 'files',
          status: 'failed',
          partner: 'acme',
          type: 'ORDRSP',
          mapping: 'orders',
          page: '0',
        }),
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

  it('leaves out the default status group in the transmissions view', () => {
    expect(documentFiltersSearch({ ...emptyDocumentFilters, view: 'transmissions' })).toBe(
      'view=transmissions',
    )
    expect(
      documentFiltersSearch({ ...emptyDocumentFilters, view: 'transmissions', status: 'done' }),
    ).toBe('view=transmissions&status=done')
  })

  it('writes the Mapping in the documents view only', () => {
    expect(documentFiltersSearch({ ...emptyDocumentFilters, mappingId })).toBe(
      `status=attention&mapping=${mappingId}`,
    )
    expect(
      documentFiltersSearch({ ...emptyDocumentFilters, view: 'transmissions', mappingId }),
    ).toBe('view=transmissions')
  })

  it('round-trips through parseDocumentFilters', () => {
    const filters = {
      view: 'transmissions',
      status: 'progress',
      q: 'Hanse',
      tradingPartnerId: partnerId,
      messageType: 'ORDERS',
      mappingId: '',
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

  it('links to the documents of one Mapping that need attention', () => {
    expect(documentsHref({ status: 'attention', mappingId })).toBe(
      `/documents?status=attention&mapping=${mappingId}`,
    )
  })
})

describe('hasSearchFilters', () => {
  it('counts search, partner, document type and Mapping but not the status group', () => {
    expect(hasSearchFilters({ ...emptyDocumentFilters, status: 'done' })).toBe(false)
    expect(hasSearchFilters({ ...emptyDocumentFilters, q: 'PO' })).toBe(true)
    expect(hasSearchFilters({ ...emptyDocumentFilters, messageType: 'DESADV' })).toBe(true)
    expect(hasSearchFilters({ ...emptyDocumentFilters, mappingId })).toBe(true)
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
        view: 'documents',
        status: 'done',
        q: ' PO1 ',
        tradingPartnerId: partnerId,
        messageType: 'INVOIC',
        mappingId,
        page: 2,
      }),
    ).toEqual({
      status: ['delivered', 'duplicate'],
      tradingPartnerId: [partnerId],
      messageType: ['INVOIC'],
      mappingId: [mappingId],
      q: 'PO1',
      page: 2,
      pageSize: 50,
    })
  })
})

describe('toInterchangeListQuery', () => {
  it('passes the filters and the page but no status', () => {
    expect(
      toInterchangeListQuery({
        ...emptyDocumentFilters,
        view: 'transmissions',
        status: 'done',
        q: ' 00123 ',
        messageType: 'ORDERS',
        mappingId,
      }),
    ).toEqual({
      tradingPartnerId: undefined,
      messageType: ['ORDERS'],
      q: '00123',
      page: 1,
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
