import { describe, expect, it } from 'vitest'

import { whoFixes } from './who-fixes'

describe('whoFixes', () => {
  it('leaves a Run without a Failure Stage to nobody', () => {
    expect(whoFixes({ failureStage: null, direction: 'inbound' })).toBeNull()
  })

  it('asks the Trading Partner to resend an inbound Run that could not be read or validated', () => {
    expect(whoFixes({ failureStage: 'parse', direction: 'inbound' })).toBe('partner')
    expect(whoFixes({ failureStage: 'validation', direction: 'inbound' })).toBe('partner')
  })

  it('leaves an outbound validation failure to the Workspace', () => {
    expect(whoFixes({ failureStage: 'validation', direction: 'outbound' })).toBe('you')
  })

  it('leaves a mapping failure to the Workspace in both directions', () => {
    expect(whoFixes({ failureStage: 'mapping', direction: 'inbound' })).toBe('you')
    expect(whoFixes({ failureStage: 'mapping', direction: 'outbound' })).toBe('you')
  })

  it('offers a retry for a delivery failure', () => {
    expect(whoFixes({ failureStage: 'delivery', direction: 'outbound' })).toBe('retry')
  })
})
