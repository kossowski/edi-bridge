import { findNode, sameCsvSettings, visitedNode } from './document-structure-inference'
import { containerOf } from './mapping-paths'

import type {
  DocumentStructure,
  DocumentStructureNode,
  DocumentStructureProblem,
  UpdateDocumentStructureBody,
} from './document-structure'
import type { GraphParts } from './mapping'
import type { MappingVersionSummary } from './mapping-version'

export type PublishedMappingUse = MappingVersionSummary & GraphParts

export type DocumentStructureUses = {
  drafts: ReadonlyArray<GraphParts>
  versions: ReadonlyArray<PublishedMappingUse>
}

function linkedPaths({ links, transformLinks }: GraphParts) {
  return [
    ...links.flatMap(({ sourcePath, targetPath }) => [sourcePath, targetPath]),
    ...transformLinks.flatMap(({ from, to }) => [
      ...(from.kind === 'source' ? [from.path] : []),
      ...(to.kind === 'target' ? [to.path] : []),
    ]),
  ]
}

const nameCollator = new Intl.Collator('de')

function summaries(versions: ReadonlyArray<PublishedMappingUse>): MappingVersionSummary[] {
  return versions
    .map(({ id, mappingId, mappingName, version, publishedAt }) => ({
      id,
      mappingId,
      mappingName,
      version,
      publishedAt,
    }))
    .sort((a, b) => nameCollator.compare(a.mappingName, b.mappingName) || b.version - a.version)
}

// Plain names only label a node, so a rename changes no shape a Mapping relies on.
const linkedNodeKeys = ['path', 'name', 'kind', 'required', 'type', 'children', 'items']

function fingerprintAt(nodes: ReadonlyArray<DocumentStructureNode>, path: string) {
  const visited = visitedNode(nodes, path)

  return (
    visited &&
    JSON.stringify(
      [
        ...visited.ancestors.map(({ path: ancestorPath, kind, required }) => ({
          path: ancestorPath,
          kind,
          required,
        })),
        visited.node,
      ],
      linkedNodeKeys,
    )
  )
}

function related(a: string, b: string) {
  return a === b || containerOf([a], b) || containerOf([b], a)
}

function adjustmentAt(linkedPath: string, body: UpdateDocumentStructureBody) {
  return body.adjustments.find(({ path }) => related(path, linkedPath))?.path ?? linkedPath
}

function usedByMappingVersion(
  versions: ReadonlyArray<PublishedMappingUse>,
  message: string,
  path: string | null,
): DocumentStructureProblem {
  const sorted = summaries(versions)
  const versionNames = sorted.map(({ mappingName, version }) => `${mappingName} v${version}`)

  return {
    code: 'usedByMappingVersion',
    message: `${message}: ${versionNames.join(', ')}`,
    path,
    line: null,
    mappingVersions: sorted,
  }
}

export function csvSettingsChangeProblem(
  existing: DocumentStructure,
  body: UpdateDocumentStructureBody,
  versions: ReadonlyArray<PublishedMappingUse>,
): DocumentStructureProblem | null {
  if (
    existing.format !== 'csv' ||
    body.csv === undefined ||
    sameCsvSettings(existing.csv, body.csv) ||
    versions.length === 0
  ) {
    return null
  }

  return usedByMappingVersion(
    versions,
    'Published Mapping Versions read this Document Structure with its CSV settings',
    null,
  )
}

// Published Mapping Versions never change, so nothing they link may change shape. A Draft only
// needs its links to keep pointing at a node.
export function linkChangeProblem(
  existing: DocumentStructure,
  updated: DocumentStructure,
  body: UpdateDocumentStructureBody,
  { drafts, versions }: DocumentStructureUses,
): DocumentStructureProblem | null {
  const known = (path: string) => findNode(existing.children, path) !== undefined

  const changed = (path: string) =>
    known(path) && fingerprintAt(existing.children, path) !== fingerprintAt(updated.children, path)

  const published = versions.filter((version) => linkedPaths(version).some(changed))

  const [firstPublished] = published

  if (firstPublished) {
    const path = adjustmentAt(linkedPaths(firstPublished).find(changed)!, body)

    return usedByMappingVersion(
      published,
      `Published Mapping Versions use ${path}, and a published Mapping Version never changes`,
      path,
    )
  }

  const broken = drafts
    .flatMap(linkedPaths)
    .find((path) => known(path) && findNode(updated.children, path) === undefined)

  if (broken === undefined) {
    return null
  }

  const path = adjustmentAt(broken, body)

  return {
    code: 'linkedByMapping',
    message: `A Mapping Draft links ${broken}, which the change at ${path} would remove`,
    path,
    line: null,
    mappingVersions: null,
  }
}
