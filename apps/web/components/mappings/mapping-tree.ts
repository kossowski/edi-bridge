import type { Locale } from '@/i18n/locales'
import type {
  DocumentStructureNode,
  EdifactComposite,
  EdifactElement,
  EdifactStructureNode,
  MappingLink,
  MessageTypeStructure,
} from '@edi-bridge/contracts'

export type TreeItemKind =
  'field' | 'object' | 'array' | 'segmentGroup' | 'segment' | 'composite' | 'element'

// `unbounded` for Document arrays, a number for EDIFACT parts that repeat up to maxRepeat times.
export type Repeat = 'unbounded' | number | null

export type TreeItem = {
  path: string
  kind: TreeItemKind
  label: string
  name: string | null
  detail: string | null
  required: boolean
  repeat: Repeat
  children: TreeItem[]
}

export type Side = 'source' | 'target'

function documentItem(node: DocumentStructureNode): TreeItem {
  const base = { path: node.path, label: node.name, required: node.required, name: null }

  switch (node.kind) {
    case 'field':
      return { ...base, kind: 'field', detail: node.type, repeat: null, children: [] }
    case 'object':
      return { ...base, kind: 'object', detail: null, repeat: null, children: documentItems(node) }
    // An array's items share its path, so the array and its item are one row on the canvas.
    case 'array':
      return {
        ...base,
        kind: 'array',
        detail: node.items.kind === 'field' ? node.items.type : null,
        repeat: 'unbounded',
        children: node.items.kind === 'object' ? documentItems(node.items) : [],
      }
  }
}

function documentItems(parent: { children: DocumentStructureNode[] }): TreeItem[] {
  return parent.children.map(documentItem)
}

export function documentTree(structure: { children: DocumentStructureNode[] }): TreeItem[] {
  return documentItems(structure)
}

function repeatOf(maxRepeat: number): Repeat {
  return maxRepeat > 1 ? maxRepeat : null
}

function edifactItem(
  node: EdifactStructureNode | EdifactComposite | EdifactElement,
  locale: Locale,
): TreeItem {
  const base = { path: node.path, name: node.name[locale], required: node.required }

  switch (node.kind) {
    case 'segmentGroup':
      return {
        ...base,
        kind: 'segmentGroup',
        label: node.path.split('/').at(-1)!,
        detail: null,
        repeat: repeatOf(node.maxRepeat),
        children: node.children.map((child) => edifactItem(child, locale)),
      }
    case 'segment':
      return {
        ...base,
        kind: 'segment',
        label: node.qualifier ? `${node.tag}+${node.qualifier.code}` : node.tag,
        detail: null,
        repeat: repeatOf(node.maxRepeat),
        children: node.children.map((child) => edifactItem(child, locale)),
      }
    case 'composite':
      return {
        ...base,
        kind: 'composite',
        label: node.code,
        detail: null,
        repeat: null,
        children: node.children.map((child) => edifactItem(child, locale)),
      }
    case 'element':
      return {
        ...base,
        kind: 'element',
        label: node.code,
        detail: node.format,
        repeat: null,
        children: [],
      }
  }
}

export function edifactTree(
  structure: Pick<MessageTypeStructure, 'children'>,
  locale: Locale,
): TreeItem[] {
  return structure.children.map((node) => edifactItem(node, locale))
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
  // Only containers have it: whether their children are shown.
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

export function layoutTree(
  items: ReadonlyArray<TreeItem>,
  { side, x, y, collapsed }: { side: Side; x: number; y: number; collapsed: ReadonlySet<string> },
) {
  const rows: TreeRow[] = []
  // Maps every path to the path of the row that shows it: itself, or its collapsed ancestor.
  const visible = new Map<string, string>()

  const hide = (item: TreeItem, shownAs: string) => {
    visible.set(item.path, shownAs)
    item.children.forEach((child) => hide(child, shownAs))
  }

  const place = (item: TreeItem, depth: number, top: number): number => {
    const { children, ...rest } = item
    const container = children.length > 0
    const expanded = container ? !collapsed.has(item.path) : null

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
      childCount: children.length,
    }

    rows.push(row)
    visible.set(item.path, item.path)

    if (!expanded) {
      children.forEach((child) => hide(child, item.path))

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
  source: string
  target: string
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

    const source = nodeId('source', sourcePath)
    const target = nodeId('target', targetPath)
    const id = `${source}->${target}`
    const existing = byId.get(id)

    if (existing) {
      existing.links.push(link)
    } else {
      byId.set(id, { id, source, target, links: [link] })
    }
  }

  return [...byId.values()]
}
