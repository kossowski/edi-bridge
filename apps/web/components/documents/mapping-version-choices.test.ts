import { describe, expect, it } from 'vitest'

import { versionChoices } from './mapping-version-choices'

function version(number: number) {
  return {
    id: `00000000-0000-4000-8000-00000000000${number}`,
    mappingId: '00000000-0000-4000-8000-000000000100',
    mappingName: 'ORDERS to ERP JSON',
    version: number,
    publishedAt: `2026-10-0${number}T08:00:00.000Z`,
  }
}

const versions = [version(1), version(3), version(2)]

describe('versionChoices', () => {
  it('puts the newest version first', () => {
    expect(versionChoices(versions, null).map(({ version }) => version.version)).toEqual([3, 2, 1])
  })

  it('marks the newest version and the one used before', () => {
    expect(versionChoices(versions, version(2).id).map(({ labelKey }) => labelKey)).toEqual([
      'newest',
      'usedBefore',
      'option',
    ])
  })

  it('marks a newest version that was also used before once', () => {
    expect(versionChoices(versions, version(3).id)[0]!.labelKey).toBe('newestUsedBefore')
  })

  it('leaves the given list unchanged', () => {
    versionChoices(versions, null)

    expect(versions.map(({ version }) => version)).toEqual([1, 3, 2])
  })
})
