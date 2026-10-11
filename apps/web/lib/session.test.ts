import { describe, expect, it } from 'vitest'

import { sandboxAdminSession, seedSession, showcaseViewerSession } from '@edi-bridge/mocks'

import { canChange } from './session'

describe('canChange', () => {
  it('lets Admins and the Operator change the Workspace', () => {
    expect(canChange(seedSession)).toBe(true)
    expect(canChange(sandboxAdminSession)).toBe(true)
    expect(canChange({ ...showcaseViewerSession, operator: true })).toBe(true)
  })

  it('keeps Viewers and unknown sessions from changing anything', () => {
    expect(canChange(showcaseViewerSession)).toBe(false)
    expect(canChange(null)).toBe(false)
    expect(canChange(undefined)).toBe(false)
  })
})
