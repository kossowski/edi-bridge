import { and, type AnyColumn, eq, type SQL, sql } from 'drizzle-orm'

import { directionOf, type DocumentStructureUses, type LookupTableUse } from '@edi-bridge/contracts'
import { mappings, mappingVersions } from '@edi-bridge/db'

import { selectVersions, toHeader } from './mapping-version.js'
import { byName, inWorkspace } from './rows.js'

import type { Database, Transaction } from './db.js'

const lookupTableIdsPath =
  '$.transforms[*] ? (@.kind == "lookupTable").config.lookupTableId ? (@ != null)'

const lookupTableIdsOf = (graph: AnyColumn) =>
  sql<string>`jsonb_path_query(${graph}, ${lookupTableIdsPath}) #>> '{}'`

const readsLookupTable = (graph: AnyColumn, lookupTableId: string) =>
  sql`jsonb_path_exists(${graph}, '$.transforms[*] ? (@.kind == "lookupTable" && @.config.lookupTableId == $id)', jsonb_build_object('id', ${lookupTableId}::text))`

export const selectDocumentStructureUses = async (
  db: Database,
  documentStructureId: string,
): Promise<DocumentStructureUses> => {
  const [drafts, versions] = await Promise.all([
    db
      .select({ draft: mappings.draft })
      .from(mappings)
      .where(eq(mappings.documentStructureId, documentStructureId)),
    selectVersions(db, { graph: mappingVersions.graph }).where(
      eq(mappings.documentStructureId, documentStructureId),
    ),
  ])

  return {
    drafts: drafts.map(({ draft }) => draft),
    versions: versions.map((row) => ({ ...toHeader(row), ...row.graph })),
  }
}

export const selectMappingsByDocumentStructure = async (db: Database, workspaceId: string) => {
  const rows = await db
    .select({
      id: mappings.id,
      name: mappings.name,
      documentStructureId: mappings.documentStructureId,
    })
    .from(mappings)
    .where(inWorkspace(mappings, workspaceId))

  return Map.groupBy(rows.toSorted(byName), ({ documentStructureId }) => documentStructureId)
}

const useFields = {
  mappingId: mappings.id,
  name: mappings.name,
  messageType: mappings.messageType,
}

export const selectLookupTableUses = async (db: Database | Transaction, workspaceId: string) => {
  const [inDrafts, inVersions] = await Promise.all([
    db
      .selectDistinct({ ...useFields, lookupTableId: lookupTableIdsOf(mappings.draft) })
      .from(mappings)
      .where(inWorkspace(mappings, workspaceId)),
    db
      .selectDistinct({ ...useFields, lookupTableId: lookupTableIdsOf(mappingVersions.graph) })
      .from(mappingVersions)
      .innerJoin(mappings, eq(mappingVersions.mappingId, mappings.id))
      .where(inWorkspace(mappings, workspaceId)),
  ])

  const byLookupTable = new Map<string, Map<string, LookupTableUse>>()

  for (const { lookupTableId, mappingId, name, messageType } of [...inDrafts, ...inVersions]) {
    const uses = byLookupTable.get(lookupTableId) ?? new Map<string, LookupTableUse>()

    uses.set(mappingId, {
      mappingId,
      name,
      messageType,
      direction: directionOf({ messageType }),
      // Until Flows (#186) exist.
      tradingPartners: [],
    })
    byLookupTable.set(lookupTableId, uses)
  }

  return (lookupTableId: string) =>
    [...(byLookupTable.get(lookupTableId)?.values() ?? [])].toSorted(byName)
}

export const lookupTableUnused = (lookupTableId: string): SQL | undefined =>
  and(
    sql`not exists (select 1 from ${mappings} where ${readsLookupTable(mappings.draft, lookupTableId)})`,
    sql`not exists (select 1 from ${mappingVersions} where ${readsLookupTable(mappingVersions.graph, lookupTableId)})`,
  )
