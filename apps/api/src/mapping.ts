import { desc, eq, getTableColumns, inArray, type SQL, sql } from 'drizzle-orm'
import { Effect, Predicate } from 'effect'

import {
  type CreateMappingBody,
  directionOf,
  type DocumentStructureSide,
  type MappingDraft,
  type MappingGraph,
  mappingSideLeaves,
  type MappingSummary,
  type MessageType,
  type MessageTypeSide,
  oriented,
  remainingAiReview,
  type SaveMappingDraftBody,
  type TradingPartnerSummary,
  unknownPathMessage,
} from '@edi-bridge/contracts'
import {
  documentStructures,
  lookupTables,
  mappingNameUnique,
  mappings,
  mappingVersions,
} from '@edi-bridge/db'

import { Db, type Database } from './db.js'
import { Unprocessable } from './errors.js'
import { selectTradingPartnersByMapping } from './flow-use.js'
import {
  byName,
  exactlyOne,
  foundOrNotFound,
  inWorkspace,
  rejectingDuplicate,
  rejectingInvalidId,
} from './rows.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

const selectRows = (db: Database, where: SQL | undefined) => {
  const latest = db
    .selectDistinctOn([mappingVersions.mappingId], {
      mappingId: mappingVersions.mappingId,
      version: mappingVersions.version,
      publishedAt: mappingVersions.publishedAt,
    })
    .from(mappingVersions)
    .orderBy(mappingVersions.mappingId, desc(mappingVersions.version))
    .as('latest')

  return db
    .select({
      ...getTableColumns(mappings),
      documentStructureName: documentStructures.name,
      latestVersion: latest.version,
      latestVersionPublishedAt: latest.publishedAt,
    })
    .from(mappings)
    .innerJoin(documentStructures, eq(mappings.documentStructureId, documentStructures.id))
    .leftJoin(latest, eq(latest.mappingId, mappings.id))
    .where(where)
}

type Row = Awaited<ReturnType<typeof selectRows>>[number]

const toSummary = (row: Row, partners: TradingPartnerSummary[]): MappingSummary => ({
  id: row.id,
  name: row.name,
  direction: directionOf(row),
  messageType: row.messageType,
  documentStructureId: row.documentStructureId,
  documentStructureName: row.documentStructureName,
  latestVersion: row.latestVersion,
  latestVersionPublishedAt: row.latestVersionPublishedAt?.toISOString() ?? null,
  unpublishedChanges: row.unpublishedChanges,
  draftUpdatedAt: row.draftUpdatedAt.toISOString(),
  partners,
  // Until Runs (#187) exist.
  documentsLast7Days: 0,
  failedRunsLast7Days: 0,
})

export const listMappings = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const [rows, partnersOf] = yield* Effect.promise(() =>
    Promise.all([
      selectRows(db, inWorkspace(mappings, workspace.id)),
      selectTradingPartnersByMapping(db, workspace.id),
    ]),
  )

  return rows.map((row) => toSummary(row, partnersOf(row.id))).toSorted(byName)
})

const nameOf = (messageType: MessageType, documentStructureName: string) => {
  const { source, target } = oriented(messageType, {
    document: documentStructureName,
    edifact: messageType,
  })

  return `${source} to ${target}`
}

const uniqueName = (name: string, taken: ReadonlySet<string>) => {
  let count = 1

  while (taken.has(count === 1 ? name : `${name} ${count}`)) {
    count += 1
  }

  return count === 1 ? name : `${name} ${count}`
}

const unknownDocumentStructure = () =>
  new Unprocessable({ message: 'The Document Structure does not exist.' })

const insertNumbered = ({ messageType, documentStructureId }: CreateMappingBody) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    // Until Document Structures carry a Message Type, any one of the Workspace fits.
    const [structures, existing] = yield* Effect.promise(() =>
      Promise.all([
        db
          .select({ id: documentStructures.id, name: documentStructures.name })
          .from(documentStructures)
          .where(
            inWorkspace(
              documentStructures,
              workspace.id,
              eq(documentStructures.id, documentStructureId),
            ),
          ),
        db
          .select({ name: mappings.name })
          .from(mappings)
          .where(inWorkspace(mappings, workspace.id)),
      ]),
    )

    const [structure] = structures

    if (!structure) {
      return yield* unknownDocumentStructure()
    }

    const name = uniqueName(
      nameOf(messageType, structure.name),
      new Set(existing.map((mapping) => mapping.name)),
    )

    const inserted = yield* rejectingDuplicate(
      () =>
        db
          .insert(mappings)
          .values({
            workspaceId: workspace.id,
            documentStructureId: structure.id,
            messageType,
            name,
            draft: { links: [], transforms: [], transformLinks: [] },
          })
          .returning({ id: mappings.id }),
      [mappingNameUnique],
      `Another Mapping took the name ${name} meanwhile.`,
    )

    return yield* exactlyOne(inserted)
  })

