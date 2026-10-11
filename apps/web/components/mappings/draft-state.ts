import { aiReviewOpenStatus, type MappingDraft } from '@edi-bridge/contracts'

export type DraftState =
  | { kind: 'neverPublished' }
  | { kind: 'unpublishedChanges'; version: number }
  | { kind: 'published'; version: number }

export type VersionFacts = Pick<MappingDraft, 'latestVersion' | 'unpublishedChanges'>

export function draftState({ latestVersion, unpublishedChanges }: VersionFacts): DraftState {
  if (latestVersion === null) {
    return { kind: 'neverPublished' }
  }

  return unpublishedChanges
    ? { kind: 'unpublishedChanges', version: latestVersion }
    : { kind: 'published', version: latestVersion }
}

export function nextVersion({ latestVersion }: VersionFacts) {
  return (latestVersion ?? 0) + 1
}

export type PublishProblem = 'noChanges' | 'incomplete' | 'reviewOpen' | 'failed'

export function publishProblem(status: number | null): PublishProblem {
  switch (status) {
    case 409:
      return 'noChanges'
    case 422:
      return 'incomplete'
    case aiReviewOpenStatus:
      return 'reviewOpen'
    default:
      return 'failed'
  }
}
