import { eq, getTableColumns, inArray, type SQL, sql } from 'drizzle-orm'
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
  type SaveMappingDraftBody,
  unknownPathMessage,
} from '@edi-bridge/contracts'
import { documentStructures, lookupTables, mappingNameUnique, mappings } from '@edi-bridge/db'

import { Db, type Database } from './db.js'
import { Unprocessable } from './errors.js'
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

const selectRows = (db: Database, where: SQL | undefined) =>
  db
    .select({ ...getTableColumns(mappings), documentStructureName: documentStructures.name })
    .from(mappings)
    .innerJoin(documentStructures, eq(mappings.documentStructureId, documentStructures.id))
    .where(where)

type Row = Awaited<ReturnType<typeof selectRows>>[number]

const toSummary = (row: Row): MappingSummary => ({
  id: row.id,
  name: row.name,
  direction: directionOf(row),
  messageType: row.messageType,
  documentStructureId: row.documentStructureId,
  documentStructureName: row.documentStructureName,
  // Until Mapping Versions are published (#185).
  latestVersion: null,
  latestVersionPublishedAt: null,
  unpublishedChanges: row.unpublishedChanges,
  draftUpdatedAt: row.draftUpdatedAt.toISOString(),
  // Until Flows (#186) and Runs (#187) exist.
  partners: [],
  documentsLast7Days: 0,
  failedRunsLast7Days: 0,
})

export const listMappings = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const rows = yield* Effect.promise(() => selectRows(db, inWorkspace(mappings, workspace.id)))

  return rows.map(toSummary).toSorted(byName)
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

const noDocumentStructure = () =>
  new Unprocessable({ message: 'The Workspace has no Document Structure to map yet.' })

const insertNumbered = (messageType: MessageType) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [structures, existing] = yield* Effect.promise(() =>
      Promise.all([
        db
          .select({ id: documentStructures.id, name: documentStructures.name })
          .from(documentStructures)
          .where(inWorkspace(documentStructures, workspace.id)),
        db
          .select({
            name: mappings.name,
            messageType: mappings.messageType,
            documentStructureId: mappings.documentStructureId,
          })
          .from(mappings)
          .where(inWorkspace(mappings, workspace.id)),
      ]),
    )

    const structureIdsOfMessageType = new Set(
      existing.flatMap((mapping) =>
        mapping.messageType === messageType ? [mapping.documentStructureId] : [],
      ),
    )

    const structuresByName = structures.toSorted(byName)

    const structure =
      structuresByName.find(({ id }) => structureIdsOfMessageType.has(id)) ?? structuresByName[0]

    if (!structure) {
      return yield* noDocumentStructure()
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
export const createMapping = ({ messageType }: CreateMappingBody) =>
  Effect.gen(function* () {
    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const { id } = yield* insertNumbered(messageType).pipe(
      Effect.retry({ times: 5, while: Predicate.isTagged('Conflict') }),
    )

    const rows = yield* Effect.promise(() =>
      selectRows(db, inWorkspace(mappings, workspace.id, eq(mappings.id, id))),
    )

    return toSummary(yield* exactlyOne(rows))
  })

const toDraft = (row: Row): MappingDraft => {
  const fields = {
    mappingId: row.id,
    name: row.name,
    ...row.draft,
    updatedAt: row.draftUpdatedAt.toISOString(),
    // Until Mapping Versions are published (#185).
    latestVersion: null,
    unpublishedChanges: row.unpublishedChanges,
    // Until AI drafts are stored (#203).
    aiReview: null,
  }

  const document: DocumentStructureSide = {
    kind: 'documentStructure',
    documentStructureId: row.documentStructureId,
    name: row.documentStructureName,
  }

  const edifact: MessageTypeSide = { kind: 'messageType', messageType: row.messageType }

  return { ...fields, ...oriented(row.messageType, { document, edifact }) }
}

const loadRow = (id: string) =>
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

const chosenLookupTableIds = ({ transforms }: MappingGraph) => [
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
      db
        .update(mappings)
        .set({ draft, unpublishedChanges: true, draftUpdatedAt: sql`now()` })
        .where(inWorkspace(mappings, workspace.id, eq(mappings.id, id))),
    )

    return yield* loadMappingDraft(id)
  })
