import { describe, expect, it } from 'vitest'

import { runMappingFilterCase } from './run-mapping-filter-case'

const { mappingVersions, flows, runs, filters } = runMappingFilterCase

type Run = (typeof runs)[number]

const mappingOfVersion = (version: string) =>
  mappingVersions.find(({ key }) => key === version)?.mapping

const pinnedVersionOf = (run: Run) =>
  flows.find(({ key }) => key === run.flow)?.pinnedMappingVersion

const versionOfRun = (run: Run) => run.recordedMappingVersion ?? pinnedVersionOf(run)

const runKeysMatching = (mappings: readonly string[], versionOf: typeof versionOfRun) =>
  new Set(
    runs
      .filter((run) => {
        const version = versionOf(run)

        return version !== undefined && mappings.includes(mappingOfVersion(version) ?? '')
      })
      .map(({ key }) => key),
  )

describe('runMappingFilterCase', () => {
  it('refers only to Mappings, Mapping Versions and Flows it declares', () => {
    const versions = mappingVersions.map(({ key }) => key)
    const flowKeys = flows.map(({ key }) => key)

    expect(
      mappingVersions.every(({ mapping }) => runMappingFilterCase.mappings.includes(mapping)),
    ).toBe(true)
    expect(flows.every(({ pinnedMappingVersion }) => versions.includes(pinnedMappingVersion))).toBe(
      true,
    )
    expect(
      runs.every(
        ({ flow, recordedMappingVersion }) =>
          flowKeys.includes(flow) &&
          (recordedMappingVersion === null || versions.includes(recordedMappingVersion)),
      ),
    ).toBe(true)
    expect(
      filters.every(
        (filter) =>
          filter.mappings.every((mapping) => runMappingFilterCase.mappings.includes(mapping)) &&
          filter.runs.every((run) => runs.some(({ key }) => key === run)),
      ),
    ).toBe(true)
  })

  it("expects the Runs whose recorded Mapping Version, else the Flow's, belongs to the Mappings", () => {
    for (const filter of filters) {
      expect(runKeysMatching(filter.mappings, versionOfRun)).toEqual(new Set(filter.runs))
    }
  })

  it('has a Run recorded before its Flow moved on and a Run not yet processed', () => {
    expect(runs.some(({ recordedMappingVersion }) => recordedMappingVersion === null)).toBe(true)
    expect(
      filters.some((filter) => {
        const byPinned = runKeysMatching(filter.mappings, pinnedVersionOf)

        return byPinned.size !== filter.runs.length || filter.runs.some((run) => !byPinned.has(run))
      }),
    ).toBe(true)
  })

  it('has a Run that recorded the Mapping Version its Flow pins now', () => {
    expect(runs.some((run) => run.recordedMappingVersion === pinnedVersionOf(run))).toBe(true)
  })

  it('moves a Flow to a Mapping Version of another Mapping', () => {
    expect(
      runs.some(
        (run) =>
          run.recordedMappingVersion !== null &&
          mappingOfVersion(run.recordedMappingVersion) !==
            mappingOfVersion(pinnedVersionOf(run) ?? ''),
      ),
    ).toBe(true)
  })
})
