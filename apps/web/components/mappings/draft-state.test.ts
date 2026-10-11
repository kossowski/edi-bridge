import { describe, expect, it } from 'vitest'

import { draftState, nextVersion, publishProblem } from './draft-state'

describe('draftState', () => {
  it('tells a Draft that was never published', () => {
    expect(draftState({ latestVersion: null, unpublishedChanges: true })).toEqual({
      kind: 'neverPublished',
    })
  })

  it('tells unpublished changes since the latest Mapping Version', () => {
    expect(draftState({ latestVersion: 3, unpublishedChanges: true })).toEqual({
      kind: 'unpublishedChanges',
      version: 3,
    })
  })

  it('tells a Draft that matches the latest Mapping Version', () => {
    expect(draftState({ latestVersion: 3, unpublishedChanges: false })).toEqual({
      kind: 'published',
      version: 3,
    })
  })
})

describe('nextVersion', () => {
  it('publishes a Draft that was never published as version 1', () => {
    expect(nextVersion({ latestVersion: null, unpublishedChanges: true })).toBe(1)
  })

  it('publishes after the latest Mapping Version', () => {
    expect(nextVersion({ latestVersion: 4, unpublishedChanges: true })).toBe(5)
  })
})

describe('publishProblem', () => {
  it('reads 409 as a Draft without changes', () => {
    expect(publishProblem(409)).toBe('noChanges')
  })

  it('reads 422 as an incomplete Draft', () => {
    expect(publishProblem(422)).toBe('incomplete')
  })

  it('reads 423 as a Draft whose AI review is still open', () => {
    expect(publishProblem(423)).toBe('reviewOpen')
  })

  it('reads any other failure as a failed publish', () => {
    expect(publishProblem(500)).toBe('failed')
    expect(publishProblem(null)).toBe('failed')
  })
})
