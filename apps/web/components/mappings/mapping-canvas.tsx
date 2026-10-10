'use client'

import '@xyflow/react/dist/style.css'
import './mapping-canvas.css'

import { useQuery } from '@tanstack/react-query'
import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type IsValidConnection,
  type OnConnectEnd,
  type OnNodeDrag,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
import {
  type MouseEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { type GraphText, useGraphText } from '@/components/mappings/graph-text'
import {
  LinkActionsContext,
  type LinkActions,
  LinkEdge,
  type LinkFlowEdge,
} from '@/components/mappings/link-edge'
import {
  LinkableRowsContext,
  useCanvasStore,
  useCanvasStoreApi,
  useMeaningTooltip,
} from '@/components/mappings/mapping-canvas-store'
import {
  type CanvasIssue,
  canvasIssues,
  configureTransform,
  connect,
  freeSlot,
  type Graph,
  type GraphChange,
  linkIntoInput,
  linkIntoTarget,
  maxTransformX,
  moveTransform,
  newTransform,
  type Position,
  type Rect,
  removeTransform,
  sameStart,
  takesPart,
  transformById,
  transformInset,
  transformWidth,
} from '@/components/mappings/mapping-graph'
import {
  expressionPathItems,
  isLinkableRow,
  isWholePart,
  leafPaths,
  type LinkableRows,
  linksOfItem,
  repeatingPaths,
  type RowLink,
  type RowRef,
  rowListingLinks,
} from '@/components/mappings/mapping-links'
import {
  canvasLinks,
  columnGap,
  columnWidth,
  findItem,
  headingHeight,
  layoutTree,
  nodeId,
  panelGutter,
  rowOfNodeId,
  type Side,
  type TreeItem,
  type TreeRow,
} from '@/components/mappings/mapping-tree'
import {
  LinkHints,
  type PanelActions,
  PendingLink,
  RowLinks,
} from '@/components/mappings/row-links'
import { RowMeaning } from '@/components/mappings/row-meaning-view'
import {
  type SourceField,
  TransformDetails,
  type TransformDetailsActions,
} from '@/components/mappings/transform-details'
import {
  findTransformButton,
  inputHandle,
  outputHandle,
  type PortRef,
  portOfButton,
  portOfHandle,
  type TransformActions,
  TransformActionsContext,
  type TransformFlowNode,
  TransformNode,
} from '@/components/mappings/transform-node'
import { TransformPalette } from '@/components/mappings/transform-palette'
import {
  findRowButton,
  HeadingNode,
  type HeadingFlowNode,
  rowOfButton,
  TreeNode,
  type TreeFlowNode,
} from '@/components/mappings/tree-node'
import { lookupTablesQuery } from '@/lib/api/queries'
import { transformPorts } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Tooltip, TooltipContent } from '@edi-bridge/ui/components/tooltip'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { GraphSave } from '@/components/mappings/use-save-graph'
import type {
  LinkEnd,
  LinkStart,
  MappingTransform,
  TransformKind,
  TransformLink,
} from '@edi-bridge/contracts'

type CanvasNode = TreeFlowNode | HeadingFlowNode | TransformFlowNode

const nodeTypes = { tree: TreeNode, heading: HeadingNode, transform: TransformNode }

const edgeTypes = { link: LinkEdge }

const targetX = columnWidth + columnGap

const transformX = columnWidth + transformInset

const canvasWidth = targetX + columnWidth

const viewportPadding = 24

// Below this the part labels shrink under a readable size; the user pans to the rest instead.
const minInitialZoom = 0.85

// React Flow announces every node as one to select, move or delete; these nodes are none of that.
const plainNode = { 'aria-roledescription': undefined, 'aria-describedby': undefined }

// Above the edges, which cross the trees, so a link passing behind a transform does not hide it.
const transformLayer = 200

const transformPrefix = 'transform:'

const transformNodeId = (id: string) => `${transformPrefix}${id}`

const transformOfNodeId = (id: string) =>
  id.startsWith(transformPrefix) ? id.slice(transformPrefix.length) : null

// Kept in the space between the trees, two columns wide.
const transformExtent: [[number, number], [number, number]] = [
  [transformX, headingHeight],
  [transformX + maxTransformX + transformWidth, 1_000_000],
]

export type CanvasSide = { title: string; items: ReadonlyArray<TreeItem> }

// The band under the canvas: the Details panel, and beside it whatever the screen adds, such as the
// preview, which toggles the whole band and so needs to name the Details body it hides.
export type CanvasBand = { open: boolean; onToggle: () => void; controls: string }

type MappingCanvasProps = {
  label: string
  graph: Graph
  source: CanvasSide
  target: CanvasSide
  onChange: (save: GraphSave) => void
  beside?: (band: CanvasBand) => ReactNode
}

