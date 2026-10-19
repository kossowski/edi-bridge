import { describe, expect, it } from 'vitest'

import { runListQuerySchema } from './run'
import { runMappingFilterCase } from './run-mapping-filter-case'

const { mappingVersions, flows, runs, filters } = runMappingFilterCase

const mappingOfVersion = (version: string) =>
  mappingVersions.find(({ key }) => key === version)?.mapping

const versionOfRun = (run: (typeof runs)[number]) =>
  run.recordedMappingVersion ?? flows.find(({ key }) => key === run.flow)?.pinnedMappingVersion

const matching = (mappings: readonly string[], versionOf: typeof versionOfRun) =>
  runs
    .filter((run) => {
      const version = versionOf(run)

      return version !== undefined && mappings.includes(mappingOfVersion(version) ?? '')
    })
    .map(({ key }) => key)

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

  it('expects the Runs whose recorded Mapping Version, else the Flow’s, belongs to the Mappings', () => {
    for (const filter of filters) {
      expect(matching(filter.mappings, versionOfRun)).toEqual(filter.runs)
    }
  })

  it('has a Run recorded before its Flow moved on and a Run not yet processed', () => {
    expect(runs.some(({ recordedMappingVersion }) => recordedMappingVersion === null)).toBe(true)

    const pinnedToday = (run: (typeof runs)[number]) =>
      flows.find(({ key }) => key === run.flow)?.pinnedMappingVersion

    expect(
      filters.some((filter) => {
        const byPinned = matching(filter.mappings, pinnedToday)

        return byPinned.join() !== filter.runs.join()
      }),
    ).toBe(true)
  })

  it('moves a Flow to a Mapping Version of another Mapping', () => {
    expect(
      runs.some(
        (run) =>
          run.recordedMappingVersion !== null &&
          mappingOfVersion(run.recordedMappingVersion) !==
            mappingOfVersion(flows.find(({ key }) => key === run.flow)?.pinnedMappingVersion ?? ''),
      ),
    ).toBe(true)
  })
})

describe('runListQuerySchema mappingId', () => {
  it('states that a Run matches by the Mapping Version it recorded', () => {
    expect(runListQuerySchema.shape.mappingId.description).toMatch(/recorded/)
  })
})
