import { and, desc, eq, max, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  type MappingVersion,
  type MappingVersionEntry,
  type MappingVersionSummary,
  type PublishMappingDraftBody,
  type PublishedMappingVersionsQuery,
  mappingSideLeaves,
  transformIssues,
  unknownPathMessage,
} from '@edi-bridge/contracts'
import { documentStructures, mappings, mappingVersions, users } from '@edi-bridge/db'

import { Db, type Database, type Transaction } from './db.js'
import { Conflict, Unprocessable } from './errors.js'
import { loadRow, sidesOf } from './mapping.js'
import { byName, exactlyOne, foundOrNotFound, inWorkspace, rejectingInvalidId } from './rows.js'
import { CurrentMember } from './session.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

const selectEntries = (db: Database, where: SQL | undefined) =>
  db
    .select({
      id: mappingVersions.id,
      mappingId: mappingVersions.mappingId,
      mappingName: mappings.name,
      version: mappingVersions.version,
      publishedAt: mappingVersions.publishedAt,
      changeNote: mappingVersions.changeNote,
      publisherId: users.id,
      publisherName: users.name,
    })
    .from(mappingVersions)
    .innerJoin(mappings, eq(mappingVersions.mappingId, mappings.id))
    .innerJoin(users, eq(mappingVersions.publishedBy, users.id))
    .where(where)
    .orderBy(desc(mappingVersions.version))

type EntryRow = Awaited<ReturnType<typeof selectEntries>>[number]

const toEntry = (row: EntryRow): MappingVersionEntry => ({
  id: row.id,
  mappingId: row.mappingId,
  mappingName: row.mappingName,
  version: row.version,
  publishedAt: row.publishedAt.toISOString(),
  changeNote: row.changeNote,
  publishedBy: { id: row.publisherId, name: row.publisherName },
  // Until Flows (#186) exist.
  flows: [],
})

export const listMappingVersions = (mappingId: string) =>
  Effect.gen(function* () {
    yield* loadRow(mappingId)

    const db = yield* Db

    const rows = yield* Effect.promise(() =>
      selectEntries(db, eq(mappingVersions.mappingId, mappingId)),
    )

    return rows.map(toEntry)
  })

export const loadMappingVersion = (mappingId: string, versionId: string) =>
  Effect.gen(function* () {
    const mapping = yield* loadRow(mappingId)
    yield* rejectingInvalidId(versionId)

    const db = yield* Db

    const [row] = yield* Effect.promise(() =>
      db
        .select()
        .from(mappingVersions)
        .where(and(eq(mappingVersions.id, versionId), eq(mappingVersions.mappingId, mappingId))),
    )

    const version = yield* foundOrNotFound(row)

    return {
      id: version.id,
      mappingId,
      mappingName: mapping.name,
      version: version.version,
      publishedAt: version.publishedAt.toISOString(),
      ...version.graph,
      ...sidesOf(mapping),
    } satisfies MappingVersion
  })

const noChanges = () =>
  new Conflict({ message: 'The Draft has no changes since its latest version.' })

const unconfiguredTransform = () =>
  new Unprocessable({ message: 'Every transform is configured and connected before publishing.' })

// Until Flows (#186) exist, no Flow uses a Mapping.
const unknownFlows = () =>
  new Unprocessable({ message: 'Only Flows that use this Mapping move to the new version.' })

type Refusal = Conflict | Unprocessable

const publishInTransaction = async (
  tx: Transaction,
  mappingId: string,
  moveFlowIds: readonly string[],
  publication: { changeNote: string | null; publishedBy: string },
): Promise<Refusal | { id: string }[]> => {
  const [locked] = await tx
    .select({
      draft: mappings.draft,
      unpublishedChanges: mappings.unpublishedChanges,
      messageType: mappings.messageType,
      children: documentStructures.children,
    })
    .from(mappings)
    .innerJoin(documentStructures, eq(mappings.documentStructureId, documentStructures.id))
    .where(eq(mappings.id, mappingId))
    .for('update')

  if (!locked?.unpublishedChanges) {
    return noChanges()
  }

  const unknownPath = unknownPathMessage(
    locked.draft,
    mappingSideLeaves(locked.messageType, locked),
  )

  if (unknownPath !== null) {
    return new Unprocessable({ message: unknownPath })
  }

  if (Object.values(transformIssues(locked.draft)).some((issues) => issues.length > 0)) {
    return unconfiguredTransform()
  }

  if (moveFlowIds.length > 0) {
    return unknownFlows()
  }

  const [latest] = await tx
    .select({ version: max(mappingVersions.version) })
    .from(mappingVersions)
    .where(eq(mappingVersions.mappingId, mappingId))

  const inserted = await tx
    .insert(mappingVersions)
    .values({
      mappingId,
      version: (latest?.version ?? 0) + 1,
      graph: locked.draft,
      ...publication,
    })
    .returning({ id: mappingVersions.id })

  await tx.update(mappings).set({ unpublishedChanges: false }).where(eq(mappings.id, mappingId))

  return inserted
}

export const publishMappingDraft = (
  mappingId: string,
  input: Effect.Effect<PublishMappingDraftBody, ValidationError>,
) =>
  Effect.gen(function* () {
    yield* loadRow(mappingId)
    const { changeNote, moveFlowIds } = yield* input

    const db = yield* Db
    const { user } = yield* CurrentMember

    const outcome = yield* Effect.promise(() =>
      db.transaction((tx) =>
        publishInTransaction(tx, mappingId, moveFlowIds, {
          changeNote: changeNote === '' ? null : changeNote,
          publishedBy: user.id,
        }),
      ),
    )

    if ('_tag' in outcome) {
      return yield* Effect.fail(outcome)
    }

    const { id } = yield* exactlyOne(outcome)

    const rows = yield* Effect.promise(() => selectEntries(db, eq(mappingVersions.id, id)))

    return toEntry(yield* exactlyOne(rows))
  })

export const listPublishedMappingVersions = ({ messageType }: PublishedMappingVersionsQuery) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const rows = yield* Effect.promise(() =>
      db
        .select({
          id: mappingVersions.id,
          mappingId: mappingVersions.mappingId,
          mappingName: mappings.name,
          version: mappingVersions.version,
          publishedAt: mappingVersions.publishedAt,
        })
        .from(mappingVersions)
        .innerJoin(mappings, eq(mappingVersions.mappingId, mappings.id))
        .where(
          inWorkspace(
            mappings,
            workspace.id,
            messageType === undefined ? undefined : eq(mappings.messageType, messageType),
          ),
        ),
    )

    return rows
      .map((row): MappingVersionSummary => ({ ...row, publishedAt: row.publishedAt.toISOString() }))
      .toSorted(
        (a, b) => byName({ name: a.mappingName }, { name: b.mappingName }) || b.version - a.version,
      )
  })