// Mounted only while the tooltip shows a row, so that row's button can point at the tooltip.
function TooltipRowId({ id }: { id: string }) {
  const setTooltipRowId = useCanvasStore((state) => state.setTooltipRowId)

  useEffect(() => {
    setTooltipRowId(id)

    return () => setTooltipRowId(null)
  }, [id, setTooltipRowId])

  return null
}

function MeaningTooltip() {
  const tooltip = useMeaningTooltip()

  return (
    <Tooltip handle={tooltip.handle}>
      {({ payload }) =>
        payload && (
          <TooltipContent
            id={tooltip.id}
            align="start"
            role="tooltip"
            side={payload.side === 'source' ? 'right' : 'left'}
            sideOffset={8}
            className="max-w-sm flex-col items-stretch px-3 py-2">
            <TooltipRowId id={payload.id} />
            <RowMeaning codeLimit={5} item={payload} />
          </TooltipContent>
        )
      }
    </Tooltip>
  )
}

function DetailsPanel({
  itemOf,
  graph,
  issues,
  rows,
  sourceFields,
  text,
  actions,
  transformActions,
  bodyId,
  open,
  ref,
}: {
  itemOf: (row: RowRef) => TreeItem | undefined
  graph: Graph
  issues: Readonly<Record<string, CanvasIssue[]>>
  rows: LinkableRows
  sourceFields: ReadonlyArray<SourceField>
  text: GraphText
  actions: PanelActions
  transformActions: TransformDetailsActions
  bodyId: string
  open: boolean
  ref: Ref<HTMLElement>
}) {
  const t = useTranslations('Mapping')
  const heading = useId()
  const selected = useCanvasStore((state) => state.selected)
  const selectedTransform = useCanvasStore((state) => state.selectedTransform)
  const item = selected && itemOf(selected)
  const transform = selectedTransform ? transformById(graph, selectedTransform) : undefined

  const content = () => {
    if (transform) {
      return (
        <TransformDetails
          actions={transformActions}
          graph={graph}
          issues={issues[transform.id] ?? []}
          sourceFields={sourceFields}
          text={text}
          transform={transform}
        />
      )
    }

    if (selected && item) {
      return (
        <>
          <div aria-live="polite" className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t(`canvas.${selected.side}`)}
            </p>
            <RowMeaning item={item} className="flex-row flex-wrap gap-x-8 gap-y-2 text-sm" />
          </div>
          <RowLinks
            actions={actions}
            graph={graph}
            item={item}
            row={selected}
            rows={rows}
            text={text}
          />
        </>
      )
    }

    return (
      <div aria-live="polite">
        <p className="text-muted-foreground text-sm">{t('details.empty')}</p>
      </div>
    )
  }

  return (
    <section
      ref={ref}
      aria-labelledby={heading}
      className="bg-card flex min-h-0 min-w-0 flex-col rounded-lg border">
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-4 py-1.5">
        <h2 id={heading} className="text-sm font-semibold">
          {t('details.title')}
        </h2>
        {(item || transform) && (
          <Button size="sm" variant="ghost" onClick={actions.clear}>
            {t('details.clear')}
          </Button>
        )}
      </div>
      <div
        id={bodyId}
        hidden={!open}
        role="group"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a tab stop to scroll long details
        tabIndex={0}
        aria-labelledby={heading}
        className="focus-visible:ring-ring/50 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t px-4 py-3 outline-none focus-visible:ring-3">
        <PendingLink text={text} onCancel={actions.cancel} />
        {content()}
        <p className="text-muted-foreground text-xs">{t('links.shortcut')}</p>
      </div>
    </section>
  )
}

// Focus moves once the change has rendered, when the button it goes to exists.
function afterRender(focus: () => void) {
  requestAnimationFrame(focus)
}

// About a second at 60 fps. The cached Draft updates a few frames after the click, once the
// mutation has started; if it never does, focus still moves on rather than waiting forever.
const renderWaitFrames = 60

function whenRendered(done: () => boolean, then: () => void, frames = renderWaitFrames) {
  requestAnimationFrame(() =>
    done() || frames === 0 ? then() : whenRendered(done, then, frames - 1),
  )
}

// React Flow keeps a new node hidden until it has measured it, and a hidden button takes no focus.
function shown(element: HTMLElement | null) {
  return element !== null && getComputedStyle(element).visibility !== 'hidden'
}

type Ends = { from: LinkStart; to: LinkEnd }

type ConnectionEnds = Pick<Connection, 'source' | 'target'> & {
  sourceHandle?: string | null | undefined
  targetHandle?: string | null | undefined
}

