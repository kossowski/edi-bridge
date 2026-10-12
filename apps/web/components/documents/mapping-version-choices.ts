import type { MappingVersionSummary } from '@edi-bridge/contracts'

export type VersionLabelKey = 'option' | 'newest' | 'usedBefore' | 'newestUsedBefore'

export type VersionChoice = { version: MappingVersionSummary; labelKey: VersionLabelKey }

function labelKeyOf(newest: boolean, usedBefore: boolean): VersionLabelKey {
  if (newest) {
    return usedBefore ? 'newestUsedBefore' : 'newest'
  }

  return usedBefore ? 'usedBefore' : 'option'
}

export function versionChoices(
  versions: ReadonlyArray<MappingVersionSummary>,
  usedBeforeId: string | null,
): VersionChoice[] {
  return versions
    .toSorted((a, b) => b.version - a.version)
    .map((version, index) => ({
      version,
      labelKey: labelKeyOf(index === 0, version.id === usedBeforeId),
    }))
}
