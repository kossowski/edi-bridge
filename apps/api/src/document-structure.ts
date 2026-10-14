import { and, eq, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'

import {
  applyLabels,
  type CreateDocumentStructureBody,
  type DocumentStructure,
  type DocumentStructureOrigin,
  DocumentStructureProblemError,
  documentStructureLeaves,
  documentStructureSchema,
  type DocumentStructureSummary,
  inferDocumentStructure,
  samplePreview,
  summaryFieldLabelCount,
} from '@edi-bridge/contracts'
import { documentStructures } from '@edi-bridge/db'

import { Db } from './db.js'
import { DocumentStructureRejected, NotFound } from './errors.js'
import { byName, exactlyOne, rejectingInvalidId } from './rows.js'
import { CurrentWorkspace } from './workspace.js'

type Row = typeof documentStructures.$inferSelect

const attempt = <A>(run: () => A) =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(run())
    } catch (error) {
      return error instanceof DocumentStructureProblemError
        ? Effect.fail(new DocumentStructureRejected({ problem: error.problem }))
        : Effect.die(error)
    }
  })

export const inferDocumentStructureFrom = (origin: DocumentStructureOrigin) =>
  attempt(() => inferDocumentStructure(origin))

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

const inWorkspace = (workspaceId: string, ...conditions: (SQL | undefined)[]) =>
  and(eq(documentStructures.workspaceId, workspaceId), ...conditions)

export const listDocumentStructures = Effect.gen(function* () {
  const db = yield* Db
  const workspace = yield* CurrentWorkspace

  const rows = yield* Effect.promise(() =>
    db.select().from(documentStructures).where(inWorkspace(workspace.id)),
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
        .where(inWorkspace(workspace.id, eq(documentStructures.id, id))),
    )

    return row ? toDocumentStructure(row) : yield* new NotFound()
  })

export const createDocumentStructure = ({
  name,
  origin,
  labels = [],
}: CreateDocumentStructureBody) =>
  Effect.gen(function* () {
    const inferred = yield* attempt(() => applyLabels(inferDocumentStructure(origin), labels))

    const db = yield* Db
    const workspace = yield* CurrentWorkspace

    const rows = yield* Effect.promise(() =>
      db
        .insert(documentStructures)
        .values({
          workspaceId: workspace.id,
          name,
          format: inferred.format,
          jsonRoot: inferred.format === 'json' ? inferred.root : null,
          csv: inferred.format === 'csv' ? inferred.csv : null,
          sampleFileName: inferred.sample?.fileName ?? null,
          sampleText: inferred.sample?.text ?? null,
          sampleTakenAt: inferred.sample ? new Date(inferred.sample.takenAt) : null,
          children: inferred.children,
        })
        .returning(),
    )

    return toDocumentStructure(yield* exactlyOne(rows))
  })