function endsOfConnection({
  source,
  sourceHandle,
  target,
  targetHandle,
}: ConnectionEnds): Ends | null {
  const fromTransform = transformOfNodeId(source)
  const toTransform = transformOfNodeId(target)
  const output = portOfHandle(sourceHandle, 'out')
  const input = portOfHandle(targetHandle, 'in')
  const fromRow = rowOfNodeId(source)
  const toRow = rowOfNodeId(target)

  const from: LinkStart | null =
    fromTransform && output
      ? { kind: 'transform', transformId: fromTransform, output }
      : fromRow?.side === 'source'
        ? { kind: 'source', path: fromRow.path }
        : null

  const to: LinkEnd | null =
    toTransform && input
      ? { kind: 'transform', transformId: toTransform, input }
      : toRow?.side === 'target'
        ? { kind: 'target', path: toRow.path }
        : null

  return from && to ? { from, to } : null
}

function startNode(from: LinkStart, visible: ReadonlyMap<string, string>) {
  if (from.kind === 'transform') {
    return { node: transformNodeId(from.transformId), handle: outputHandle(from.output) }
  }

  const shown = visible.get(from.path)

  return shown === undefined ? null : { node: nodeId('source', shown), handle: null }
}

function endNode(to: LinkEnd, visible: ReadonlyMap<string, string>) {
  if (to.kind === 'transform') {
    return { node: transformNodeId(to.transformId), handle: inputHandle(to.input) }
  }

  const shown = visible.get(to.path)

  return shown === undefined ? null : { node: nodeId('target', shown), handle: null }
}

// An input or a target takes one link, so its end names the link.
function endKey(to: LinkEnd) {
  return to.kind === 'target' ? `target:${to.path}` : `${to.transformId}/${to.input}`
}

// A new node is measured once rendered; until then its height follows from its ports.
function estimatedHeight(transform: MappingTransform) {
  const { inputs, outputs } = transformPorts(transform)

  return 80 + 30 * Math.max(inputs.length, outputs.length, 1)
}

function samePosition(a: Position, b: Position) {
  return a.x === b.x && a.y === b.y
}

