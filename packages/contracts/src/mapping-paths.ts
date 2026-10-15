import { documentStructureLeaves } from './document-structure-inference'
import { messageTypeStructures } from './eancom/structures'
import { directionOf, type MessageType, type MessageTypeStructure } from './message-type'

import type { DocumentStructure } from './document-structure'
import type { EdifactComposite, EdifactElement, EdifactStructureNode } from './edifact'
import type { GraphParts } from './mapping'

export function edifactLeaves(structure: Pick<MessageTypeStructure, 'children'>): EdifactElement[] {
  const visit = (
    node: EdifactStructureNode | EdifactComposite | EdifactElement,
  ): EdifactElement[] => (node.kind === 'element' ? [node] : node.children.flatMap(visit))

  return structure.children.flatMap(visit)
}

export function containerOf(paths: Iterable<string>, path: string) {
  return [...paths].some((inner) => inner.startsWith(`${path}/`) || inner.startsWith(`${path}.`))
}

export type SideLeaves = { source: ReadonlySet<string>; target: ReadonlySet<string> }

export function mappingSideLeaves(
  messageType: MessageType,
  documentStructure: Pick<DocumentStructure, 'children'>,
): SideLeaves {
  const document = new Set(documentStructureLeaves(documentStructure).map(({ path }) => path))
  const edifact = new Set(edifactLeaves(messageTypeStructures[messageType]).map(({ path }) => path))

  return directionOf({ messageType }) === 'inbound'
    ? { source: edifact, target: document }
    : { source: document, target: edifact }
}

type LinkedPath = { path: string; wholePart: boolean }

export function unknownPaths(graph: GraphParts, leaves: SideLeaves) {
  const loops = new Set(graph.transforms.flatMap(({ id, kind }) => (kind === 'loop' ? [id] : [])))

  // A loop takes a whole repeated part and fills one; every other link ends at a field or element.
  const sourcePaths: LinkedPath[] = [
    ...graph.links.map(({ sourcePath }) => ({ path: sourcePath, wholePart: false })),
    ...graph.transformLinks.flatMap(({ from, to }) =>
      from.kind === 'source'
        ? [
            {
              path: from.path,
              wholePart:
                to.kind === 'transform' && loops.has(to.transformId) && to.input === 'items',
            },
          ]
        : [],
    ),
  ]

  const targetPaths: LinkedPath[] = [
    ...graph.links.map(({ targetPath }) => ({ path: targetPath, wholePart: false })),
    ...graph.transformLinks.flatMap(({ from, to }) =>
      to.kind === 'target'
        ? [
            {
              path: to.path,
              wholePart:
                from.kind === 'transform' && loops.has(from.transformId) && from.output === 'items',
            },
          ]
        : [],
    ),
  ]

  const missing = (side: ReadonlySet<string>) => (linked: LinkedPath) =>
    !side.has(linked.path) && !(linked.wholePart && containerOf(side, linked.path))
      ? [linked.path]
      : []

  return {
    source: new Set(sourcePaths.flatMap(missing(leaves.source))),
    target: new Set(targetPaths.flatMap(missing(leaves.target))),
  }
}

export function unknownPathMessage(graph: GraphParts, leaves: SideLeaves): string | null {
  const unknown = unknownPaths(graph, leaves)
  const [unknownSource] = unknown.source
  const [unknownTarget] = unknown.target

  if (unknownSource !== undefined) {
    return `The source has no field or element at ${unknownSource}`
  }

  if (unknownTarget !== undefined) {
    return `The target has no field or element at ${unknownTarget}`
  }

  return null
}
