import { describe, expect, it } from 'vitest'

import { onlyDocumentStructureId } from './document-structures'

describe('onlyDocumentStructureId', () => {
  it('names the Document Structure only when the Workspace has exactly one', () => {
    expect(onlyDocumentStructureId([{ id: 'erp-json' }])).toBe('erp-json')
    expect(onlyDocumentStructureId([{ id: 'erp-json' }, { id: 'erp-csv' }])).toBeNull()
    expect(onlyDocumentStructureId([])).toBeNull()
    expect(onlyDocumentStructureId(undefined)).toBeNull()
  })
})
