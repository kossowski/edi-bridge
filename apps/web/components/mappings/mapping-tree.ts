import type { Locale } from '@/i18n/locales'
import type {
  DocumentStructureNode,
  EdifactCode,
  EdifactComposite,
  EdifactElement,
  EdifactSegmentGroup,
  EdifactStructureNode,
  MappingLink,
  MessageTypeStructure,
} from '@edi-bridge/contracts'

export type TreeItemKind =
  'field' | 'object' | 'array' | 'segmentGroup' | 'segment' | 'composite' | 'element'

export type Repeat = 'unbounded' | number | null

export type CodeMeaning = { code: string; meaning: string }

export type EdifactMeaning = { qualifier: CodeMeaning | null; codes: ReadonlyArray<CodeMeaning> }

export type TreeItem = {
  path: string
  kind: TreeItemKind
  label: string
  name: string | null
  detail: string | null
  required: boolean
  repeat: Repeat
  edifact?: EdifactMeaning
  // `null` marks a leaf, so an empty container, e.g. an object without fields, is not taken for one.
  children: TreeItem[] | null
}

export type Side = 'source' | 'target'

function documentItem(node: DocumentStructureNode): TreeItem {
  const base = {
    path: node.path,
    label: node.name,
    required: node.required,
    name: null,
  }

  switch (node.kind) {
    case 'field':
      return { ...base, kind: 'field', detail: node.type, repeat: null, children: null }
    case 'object':
      return { ...base, kind: 'object', detail: null, repeat: null, children: documentTree(node) }
    // An array's items share its path, so the array and its item are one row on the canvas.
    case 'array':
      return {
        ...base,
        kind: 'array',
        detail: node.items.kind === 'field' ? node.items.type : null,
        repeat: 'unbounded',
        children: node.items.kind === 'object' ? documentTree(node.items) : null,
      }
  }
}

export function documentTree(parent: { children: DocumentStructureNode[] }): TreeItem[] {
  return parent.children.map(documentItem)
}

function repeatOf(maxRepeat: number): Repeat {
  return maxRepeat > 1 ? maxRepeat : null
}

function codeMeaning({ code, meaning }: EdifactCode, locale: Locale): CodeMeaning {
  return { code, meaning: meaning[locale] }
}

// A group's first segment is its trigger segment, so that segment's qualifier, e.g. NAD+BY in
// SG2+BY, qualifies the whole group.
function groupQualifier(group: EdifactSegmentGroup) {
  const [trigger] = group.children

  return trigger?.kind === 'segment' ? trigger.qualifier : null
}

function edifactItem(
  node: EdifactStructureNode | EdifactComposite | EdifactElement,
  locale: Locale,
): TreeItem {
  const base = {
    path: node.path,
    name: node.name[locale],
    required: node.required,
  }

  const meaning = (qualifier: EdifactCode | null, codes: ReadonlyArray<EdifactCode> = []) => ({
    qualifier: qualifier && codeMeaning(qualifier, locale),
    codes: codes.map((code) => codeMeaning(code, locale)),
  })

  const children = 'children' in node ? edifactItems(node.children, locale) : null

  switch (node.kind) {
    case 'segmentGroup':
      return {
        ...base,
        kind: 'segmentGroup',
        label: node.path.split('/').at(-1)!,
        detail: null,
        repeat: repeatOf(node.maxRepeat),
        edifact: meaning(groupQualifier(node)),
        children,
      }
    case 'segment':
      return {
        ...base,
        kind: 'segment',
        label: node.qualifier ? `${node.tag}+${node.qualifier.code}` : node.tag,
        detail: null,
        repeat: repeatOf(node.maxRepeat),
        edifact: meaning(node.qualifier),
        children,
      }
    case 'composite':
      return {
        ...base,
        kind: 'composite',
        label: node.code,
        detail: null,
        repeat: null,
        edifact: meaning(null),
        children,
      }
    case 'element':
      return {
        ...base,
        kind: 'element',
        label: node.code,
        detail: node.format,
        repeat: null,
        edifact: meaning(null, node.codes),
        children,
      }
  }
}