export function MappingCanvas({
  label,
  graph,
  source,
  target,
  onChange,
  beside,
}: MappingCanvasProps) {
  const t = useTranslations('Mapping.canvas')
  const tLinks = useTranslations('Mapping.links')
  const tTransforms = useTranslations('Mapping.transforms')
  const root = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const detailsBodyId = useId()
  const store = useCanvasStoreApi()
  const bandOpen = useCanvasStore((state) => state.bandOpen)
  const toggleBand = useCanvasStore((state) => state.toggleBand)
  const collapsed = useCanvasStore((state) => state.collapsed)
  const clearSelection = useCanvasStore((state) => state.clearSelection)
  const hoverEdge = useCanvasStore((state) => state.hoverEdge)
  const leaveEdge = useCanvasStore((state) => state.leaveEdge)
  const usesLookupTables = graph.transforms.some(({ kind }) => kind === 'lookupTable')
  const lookupTables = useQuery({ ...lookupTablesQuery, enabled: usesLookupTables })
  const text = useGraphText(graph.transforms, lookupTables.data)

  // Where dragged nodes are shown until the cached Draft, and so its transforms, changes.
  const [dragged, setDragged] = useState<{
    transforms: Graph['transforms']
    positions: ReadonlyMap<string, Position>
  } | null>(null)

  const draggedTo = useCallback(
    (transformId: string) =>
      dragged?.transforms === graph.transforms ? dragged.positions.get(transformId) : undefined,
    [dragged, graph.transforms],
  )

  const save = useCallback(
    (change: GraphChange) => onChange({ change, ...text.change(change) }),
    [onChange, text],
  )

  const rows = useMemo(
    (): LinkableRows => ({
      leaves: { source: leafPaths(source.items), target: leafPaths(target.items) },
      parts: { source: repeatingPaths(source.items), target: repeatingPaths(target.items) },
    }),
    [source.items, target.items],
  )

  const sourceFields = useMemo(
    () =>
      expressionPathItems(source.items).map((item): SourceField => ({
        path: item.path,
        label: item.name ?? item.label,
      })),
    [source.items],
  )

  const issues = useMemo(
    () =>
      canvasIssues(
        { links: graph.links, transforms: graph.transforms, transformLinks: graph.transformLinks },
        lookupTables.data,
        { source: source.items, target: target.items },
      ),
    [
      graph.links,
      graph.transforms,
      graph.transformLinks,
      lookupTables.data,
      source.items,
      target.items,
    ],
  )

  const flow = useRef<ReactFlowInstance<CanvasNode, LinkFlowEdge>>(null)

  // React Flow measures a node's handles again whenever a node comes without its size, and its
  // links vanish meanwhile; the trees' sizes are known, the transforms report theirs.
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map())

  const reportHeight = useCallback(
    (transformId: string, height: number) =>
      setHeights((current) =>
        current.get(transformId) === height
          ? current
          : new Map([...current, [transformId, height]]),
      ),
    [],
  )

  const { nodes, edges } = useMemo(() => {
    const layouts = {
      source: layoutTree(source.items, {
        side: 'source',
        x: 0,
        y: headingHeight,
        collapsed: collapsed.source,
      }),
      target: layoutTree(target.items, {
        side: 'target',
        x: targetX,
        y: headingHeight,
        collapsed: collapsed.target,
      }),
    }

    const shown = canvasLinks(graph.links, {
      source: layouts.source.visible,
      target: layouts.target.visible,
    })

    const transformEdges = graph.transformLinks.flatMap((link): LinkFlowEdge[] => {
      const from = startNode(link.from, layouts.source.visible)
      const to = endNode(link.to, layouts.target.visible)

      if (!from || !to) {
        return []
      }

      const names = { source: text.start(link.from), target: text.end(link.to) }

      return [
        {
          id: `transform-link:${endKey(link.to)}`,
          type: 'link',
          source: from.node,
          sourceHandle: from.handle,
          target: to.node,
          targetHandle: to.handle,
          data: { kind: 'transformLink', link, ...names },
          selectable: false,
          focusable: false,
          zIndex: 100,
          ariaLabel: t('link', names),
        },
      ]
    })

    const linked = new Set([
      ...shown.flatMap((link) => [
        nodeId('source', link.sourcePath),
        nodeId('target', link.targetPath),
      ]),
      ...transformEdges.flatMap((edge) => [edge.source, edge.target]),
    ])

    const heading = (side: Side, x: number, title: string): HeadingFlowNode => ({
      id: `${side}:heading`,
      type: 'heading',
      position: { x, y: 0 },
      width: columnWidth,
      height: headingHeight - 8,
      measured: { width: columnWidth, height: headingHeight - 8 },
      data: { side: t(side), title },
      draggable: false,
      selectable: false,
      focusable: false,
      domAttributes: plainNode,
    })

    const treeNode = (row: TreeRow): TreeFlowNode => ({
      id: row.id,
      type: 'tree',
      position: { x: row.x, y: row.y },
      width: row.width,
      height: row.height,
      measured: { width: row.width, height: row.height },
      zIndex: row.depth,
      data: {
        ...row,
        linked: linked.has(row.id),
        filled: row.side === 'target' && linkIntoTarget(graph, row.path) !== null,
        wholePart: isWholePart(rows, row),
      },
      draggable: false,
      selectable: false,
      focusable: false,
      domAttributes: plainNode,
    })

    const transformNodes = graph.transforms.map((transform): TransformFlowNode => {
      const position = draggedTo(transform.id) ?? transform.position
      const ports = transformPorts(transform)
      const height = heights.get(transform.id)

      const inputs = ports.inputs.map((port) => {
        const into = linkIntoInput(graph, transform.id, port)

        return {
          port,
          label: text.input(port),
          linked: into !== null,
          takesPart: takesPart(graph, {
            kind: 'transform',
            transformId: transform.id,
            input: port,
          }),
          status: into
            ? tTransforms('node.linkedFrom', { source: text.start(into.from) })
            : tTransforms('node.notLinked'),
        }
      })

      const outputs = ports.outputs.map((port) => {
        const own = graph.transformLinks.filter(({ from }) =>
          sameStart(from, { kind: 'transform', transformId: transform.id, output: port }),
        )

        const [first] = own

        return {
          port,
          label: text.output(port),
          linked: own.length > 0,
          takesPart: takesPart(graph, {
            kind: 'transform',
            transformId: transform.id,
            output: port,
          }),
          status: tTransforms('node.linkedTo', {
            count: own.length,
            target: first ? text.end(first.to) : '',
          }),
        }
      })

      return {
        id: transformNodeId(transform.id),
        type: 'transform',
        position: { x: transformX + position.x, y: headingHeight + position.y },
        width: transformWidth,
        ...(height !== undefined && { measured: { width: transformWidth, height } }),
        zIndex: transformLayer,
        extent: transformExtent,
        data: {
          transformId: transform.id,
          name: text.name(transform.id),
          summary: text.summary(transform),
          issues: (issues[transform.id] ?? []).map((issue) => text.issue(transform.kind, issue)),
          inputs,
          outputs,
        },
        draggable: true,
        selectable: false,
        focusable: false,
        domAttributes: plainNode,
      }
    })

    const plainEdges = shown.map(({ id, sourcePath, targetPath, links: merged }): LinkFlowEdge => {
      const [first] = merged

      return {
        id,
        type: 'link',
        source: nodeId('source', sourcePath),
        target: nodeId('target', targetPath),
        data: { kind: 'link', sourcePath, targetPath, links: merged },
        selectable: false,
        focusable: false,
        zIndex: 100,
        ariaLabel:
          merged.length === 1 && first
            ? t('link', { source: first.sourcePath, target: first.targetPath })
            : t('links', { count: merged.length, source: sourcePath, target: targetPath }),
      }
    })

    return {
      nodes: [
        heading('source', 0, source.title),
        heading('target', targetX, target.title),
        // In the order they stand, so Tab reaches the transforms before the whole target tree.
        ...layouts.source.rows.map(treeNode),
        ...transformNodes,
        ...layouts.target.rows.map(treeNode),
      ],
      edges: [...plainEdges, ...transformEdges],
    }
  }, [
    collapsed,
    draggedTo,
    graph,
    heights,
    issues,
    rows,
    source.items,
    source.title,
    t,
    tTransforms,
    target.items,
    target.title,
    text,
  ])

  // A point outside the pane, like the 0,0 of a synthetic event, is on no visible part of the
  // edge; the button then falls back to the edge's middle.
  const pointOf = (event: MouseEvent) => {
    const pane = container.current?.getBoundingClientRect()
    const { clientX: x, clientY: y } = event

    return pane && x >= pane.left && x <= pane.right && y >= pane.top && y <= pane.bottom
      ? flow.current?.screenToFlowPosition({ x, y })
      : undefined
  }

  const onInit = useCallback((instance: ReactFlowInstance<CanvasNode, LinkFlowEdge>) => {
    flow.current = instance

    const width = container.current?.clientWidth ?? canvasWidth

    const zoom = Math.min(
      1,
      Math.max(minInitialZoom, (width - panelGutter - viewportPadding) / canvasWidth),
    )

    void instance.setViewport({
      x: Math.max(panelGutter, (width - canvasWidth * zoom) / 2),
      y: viewportPadding,
      zoom,
    })
  }, [])

  const focusRow = useCallback((row: RowRef | null) => {
    afterRender(() => {
      if (row && container.current) {
        findRowButton(container.current, row)?.focus()
      }
    })
  }, [])

  const transformButton = useCallback(
    (ref: PortRef) => (container.current ? findTransformButton(container.current, ref) : null),
    [],
  )

  const itemOf = useCallback(
    (row: RowRef) => findItem(row.side === 'source' ? source.items : target.items, row.path),
    [source.items, target.items],
  )

  const labelOf = useCallback((row: RowRef) => itemOf(row)?.label ?? row.path, [itemOf])

  const link = useCallback(
    (from: LinkStart, to: LinkEnd) => {
      const { setProblem, cancelLink, announce } = store.getState()
      const connected = connect(graph, rows, from, to)

      setProblem(null)

      if (connected.ok) {
        cancelLink()
        save(connected.change)

        return true
      }

      const failed = text.failedLink(connected, from, to, labelOf)

      if (failed?.problem) {
        setProblem(failed.text)
      } else if (failed) {
        announce(failed.text)
      }

      return false
    },
    [graph, labelOf, rows, save, store, text],
  )

  const removeRowLink = useCallback(
    (removed: RowLink) => {
      store.getState().setProblem(null)
      save(
        removed.kind === 'link'
          ? { kind: 'removeLink', link: removed.link }
          : { kind: 'removeTransformLink', link: removed.link },
      )
    },
    [save, store],
  )

  const start = useCallback(
    (from: LinkStart) => {
      const { startLink, select, announce } = store.getState()

      startLink(from)

      if (from.kind === 'source') {
        select({ side: 'source', path: from.path })
      }

      announce(tLinks('started', { source: text.start(from) }))
    },
    [store, tLinks, text],
  )

  const cancel = useCallback(() => {
    const { linkFrom, cancelLink, announce } = store.getState()

    if (linkFrom) {
      cancelLink()
      announce(tLinks('cancelled', { source: text.start(linkFrom) }))
    }
  }, [store, tLinks, text])

  // A removed transform takes its buttons along, so focus goes to the next one or the palette.
  const removeTransformById = useCallback(
    (transformId: string) => {
      const change = removeTransform(graph, transformId)

      if (!change) {
        return
      }

      const state = store.getState()

      state.setProblem(null)

      if (state.linkFrom?.kind === 'transform' && state.linkFrom.transformId === transformId) {
        state.cancelLink()
      }

      if (state.selectedTransform === transformId) {
        state.clearSelection()
      }

      const index = graph.transforms.findIndex(({ id }) => id === transformId)
      const rest = graph.transforms.filter(({ id }) => id !== transformId)
      const next = rest[Math.min(index, rest.length - 1)]

      save(change)
      whenRendered(
        () => transformButton({ kind: 'header', transformId }) === null,
        () => {
          const button = next
            ? transformButton({ kind: 'header', transformId: next.id })
            : root.current?.querySelector<HTMLElement>('[data-place]')

          button?.focus()
        },
      )
    },
    [graph, save, store, transformButton],
  )

  const place = useCallback(
    (kind: TransformKind) => {
      const pane = container.current?.getBoundingClientRect()

      // New transforms go where the user is looking, below the top of the visible canvas.
      const top =
        pane && flow.current
          ? flow.current.screenToFlowPosition({ x: pane.left, y: pane.top + viewportPadding }).y -
            headingHeight
          : 0

      const taken = graph.transforms.map((transform): Rect => ({
        ...(draggedTo(transform.id) ?? transform.position),
        height: heights.get(transform.id) ?? estimatedHeight(transform),
      }))

      const transformId = crypto.randomUUID()
      const placed = newTransform(kind, transformId, { x: 0, y: 0 })
      const position = freeSlot(taken, top, estimatedHeight(placed))

      store.getState().setProblem(null)
      save({ kind: 'addTransform', transform: { ...placed, position } })
      store.getState().selectTransform(transformId)
      whenRendered(
        () => shown(transformButton({ kind: 'header', transformId })),
        () => transformButton({ kind: 'header', transformId })?.focus(),
      )
    },
    [draggedTo, graph.transforms, heights, save, store, transformButton],
  )

  const outputAction = useCallback(
    (from: LinkStart) => {
      if (sameStart(store.getState().linkFrom, from)) {
        cancel()
      } else {
        start(from)
      }
    },
    [cancel, start, store],
  )

  const inputAction = useCallback(
    (to: LinkEnd) => {
      const { linkFrom, announce } = store.getState()

      if (linkFrom) {
        link(linkFrom, to)
      } else {
        announce(tLinks('startOnSource'))
      }
    },
    [link, store, tLinks],
  )

  const transformActions = useMemo(
    (): TransformActions => ({
      toggle: (transformId) => store.getState().toggleTransform(transformId),
      remove: removeTransformById,
      output: outputAction,
      input: inputAction,
      reportHeight,
    }),
    [inputAction, outputAction, removeTransformById, reportHeight, store],
  )

  const removeButtons = useCallback(
    () => panel.current?.querySelectorAll<HTMLElement>('[data-remove-link]') ?? [],
    [],
  )

  // A panel button that goes away takes the focus with it, so a removal moves it to the next one.
  const focusAfterRemoval = useCallback(
    (index: number, before: number, fallback: () => void) => {
      whenRendered(
        () => removeButtons().length < before,
        () => {
          const left = removeButtons()
          const next = left[Math.min(index, left.length - 1)]

          if (next) {
            next.focus()
          } else {
            fallback()
          }
        },
      )
    },
    [removeButtons],
  )

  const panelActions = useMemo((): PanelActions => {
    const selectedRow = () => store.getState().selected

    return {
      clear: () => {
        const row = selectedRow()
        const transformId = store.getState().selectedTransform

        clearSelection()

        if (transformId) {
          afterRender(() => transformButton({ kind: 'header', transformId })?.focus())
        } else {
          focusRow(row)
        }
      },
      start: (row) => {
        start({ kind: 'source', path: row.path })
        focusRow(row)
      },
      cancel: () => {
        const from = store.getState().linkFrom

        cancel()

        if (from?.kind === 'transform') {
          afterRender(() =>
            transformButton({
              kind: 'output',
              transformId: from.transformId,
              port: from.output,
            })?.focus(),
          )
        } else {
          focusRow(selectedRow() ?? (from && { side: 'source', path: from.path }))
        }
      },
      link: (from, to) => {
        if (link(from, { kind: 'target', path: to.path })) {
          focusRow(to)
        }
      },
      remove: (removed, index) => {
        const row = selectedRow()
        const before = removeButtons().length

        removeRowLink(removed)
        focusAfterRemoval(index, before, () => focusRow(row))
      },
    }
  }, [
    cancel,
    clearSelection,
    focusAfterRemoval,
    focusRow,
    link,
    removeButtons,
    removeRowLink,
    start,
    store,
    transformButton,
  ])

  const detailsActions = useMemo(
    (): TransformDetailsActions => ({
      configure: (transform, config) => {
        store.getState().setProblem(null)
        save(configureTransform(graph, transform, config))
      },
      move: (transform, dx, dy) => {
        const change = moveTransform(transform, {
          x: transform.position.x + dx,
          y: transform.position.y + dy,
        })

        if (!samePosition(change.after.position, transform.position)) {
          save(change)
        }
      },
      remove: (transform) => removeTransformById(transform.id),
      removeLink: (removed: TransformLink, index) => {
        const transformId = store.getState().selectedTransform
        const before = removeButtons().length

        store.getState().setProblem(null)
        save({ kind: 'removeTransformLink', link: removed })
        focusAfterRemoval(index, before, () => {
          if (transformId) {
            transformButton({ kind: 'header', transformId })?.focus()
          }
        })
      },
    }),
    [focusAfterRemoval, graph, removeButtons, removeTransformById, save, store, transformButton],
  )

  const edgeActions = useMemo(
    (): LinkActions => ({
      remove: (removed) => removeRowLink({ kind: 'link', link: removed }),
      removeTransformLink: (removed) => removeRowLink({ kind: 'transformLink', link: removed }),
      show: (edge) => {
        store.getState().select(rowListingLinks(edge))
        afterRender(() => panel.current?.querySelector<HTMLElement>('[data-remove-link]')?.focus())
      },
    }),
    [removeRowLink, store],
  )

  // A taken target or input is no valid drop, so the drag does not mark it as one.
  const isValidConnection = useCallback<IsValidConnection<LinkFlowEdge>>(
    (connection) => {
      const ends = endsOfConnection(connection)

      return ends !== null && connect(graph, rows, ends.from, ends.to).ok
    },
    [graph, rows],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      const ends = endsOfConnection(connection)

      if (ends) {
        link(ends.from, ends.to)
      }
    },
    [link],
  )

  // A drop on a handle that refused the link still says why.
  const onConnectEnd = useCallback<OnConnectEnd>(
    (_, { isValid, fromHandle, toHandle }) => {
      const ends =
        !isValid &&
        fromHandle &&
        toHandle &&
        endsOfConnection({
          source: fromHandle.nodeId,
          sourceHandle: fromHandle.id,
          target: toHandle.nodeId,
          targetHandle: toHandle.id,
        })

      if (ends) {
        link(ends.from, ends.to)
      }
    },
    [link],
  )

  const onConnectStart = useCallback(() => store.getState().setProblem(null), [store])

  // Without onNodesChange React Flow keeps the nodes' measured handles across updates, so a drag
  // is followed here instead.
  const onNodeDrag = useCallback<OnNodeDrag<CanvasNode>>(
    (_, node) => {
      const transformId = transformOfNodeId(node.id)

      if (!transformId) {
        return
      }

      const position = { x: node.position.x - transformX, y: node.position.y - headingHeight }

      setDragged((current) => ({
        transforms: graph.transforms,
        positions: new Map([
          ...(current?.transforms === graph.transforms ? current.positions : []),
          [transformId, position],
        ]),
      }))
    },
    [graph.transforms],
  )

  const onNodeDragStop = useCallback<OnNodeDrag<CanvasNode>>(
    (_, node) => {
      const transformId = transformOfNodeId(node.id)
      const transform = transformId ? transformById(graph, transformId) : undefined

      if (!transform) {
        return
      }

      const change = moveTransform(transform, {
        x: node.position.x - transformX,
        y: node.position.y - headingHeight,
      })

      if (!samePosition(change.after.position, transform.position)) {
        setDragged({
          transforms: graph.transforms,
          positions: new Map([[transform.id, change.after.position]]),
        })
        save(change)
      } else {
        setDragged(null)
      }
    },
    [graph, save],
  )

  const tooltip = useMeaningTooltip()
  const area = useRef<HTMLDivElement>(null)

  // Listened to natively: the area holds the canvas and the panel but is no control of its own.
  useEffect(() => {
    const element = area.current

    const severalLinks = (label: string, count: number) =>
      store.getState().announce(tLinks('severalLinks', { label, count }))

    const onLinkKey = (row: RowRef) => {
      const { linkFrom, announce } = store.getState()

      if (!isLinkableRow(rows, row)) {
        announce(tLinks('notLinkable', { label: labelOf(row) }))
      } else if (row.side === 'source') {
        start({ kind: 'source', path: row.path })
      } else if (linkFrom) {
        link(linkFrom, { kind: 'target', path: row.path })
      } else {
        announce(tLinks('startOnSource'))
      }
    }

    const onDeleteKey = (row: RowRef) => {
      const item = itemOf(row)
      const own = item ? linksOfItem(graph, row.side, item) : []
      const [only] = own

      if (own.length === 1 && only) {
        removeRowLink(only)
      } else if (own.length > 1) {
        severalLinks(labelOf(row), own.length)
      }
    }

    const onOutputDelete = (from: LinkStart) => {
      const own = graph.transformLinks.filter((other) => sameStart(other.from, from))
      const [only] = own

      if (own.length === 1 && only) {
        removeRowLink({ kind: 'transformLink', link: only })
      } else if (own.length > 1) {
        severalLinks(text.start(from), own.length)
      }
    }

    const onPortKey = (port: PortRef, linkKey: boolean) => {
      switch (port.kind) {
        case 'header':
          if (!linkKey) {
            removeTransformById(port.transformId)
          }

          return
        case 'input': {
          const linked = linkIntoInput(graph, port.transformId, port.port)

          if (linkKey) {
            inputAction({ kind: 'transform', transformId: port.transformId, input: port.port })
          } else if (linked) {
            removeRowLink({ kind: 'transformLink', link: linked })
          }

          return
        }

        case 'output': {
          const from: LinkStart = {
            kind: 'transform',
            transformId: port.transformId,
            output: port.port,
          }

          if (linkKey) {
            outputAction(from)
          } else {
            onOutputDelete(from)
          }
        }
      }
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        // The first Escape closes an open tooltip (WCAG 1.4.13) or takes back what was typed in a
        // settings field, the next a pending link, and only the one after that clears the
        // selection.
        if (tooltip.handle.isOpen || event.defaultPrevented) {
          return
        }

        const state = store.getState()
        // The panel's content goes with the selection or the pending link, and its focus with it.
        const inPanel = event.target instanceof Node && panel.current?.contains(event.target)

        if (state.linkFrom) {
          if (inPanel) {
            panelActions.cancel()
          } else {
            cancel()
          }
        } else if (state.selected || state.selectedTransform) {
          if (inPanel) {
            panelActions.clear()
          } else {
            clearSelection()
          }
        }

        return
      }

      const linkKey = event.key === 'l' || event.key === 'L'
      const deleteKey = event.key === 'Delete' || event.key === 'Backspace'

      if ((!linkKey && !deleteKey) || event.altKey || event.ctrlKey || event.metaKey) {
        return
      }

      const row = rowOfButton(event.target)
      const port = row ? null : portOfButton(event.target)

      if (row) {
        event.preventDefault()

        if (linkKey) {
          onLinkKey(row)
        } else {
          onDeleteKey(row)
        }
      } else if (port) {
        event.preventDefault()
        onPortKey(port, linkKey)
      }
    }

    element?.addEventListener('keydown', onKeyDown)

    return () => element?.removeEventListener('keydown', onKeyDown)
  }, [
    cancel,
    clearSelection,
    graph,
    inputAction,
    itemOf,
    labelOf,
    link,
    outputAction,
    panelActions,
    removeRowLink,
    removeTransformById,
    rows,
    start,
    store,
    tLinks,
    text,
    tooltip,
  ])

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col gap-3">
      <TransformPalette onPlace={place} />
      <div ref={area} className="flex min-h-0 flex-1 flex-col gap-3">
        <div
          ref={container}
          className="mapping-canvas relative min-h-80 flex-1 overflow-hidden rounded-lg border">
          <div className="absolute inset-0">
            <LinkActionsContext value={edgeActions}>
              <TransformActionsContext value={transformActions}>
                <LinkableRowsContext value={rows}>
                  <ReactFlow<CanvasNode, LinkFlowEdge>
                    ariaLabelConfig={{
                      'controls.ariaLabel': t('controls.panel'),
                      'controls.zoomIn.ariaLabel': t('controls.zoomIn'),
                      'controls.zoomOut.ariaLabel': t('controls.zoomOut'),
                      'controls.fitView.ariaLabel': t('controls.fitView'),
                    }}
                    attributionPosition="bottom-left"
                    deleteKeyCode={null}
                    edges={edges}
                    edgesFocusable={false}
                    edgeTypes={edgeTypes}
                    elementsSelectable={false}
                    isValidConnection={isValidConnection}
                    maxZoom={1.5}
                    minZoom={0.2}
                    nodes={nodes}
                    nodesConnectable
                    nodesDraggable={false}
                    nodesFocusable={false}
                    nodeTypes={nodeTypes}
                    panOnScroll
                    zoomOnDoubleClick={false}
                    aria-label={label}
                    onConnect={onConnect}
                    onConnectEnd={onConnectEnd}
                    onConnectStart={onConnectStart}
                    // A click shows the remove button too, for pointers that cannot hover.
                    onEdgeClick={(event, edge) => hoverEdge(edge.id, pointOf(event))}
                    onEdgeMouseEnter={(event, edge) => hoverEdge(edge.id, pointOf(event))}
                    onEdgeMouseLeave={(_, edge) => leaveEdge(edge.id)}
                    onInit={onInit}
                    onNodeDrag={onNodeDrag}
                    onNodeDragStop={onNodeDragStop}
                    onPaneClick={clearSelection}>
                    <Background gap={16} variant={BackgroundVariant.Dots} />
                    <Controls position="top-left" showInteractive={false} />
                  </ReactFlow>
                </LinkableRowsContext>
              </TransformActionsContext>
            </LinkActionsContext>
          </div>
        </div>
        <MeaningTooltip />
        <LinkHints text={text} />
        {/* Below the canvas, not beside it, so the trees keep the full width; the band gives up its
            height before the canvas goes below its minimum. */}
        <div
          className={cn(
            'grid gap-3',
            beside && 'grid-cols-2',
            bandOpen ? 'min-h-44 shrink basis-[22rem]' : 'shrink-0',
          )}>
          <DetailsPanel
            actions={panelActions}
            bodyId={detailsBodyId}
            graph={graph}
            issues={issues}
            itemOf={itemOf}
            open={bandOpen}
            ref={panel}
            rows={rows}
            sourceFields={sourceFields}
            text={text}
            transformActions={detailsActions}
          />
          {beside?.({ open: bandOpen, onToggle: toggleBand, controls: detailsBodyId })}
        </div>
      </div>
    </div>
  )
}
