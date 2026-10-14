import { eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  adjustDocumentStructure,
  applyLabels,
  type CreateDocumentStructureBody,
  type DocumentStructure,
  type DocumentStructureOrigin,
  DocumentStructureProblemError,
  documentStructureLeaves,
  documentStructureSchema,
  type DocumentStructureSummary,
  inferDocumentStructure,
  type InferredDocumentStructure,
  samplePreview,
  summaryFieldLabelCount,
  type UpdateDocumentStructureBody,
} from '@edi-bridge/contracts'
import { documentStructures } from '@edi-bridge/db'

import { Db } from './db.js'
import { DocumentStructureRejected } from './errors.js'
import { byName, exactlyOne, foundOrNotFound, inWorkspace, rejectingInvalidId } from './rows.js'
import { CurrentWorkspace } from './workspace.js'

import type { ValidationError } from './parse.js'

type Row = typeof documentStructures.$inferSelect

const rejectingDocumentStructureProblem = <A>(infer: () => A) =>
  Effect.sync(infer).pipe(
    Effect.catchDefect((defect) =>
      defect instanceof DocumentStructureProblemError
        ? Effect.fail(new DocumentStructureRejected({ problem: defect.problem }))
        : Effect.die(defect),
    ),
  )

export const inferDocumentStructureOrReject = (origin: DocumentStructureOrigin) =>
  rejectingDocumentStructureProblem(() => inferDocumentStructure(origin))

const toRowValues = (structure: DocumentStructure | InferredDocumentStructure) => ({
  format: structure.format,
  jsonRoot: structure.format === 'json' ? structure.root : null,
  csv: structure.format === 'csv' ? structure.csv : null,
  sampleFileName: structure.sample?.fileName ?? null,
  sampleText: structure.sample?.text ?? null,
  sampleTakenAt: structure.sample ? new Date(structure.sample.takenAt) : null,
  children: structure.children,
})

const toDocumentStructure = (row: Row): DocumentStructure =>
  documentStructureSchema.parse({
    id: row.id,
    name: row.name,
    format: row.format,
    ...(row.format === 'json' ? { root: row.jsonRoot } : { csv: row.csv }),
    sample:
      row.sampleFileName === null || row.sampleText === null || row.sampleTakenAt === null
        ? null
        : {
            fileName: row.sampleFileName,
            text: row.sampleText,
            takenAt: row.sampleTakenAt.toISOString(),
          },
    children: row.children,
  })

const toSummary = (structure: DocumentStructure): DocumentStructureSummary => {
  const leaves = documentStructureLeaves(structure)
  const { sample } = structure

  return {
    id: structure.id,
    name: structure.name,
    format: structure.format,
    fieldCount: leaves.length,
    firstFieldLabels: leaves.slice(0, summaryFieldLabelCount).map(({ label }) => label),
    sample: sample && {
      fileName: sample.fileName,
      takenAt: sample.takenAt,
      preview: samplePreview(sample.text),
    },
    // Until Mappings (#185) exist.
    mappings: [],
  }
}

export const listDocumentStructures = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const rows = yield* Effect.promise(() =>
    db.select().from(documentStructures).where(inWorkspace(documentStructures, workspace.id)),
  )

  return rows.map((row) => toSummary(toDocumentStructure(row))).toSorted(byName)
})

export const loadDocumentStructure = (id: string) =>
  Effect.gen(function* () {
    yield* rejectingInvalidId(id)

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [row] = yield* Effect.promise(() =>
      db
        .select()
        .from(documentStructures)
        .where(inWorkspace(documentStructures, workspace.id, eq(documentStructures.id, id))),
    )

    return toDocumentStructure(yield* foundOrNotFound(row))
  })

export const createDocumentStructure = ({
  name,
  origin,
  labels = [],
}: CreateDocumentStructureBody) =>
  Effect.gen(function* () {
    const inferred = yield* rejectingDocumentStructureProblem(() =>
      applyLabels(inferDocumentStructure(origin), labels),
    )

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const rows = yield* Effect.promise(() =>
      db
        .insert(documentStructures)
        .values({ workspaceId: workspace.id, name, ...toRowValues(inferred) })
        .returning(),
    )

    return toDocumentStructure(yield* exactlyOne(rows))
  })

export const updateDocumentStructure = (
  id: string,
  input: Effect.Effect<UpdateDocumentStructureBody, ValidationError>,
) =>
  Effect.gen(function* () {
    const existing = yield* loadDocumentStructure(id)
    const body = yield* input

    const adjusted = yield* rejectingDocumentStructureProblem(() =>
      documentStructureSchema.parse(adjustDocumentStructure(existing, body)),
    )

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const [row] = yield* Effect.promise(() =>
      db
        .update(documentStructures)
        .set({ name: adjusted.name, ...toRowValues(adjusted), updatedAt: sql`now()` })
        .where(inWorkspace(documentStructures, workspace.id, eq(documentStructures.id, id)))
        .returning(),
    )

    return toDocumentStructure(yield* foundOrNotFound(row))
  })