// A Mapping created at the same time may take the numbered name first; the next attempt sees it.
export const createMapping = (body: CreateMappingBody) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const { id } = yield* insertNumbered(body).pipe(
      Effect.retry({ times: 5, while: Predicate.isTagged('Conflict') }),
    )

    const rows = yield* Effect.promise(() =>
      selectRows(db, inWorkspace(mappings, workspace.id, eq(mappings.id, id))),
    )

    return toSummary(yield* exactlyOne(rows), [])
  })

export const sidesOf = ({
  documentStructureId,
  documentStructureName,
  messageType,
}: Pick<Row, 'documentStructureId' | 'documentStructureName' | 'messageType'>) => {
  const document: DocumentStructureSide = {
    kind: 'documentStructure',
    documentStructureId,
    name: documentStructureName,
  }

  const edifact: MessageTypeSide = { kind: 'messageType', messageType }

  return oriented(messageType, { document, edifact })
}

const toDraft = (row: Row): MappingDraft => {
  const fields = {
    mappingId: row.id,
    name: row.name,
    ...row.draft,
    updatedAt: row.draftUpdatedAt.toISOString(),
    latestVersion: row.latestVersion,
    unpublishedChanges: row.unpublishedChanges,
    aiReview: row.aiReview,
  }

  return { ...fields, ...sidesOf(row) }
}

export const loadRow = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [row] = yield* Effect.promise(() =>
      selectRows(db, inWorkspace(mappings, workspace.id, eq(mappings.id, id))),
    )

    return yield* foundOrNotFound(row)
  })

export const loadMappingDraft = (id: string) => Effect.map(loadRow(id), toDraft)

export const chosenLookupTableIds = ({ transforms }: MappingGraph) => [
  ...new Set(
    transforms.flatMap((transform) =>
      transform.kind === 'lookupTable' && transform.config.lookupTableId !== null
        ? [transform.config.lookupTableId]
        : [],
    ),
  ),
]

const rejectingUnknownLookupTables = (graph: MappingGraph) =>
  Effect.gen(function* () {
    const chosen = chosenLookupTableIds(graph)

    if (chosen.length === 0) {
      return
    }

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const found = yield* Effect.promise(() =>
      db
        .select({ id: lookupTables.id })
        .from(lookupTables)
        .where(inWorkspace(lookupTables, workspace.id, inArray(lookupTables.id, chosen))),
    )

    const known = new Set(found.map(({ id }) => id))
    const unknown = chosen.find((id) => !known.has(id))

    if (unknown !== undefined) {
      return yield* new Unprocessable({ message: `The Workspace has no Lookup Table ${unknown}.` })
    }
  })

export const saveMappingDraft = (
  id: string,
  input: Effect.Effect<SaveMappingDraftBody, ValidationError>,
) =>
  Effect.gen(function* () {
    const existing = yield* loadRow(id)
    const graph = yield* input

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const documentStructure = yield* exactlyOne(
      yield* Effect.promise(() =>
        db
          .select({ children: documentStructures.children })
          .from(documentStructures)
          .where(eq(documentStructures.id, existing.documentStructureId)),
      ),
    )

    const unknownPath = unknownPathMessage(
      graph,
      mappingSideLeaves(existing.messageType, documentStructure),
    )

    if (unknownPath !== null) {
      return yield* new Unprocessable({ message: unknownPath })
    }

    yield* rejectingUnknownLookupTables(graph)

    const draft: MappingGraph = {
      links: graph.links,
      transforms: graph.transforms,
      transformLinks: graph.transformLinks,
    }

    yield* Effect.promise(() =>
      db.transaction(async (tx) => {
        // Locks the row, so the marks follow the Draft this save replaces.
        const [before] = await tx
          .select({ draft: mappings.draft, aiReview: mappings.aiReview })
          .from(mappings)
          .where(inWorkspace(mappings, workspace.id, eq(mappings.id, id)))
          .for('update')

        const aiReview =
          before?.aiReview == null ? null : remainingAiReview(before.aiReview, before.draft, draft)

        await tx
          .update(mappings)
          .set({ draft, aiReview, unpublishedChanges: true, draftUpdatedAt: sql`now()` })
          .where(inWorkspace(mappings, workspace.id, eq(mappings.id, id)))
      }),
    )

    return yield* loadMappingDraft(id)
  })
