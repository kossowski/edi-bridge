import {
  csvRowsPath,
  defaultCsvSettings,
  type DocumentFieldType,
  type DocumentStructureNode,
  documentStructureNodes,
  type DocumentStructureOrigin,
  type DocumentStructureOriginKind,
  type EncodedFile,
  type InferredDocumentStructure,
  jsonItemsPath,
  maxEncodedFileBytes,
  type NodeAdjustment,
  nodeContent,
} from '@edi-bridge/contracts'

export type StructureTree = Pick<InferredDocumentStructure, 'format' | 'children'> & {
  root?: 'object' | 'array'
}

export type NodeSettings = {
  required: boolean
  repeating: boolean
  type: DocumentFieldType | null
}

export type SettingsChange = Partial<{
  required: boolean
  repeating: boolean
  type: DocumentFieldType
}>

export type Adjustments = ReadonlyMap<string, NodeAdjustment>

export type Adjustable = { required: boolean; repeating: boolean; type: boolean }

export type StructureRow = {
  node: DocumentStructureNode
  level: number
  position: number
  setSize: number
  parentPath: string | null
  childCount: number | null
  expanded: boolean | null
}

export function settingsOf(node: DocumentStructureNode): NodeSettings {
  const content = nodeContent(node)

  return {
    required: node.required,
    repeating: node.kind === 'array',
    type: content.kind === 'field' ? content.type : null,
  }
}

export function adjustedSettings(node: DocumentStructureNode, adjustments: Adjustments) {
  const own = settingsOf(node)
  const adjustment = adjustments.get(node.path)

  return {
    required: adjustment?.required ?? own.required,
    repeating: adjustment?.repeating ?? own.repeating,
    type: adjustment?.type ?? own.type,
  }
}

export function withAdjustment(
  adjustments: Adjustments,
  node: DocumentStructureNode,
  change: SettingsChange,
): Adjustments {
  const own = settingsOf(node)
  const merged = { ...adjustments.get(node.path), ...change }
  const next = new Map(adjustments)

  const adjustment: NodeAdjustment = {
    path: node.path,
    ...(merged.required !== undefined &&
      merged.required !== own.required && { required: merged.required }),
    ...(merged.repeating !== undefined &&
      merged.repeating !== own.repeating && { repeating: merged.repeating }),
    ...(merged.type !== undefined && merged.type !== own.type && { type: merged.type }),
  }

  if (Object.keys(adjustment).length === 1) {
    next.delete(node.path)
  } else {
    next.set(node.path, adjustment)
  }

  return next
}

export function rootListPath(tree: StructureTree) {
  if (tree.format === 'csv') {
    return csvRowsPath
  }

  return tree.root === 'array' ? jsonItemsPath : undefined
}

export function adjustable(tree: StructureTree, node: DocumentStructureNode): Adjustable {
  if (node.path === rootListPath(tree)) {
    return { required: false, repeating: false, type: false }
  }

  return {
    required: true,
    repeating: tree.format === 'json',
    type: nodeContent(node).kind === 'field',
  }
}

function childrenOf(node: DocumentStructureNode) {
  const content = nodeContent(node)

  return content.kind === 'object' ? content.children : null
}

export function containerPaths(children: ReadonlyArray<DocumentStructureNode>) {
  return [...documentStructureNodes(children)].flatMap(({ node }) =>
    childrenOf(node) === null ? [] : [node.path],
  )
}

export function visibleRows(
  children: ReadonlyArray<DocumentStructureNode>,
  expanded: ReadonlySet<string>,
): StructureRow[] {
  const rows: StructureRow[] = []

  const visit = (
    nodes: ReadonlyArray<DocumentStructureNode>,
    level: number,
    parentPath: string | null,
  ) => {
    nodes.forEach((node, index) => {
      const nested = childrenOf(node)
      const open = nested !== null && expanded.has(node.path)

      rows.push({
        node,
        level,
        position: index + 1,
        setSize: nodes.length,
        parentPath,
        childCount: nested?.length ?? null,
        expanded: nested === null ? null : open,
      })

      if (nested && open) {
        visit(nested, level + 1, node.path)
      }
    })
  }

  visit(children, 1, null)

  return rows
}

// Opens containers level by level as long as the shown rows stay within the limit, so a large
// Document Structure still opens quickly and a small one opens completely.
export function initialExpanded(
  children: ReadonlyArray<DocumentStructureNode>,
  limit = 120,
): Set<string> {
  const expanded = new Set<string>()
  let shown = children.length
  let level = [...children]

  while (level.length > 0) {
    const next: DocumentStructureNode[] = []

    for (const node of level) {
      const nested = childrenOf(node)

      if (nested && shown + nested.length <= limit) {
        expanded.add(node.path)
        shown += nested.length
        next.push(...nested)
      }
    }

    level = next
  }

  return expanded
}

export function ancestorPaths(children: ReadonlyArray<DocumentStructureNode>, path: string) {
  for (const { node, ancestors } of documentStructureNodes(children)) {
    if (node.path === path) {
      return ancestors.map((ancestor) => ancestor.path)
    }
  }

  return null
}

export function leafCount(children: ReadonlyArray<DocumentStructureNode>) {
  return [...documentStructureNodes(children)].filter(({ node }) => childrenOf(node) === null)
    .length
}

export function encodeBase64(bytes: Uint8Array) {
  let binary = ''

  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }

  return btoa(binary)
}

export type FileProblem = 'empty' | 'tooLarge'

export function fileProblem(size: number): FileProblem | null {
  if (size === 0) {
    return 'empty'
  }

  return size > maxEncodedFileBytes ? 'tooLarge' : null
}

export function originKindOf(fileName: string): DocumentStructureOriginKind | null {
  const lower = fileName.toLowerCase()

  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return 'csvDocument'
  }

  if (lower.endsWith('.schema.json')) {
    return 'jsonSchema'
  }

  return lower.endsWith('.json') ? 'jsonDocument' : null
}

export function toOrigin(
  kind: DocumentStructureOriginKind,
  file: EncodedFile,
): DocumentStructureOrigin {
  switch (kind) {
    case 'jsonDocument':
      return { kind, document: file }
    case 'csvDocument':
      return { kind, document: file, csv: defaultCsvSettings }
    case 'jsonSchema':
      return { kind, jsonSchema: file }
  }
}

export function nameFromFileName(fileName: string) {
  return fileName
    .replace(/(\.schema)?\.[^.]+$/i, '')
    .replaceAll(/[-_]+/g, ' ')
    .trim()
    .slice(0, 70)
}
