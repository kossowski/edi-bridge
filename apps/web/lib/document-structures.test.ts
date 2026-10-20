import { describe, expect, it } from 'vitest'

import { ApiError } from './api/client'
import { isMissingDocumentStructure, onlyDocumentStructureId } from './document-structures'

describe('onlyDocumentStructureId', () => {
  it('names the Document Structure only when the Workspace has exactly one', () => {
    expect(onlyDocumentStructureId([{ id: 'erp-json' }])).toBe('erp-json')
    expect(onlyDocumentStructureId([{ id: 'erp-json' }, { id: 'erp-csv' }])).toBeNull()
    expect(onlyDocumentStructureId([])).toBeNull()
    expect(onlyDocumentStructureId(undefined)).toBeNull()
  })
})

describe('isMissingDocumentStructure', () => {
  it('reads a rejected create as a missing Document Structure only on status 422', () => {
    expect(isMissingDocumentStructure(new ApiError(422, '/mappings'))).toBe(true)
    expect(isMissingDocumentStructure(new ApiError(500, '/mappings'))).toBe(false)
    expect(isMissingDocumentStructure(new Error('offline'))).toBe(false)
    expect(isMissingDocumentStructure(null)).toBe(false)
  })
})
