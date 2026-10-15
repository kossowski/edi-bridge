import { and, desc, eq, inArray, max, type SQL, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import type { SelectedFields } from 'drizzle-orm/pg-core'

import {
  type MappingComparison,
  type MappingComparisonQuery,
  type MappingVersion,
  type MappingVersionEntry,
  type MappingVersionSummary,
  type PublishMappingDraftBody,
  type PublishedMappingVersionsQuery,
  mappingDifferences,
  mappingSideLeaves,
  transformIssues,
  unknownPathMessage,
} from '@edi-bridge/contracts'
import { documentStructures, mappings, mappingVersions, users } from '@edi-bridge/db'

import { Db, type Database, type Transaction } from './db.js'
import { Conflict, NotFound, Unprocessable } from './errors.js'
import { loadMappingDraft, loadRow, sidesOf } from './mapping.js'
import {
  exactlyOne,
  foundOrNotFound,
  inWorkspace,
  nameCollator,
  rejectingInvalidId,
} from './rows.js'
import { CurrentMember } from './session.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

const header = {
  id: mappingVersions.id,
  mappingId: mappingVersions.mappingId,
  mappingName: mappings.name,
  version: mappingVersions.version,
  publishedAt: mappingVersions.publishedAt,
}

export const selectVersions = <Fields extends SelectedFields>(db: Database, fields: Fields) =>
  db
    .select({ ...header, ...fields })
    .from(mappingVersions)
    .innerJoin(mappings, eq(mappingVersions.mappingId, mappings.id))

type HeaderRow = Awaited<ReturnType<typeof selectVersions<Record<never, never>>>>[number]

export const toHeader = (row: HeaderRow): MappingVersionSummary => ({
  id: row.id,
  mappingId: row.mappingId,
  mappingName: row.mappingName,
  version: row.version,
  publishedAt: row.publishedAt.toISOString(),
})

const selectEntries = (db: Database, where: SQL | undefined) =>
  selectVersions(db, {
    changeNote: mappingVersions.changeNote,
    publisherId: users.id,
    publisherName: users.name,
  })
    .innerJoin(users, eq(mappingVersions.publishedBy, users.id))
    .where(where)
    .orderBy(desc(mappingVersions.version))

type EntryRow = Awaited<ReturnType<typeof selectEntries>>[number]

const toEntry = (row: EntryRow): MappingVersionEntry => ({
  ...toHeader(row),
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
      selectVersions(db, { graph: mappingVersions.graph }).where(
        and(eq(mappingVersions.id, versionId), eq(mappingVersions.mappingId, mappingId)),
      ),
    )

    const version = yield* foundOrNotFound(row)

    return {
      ...toHeader(version),
      ...version.graph,
      ...sidesOf(mapping),
    } satisfies MappingVersion
  })

export const compareMappingVersions = (
  mappingId: string,
  query: Effect.Effect<MappingComparisonQuery, ValidationError>,
) =>
  Effect.gen(function* () {
    yield* loadRow(mappingId)
    const { from, to, sampleId } = yield* query

    // Until Sample Documents and their outputs arrive with the preview (#185), every Sample Document is unknown.
    if (sampleId !== undefined) {
      return yield* Effect.fail(new NotFound())
    }

    const db = yield* Db

    const rows = yield* Effect.promise(() =>
      selectVersions(db, { graph: mappingVersions.graph }).where(
        and(inArray(mappingVersions.id, [from, to]), eq(mappingVersions.mappingId, mappingId)),
      ),
    )

    const before = yield* foundOrNotFound(rows.find(({ id }) => id === from))
    const after = yield* foundOrNotFound(rows.find(({ id }) => id === to))

    return {
      mappingId,
      from: toHeader(before),
      to: toHeader(after),
      differences: mappingDifferences(before.graph, after.graph),
      outputs: null,
    } satisfies MappingComparison
  })

const restoreInTransaction = async (
  tx: Transaction,
  mappingId: string,
  versionId: string,
): Promise<NotFound | undefined> => {
  // Waits for a publish under way, so the comparison sees the version it adds.
  await tx
    .select({ id: mappings.id })
    .from(mappings)
    .where(eq(mappings.id, mappingId))
    .for('update')

  const [restored] = await tx
    .select({ graph: mappingVersions.graph })
    .from(mappingVersions)
    .where(and(eq(mappingVersions.id, versionId), eq(mappingVersions.mappingId, mappingId)))

  if (!restored) {
    return new NotFound()
  }

  const [latest] = await tx
    .select({ graph: mappingVersions.graph })
    .from(mappingVersions)
    .where(eq(mappingVersions.mappingId, mappingId))
    .orderBy(desc(mappingVersions.version))
    .limit(1)

  await tx
    .update(mappings)
    .set({
      draft: restored.graph,
      unpublishedChanges: !latest || mappingDifferences(latest.graph, restored.graph).length > 0,
      draftUpdatedAt: sql`now()`,
    })
    .where(eq(mappings.id, mappingId))
}

export const restoreMappingVersion = (mappingId: string, versionId: string) =>
  Effect.gen(function* () {
    yield* loadRow(mappingId)
    yield* rejectingInvalidId(versionId)

    const db = yield* Db

    const refusal = yield* Effect.promise(() =>
      db.transaction((tx) => restoreInTransaction(tx, mappingId, versionId)),
    )

    if (refusal) {
      return yield* Effect.fail(refusal)
    }

    return yield* loadMappingDraft(mappingId)
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
      selectVersions(db, {}).where(
        inWorkspace(
          mappings,
          workspace.id,
          messageType === undefined ? undefined : eq(mappings.messageType, messageType),
        ),
      ),
    )

    return rows
      .map(toHeader)
      .toSorted(
        (a, b) => nameCollator.compare(a.mappingName, b.mappingName) || b.version - a.version,
      )
  })