function edifactItems(
  nodes: ReadonlyArray<EdifactStructureNode | EdifactComposite | EdifactElement>,
  locale: Locale,
): TreeItem[] {
  return nodes.map((node) => edifactItem(node, locale))
}

export function edifactTree(
  structure: Pick<MessageTypeStructure, 'children'>,
  locale: Locale,
): TreeItem[] {
  return edifactItems(structure.children, locale)
}

export function findItem(items: ReadonlyArray<TreeItem>, path: string): TreeItem | undefined {
  for (const item of items) {
    if (item.path === path) {
      return item
    }

    const found = findItem(item.children ?? [], path)

    if (found) {
      return found
    }
  }

  return undefined
}

export type TreeRow = Omit<TreeItem, 'children'> & {
  id: string
  side: Side
  depth: number
  x: number
  y: number
  width: number
  height: number
  linkable: boolean
  expanded: boolean | null
  childCount: number
}

export const rowHeight = 32

const rowGap = 6

const indent = 14

const innerRight = 6

const containerBottom = 6

export const columnWidth = 380

export const columnGap = 260

export const headingHeight = 60

export function nodeId(side: Side, path: string) {
  return `${side}:${path}`
}

export function rowOfNodeId(id: string): { side: Side; path: string } | null {
  const colon = id.indexOf(':')
  const side = id.slice(0, colon)

  return colon > 0 && (side === 'source' || side === 'target')
    ? { side, path: id.slice(colon + 1) }
    : null
}

export function layoutTree(
  items: ReadonlyArray<TreeItem>,
  { side, x, y, collapsed }: { side: Side; x: number; y: number; collapsed: ReadonlySet<string> },
) {
  const rows: TreeRow[] = []
  const visible = new Map<string, string>()

  const hide = (item: TreeItem, shownAs: string) => {
    visible.set(item.path, shownAs)
    item.children?.forEach((child) => hide(child, shownAs))
  }

  const place = (item: TreeItem, depth: number, top: number): number => {
    const { children, ...rest } = item
    const container = children !== null
    const expanded = container && children.length > 0 ? !collapsed.has(item.path) : null

    const row: TreeRow = {
      ...rest,
      id: nodeId(side, item.path),
      side,
      depth,
      x: x + depth * indent,
      y: top,
      width: columnWidth - depth * (indent + innerRight),
      height: rowHeight,
      linkable: !container,
      expanded,
      childCount: children?.length ?? 0,
    }

    rows.push(row)
    visible.set(item.path, item.path)

    if (!expanded || children === null) {
      children?.forEach((child) => hide(child, item.path))

      return top + rowHeight + rowGap
    }

    let next = top + rowHeight + rowGap

    for (const child of children) {
      next = place(child, depth + 1, next)
    }

    row.height = next - rowGap + containerBottom - top

    return top + row.height + rowGap
  }

  items.reduce((top, item) => place(item, 0, top), y)

  return { rows, visible }
}

export type CanvasLink = {
  id: string
  sourcePath: string
  targetPath: string
  // Links that end inside a collapsed part are drawn to that part and merged.
  links: MappingLink[]
}

export function canvasLinks(
  links: ReadonlyArray<MappingLink>,
  visible: { source: ReadonlyMap<string, string>; target: ReadonlyMap<string, string> },
): CanvasLink[] {
  const byId = new Map<string, CanvasLink>()

  for (const link of links) {
    const sourcePath = visible.source.get(link.sourcePath)
    const targetPath = visible.target.get(link.targetPath)

    if (sourcePath === undefined || targetPath === undefined) {
      continue
    }

    const id = `${nodeId('source', sourcePath)}->${nodeId('target', targetPath)}`
    const existing = byId.get(id)

    if (existing) {
      existing.links.push(link)
    } else {
      byId.set(id, { id, sourcePath, targetPath, links: [link] })
    }
  }

  return [...byId.values()]
}
