import { and, desc, eq, inArray, max, type SQL, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import type { SelectedFields } from 'drizzle-orm/pg-core'

import {
  byNameAndNewest,
  type MappingComparison,
  type MappingComparisonQuery,
  type MappingVersion,
  type MappingVersionEntry,
  type MappingVersionSummary,
  type PublishedMappingUse,
  type PublishMappingDraftBody,
  type PublishedMappingVersionsQuery,
  mappingDifferences,
  mappingSideLeaves,
  transformIssues,
  unknownPathMessage,
} from '@edi-bridge/contracts'
import { documentStructures, flows, mappings, mappingVersions, users } from '@edi-bridge/db'

import { Db, type Database, type Transaction } from './db.js'
import { AiReviewOpen, Conflict, NotFound, Unprocessable } from './errors.js'
import { selectPinnedFlows } from './flow-use.js'
import { compareOutputs } from './mapping-preview.js'
import { loadMappingDraft, loadRow, sidesOf } from './mapping.js'
import { exactlyOne, foundOrNotFound, inWorkspace, rejectingInvalidId } from './rows.js'
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

export const selectVersionsOfDocumentStructure = async (
  db: Database,
  documentStructureId: string,
): Promise<PublishedMappingUse[]> => {
  const rows = await selectVersions(db, { graph: mappingVersions.graph }).where(
    eq(mappings.documentStructureId, documentStructureId),
  )

  return rows.map((row) => ({ ...toHeader(row), ...row.graph }))
}

const selectEntries = async (
  db: Database,
  where: SQL | undefined,
): Promise<MappingVersionEntry[]> => {
  const rows = await selectVersions(db, {
    changeNote: mappingVersions.changeNote,
    publisherId: users.id,
    publisherName: users.name,
  })
    .innerJoin(users, eq(mappingVersions.publishedBy, users.id))
    .where(where)
    .orderBy(desc(mappingVersions.version))

  const flowsOf = await selectPinnedFlows(
    db,
    rows.map(({ id }) => id),
  )

  return rows.map((row) => ({
    ...toHeader(row),
    changeNote: row.changeNote,
    publishedBy: { id: row.publisherId, name: row.publisherName },
    flows: flowsOf(row.id),
  }))
}

export const listMappingVersions = (mappingId: string) =>
  Effect.gen(function* () {
    yield* loadRow(mappingId)

    const db = yield* Db

    return yield* Effect.promise(() => selectEntries(db, eq(mappingVersions.mappingId, mappingId)))
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
      outputs:
        sampleId === undefined
          ? null
          : yield* compareOutputs(mappingId, sampleId, before.graph, after.graph),
    } satisfies MappingComparison
  })

const restoreInTransaction = async (
  tx: Transaction,
  mappingId: string,
  versionId: string,
): Promise<AiReviewOpen | NotFound | undefined> => {
  // Waits for a publish under way, so the comparison sees the version it adds.
  const [locked] = await tx
    .select({ aiReview: mappings.aiReview })
    .from(mappings)
    .where(eq(mappings.id, mappingId))
    .for('update')

  if (locked?.aiReview) {
    return new AiReviewOpen()
  }

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

const unknownFlows = () =>
  new Unprocessable({ message: 'Only Flows that use this Mapping move to the new version.' })

type Refusal = AiReviewOpen | Conflict | Unprocessable

const publishInTransaction = async (
  tx: Transaction,
  mappingId: string,
  moveFlowIds: readonly string[],
  publication: { changeNote: string | null; publishedBy: string },
): Promise<Refusal | { id: string }[]> => {
  const [locked] = await tx
    .select({
      draft: mappings.draft,
      aiReview: mappings.aiReview,
      unpublishedChanges: mappings.unpublishedChanges,
      messageType: mappings.messageType,
      children: documentStructures.children,
    })
    .from(mappings)
    .innerJoin(documentStructures, eq(mappings.documentStructureId, documentStructures.id))
    .where(eq(mappings.id, mappingId))
    .for('update')

  if (locked?.aiReview) {
    return new AiReviewOpen()
  }

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

  const moving =
    moveFlowIds.length === 0
      ? []
      : await tx
          .select({ id: flows.id })
          .from(flows)
          .innerJoin(mappingVersions, eq(flows.mappingVersionId, mappingVersions.id))
          .where(and(inArray(flows.id, moveFlowIds), eq(mappingVersions.mappingId, mappingId)))
          .for('update', { of: flows })

  if (moving.length !== moveFlowIds.length) {
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

  const [published] = inserted

  if (published && moveFlowIds.length > 0) {
    await tx
      .update(flows)
      .set({ mappingVersionId: published.id })
      .where(inArray(flows.id, moveFlowIds))
  }

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

    const entries = yield* Effect.promise(() => selectEntries(db, eq(mappingVersions.id, id)))

    return yield* exactlyOne(entries)
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

    return rows.map(toHeader).toSorted(byNameAndNewest)
  })
