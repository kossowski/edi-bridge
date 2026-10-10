'use client'

import '@xyflow/react/dist/style.css'
import './mapping-canvas.css'

import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type IsValidConnection,
  type OnConnectEnd,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { type MouseEvent, type Ref, useCallback, useEffect, useId, useMemo, useRef } from 'react'

import {
  LinkActionsContext,
  type LinkActions,
  LinkEdge,
  type LinkFlowEdge,
} from '@/components/mappings/link-edge'
import {
  useCanvasStore,
  useCanvasStoreApi,
  useMeaningTooltip,
} from '@/components/mappings/mapping-canvas-store'
import {
  addLink,
  isLinkableRow,
  leafPaths,
  type Leaves,
  type LinkChange,
  linksOfItem,
  removeLink,
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
} from '@/components/mappings/mapping-tree'
import {
  LinkHints,
  type PanelActions,
  PendingLink,
  RowLinks,
} from '@/components/mappings/row-links'
import { RowMeaning } from '@/components/mappings/row-meaning-view'
import {
  findRowButton,
  HeadingNode,
  type HeadingFlowNode,
  rowOfButton,
  TreeNode,
  type TreeFlowNode,
} from '@/components/mappings/tree-node'
import { Button } from '@edi-bridge/ui/components/button'
import { Tooltip, TooltipContent } from '@edi-bridge/ui/components/tooltip'

import type { MappingLink } from '@edi-bridge/contracts'

type CanvasNode = TreeFlowNode | HeadingFlowNode

const nodeTypes = { tree: TreeNode, heading: HeadingNode }

const edgeTypes = { link: LinkEdge }

const targetX = columnWidth + columnGap

const canvasWidth = targetX + columnWidth

const viewportPadding = 24

// Below this the part labels shrink under a readable size; the user pans to the rest instead.
const minInitialZoom = 0.85

// React Flow announces every node as one to select, move or delete; these nodes are none of that.
const plainNode = { 'aria-roledescription': undefined, 'aria-describedby': undefined }

export type CanvasSide = { title: string; items: ReadonlyArray<TreeItem> }

type MappingCanvasProps = {
  label: string
  links: ReadonlyArray<MappingLink>
  source: CanvasSide
  target: CanvasSide
  onChange: (change: LinkChange) => void
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
  links,
  leaves,
  actions,
  ref,
}: {
  itemOf: (row: RowRef) => TreeItem | undefined
  links: ReadonlyArray<MappingLink>
  leaves: Leaves
  actions: PanelActions
  ref: Ref<HTMLElement>
}) {
  const t = useTranslations('Mapping')
  const heading = useId()
  const selected = useCanvasStore((state) => state.selected)
  const item = selected && itemOf(selected)

  return (
    <section
      ref={ref}
      aria-labelledby={heading}
      className="bg-card flex max-h-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border px-4 py-3 2xl:max-h-none 2xl:w-80 2xl:p-4">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h2 id={heading} className="text-sm font-semibold">
          {t('details.title')}
        </h2>
        {item && (
          <Button size="sm" variant="ghost" onClick={actions.clear}>
            {t('details.clear')}
          </Button>
        )}
      </div>
      <PendingLink onCancel={actions.cancel} />
      <div aria-live="polite" className="flex flex-col gap-1">
        {selected && item ? (
          <>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t(`canvas.${selected.side}`)}
            </p>
            <RowMeaning
              item={item}
              className="flex-row flex-wrap gap-x-8 gap-y-2 text-sm 2xl:flex-col"
            />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t('details.empty')}</p>
        )}
      </div>
      {selected && item && (
        <RowLinks actions={actions} item={item} leaves={leaves} links={links} row={selected} />
      )}
      <p className="text-muted-foreground text-xs">{t('links.shortcut')}</p>
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

function rowsOfConnection(from: string, to: string) {
  const fromRow = rowOfNodeId(from)
  const toRow = rowOfNodeId(to)

  return fromRow && toRow ? { from: fromRow, to: toRow } : null
}

export function MappingCanvas({ label, links, source, target, onChange }: MappingCanvasProps) {
  const t = useTranslations('Mapping.canvas')
  const tLinks = useTranslations('Mapping.links')
  const container = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const store = useCanvasStoreApi()
  const collapsed = useCanvasStore((state) => state.collapsed)
  const clearSelection = useCanvasStore((state) => state.clearSelection)
  const hoverEdge = useCanvasStore((state) => state.hoverEdge)
  const leaveEdge = useCanvasStore((state) => state.leaveEdge)

  const leaves = useMemo(
    () => ({ source: leafPaths(source.items), target: leafPaths(target.items) }),
    [source.items, target.items],
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

    const shown = canvasLinks(links, {
      source: layouts.source.visible,
      target: layouts.target.visible,
    })

    const linked = new Set(
      shown.flatMap((link) => [
        nodeId('source', link.sourcePath),
        nodeId('target', link.targetPath),
      ]),
    )

    const heading = (side: Side, x: number, title: string): HeadingFlowNode => ({
      id: `${side}:heading`,
      type: 'heading',
      position: { x, y: 0 },
      width: columnWidth,
      height: headingHeight - 8,
      data: { side: t(side), title },
      draggable: false,
      selectable: false,
      focusable: false,
      domAttributes: plainNode,
    })

    const treeNodes = [...layouts.source.rows, ...layouts.target.rows].map((row): TreeFlowNode => ({
      id: row.id,
      type: 'tree',
      position: { x: row.x, y: row.y },
      width: row.width,
      height: row.height,
      zIndex: row.depth,
      data: { ...row, linked: linked.has(row.id) },
      draggable: false,
      selectable: false,
      focusable: false,
      domAttributes: plainNode,
    }))

    const flowEdges = shown.map(({ id, sourcePath, targetPath, links: merged }): LinkFlowEdge => {
      const [first] = merged

      return {
        id,
        type: 'link',
        source: nodeId('source', sourcePath),
        target: nodeId('target', targetPath),
        data: { sourcePath, targetPath, links: merged },
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
        ...treeNodes,
      ],
      edges: flowEdges,
    }
  }, [collapsed, links, source.items, source.title, t, target.items, target.title])

  const flow = useRef<ReactFlowInstance<CanvasNode, LinkFlowEdge>>(null)

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

  const itemOf = useCallback(
    (row: RowRef) => findItem(row.side === 'source' ? source.items : target.items, row.path),
    [source.items, target.items],
  )

  const labelOf = useCallback((row: RowRef) => itemOf(row)?.label ?? row.path, [itemOf])

  const link = useCallback(
    (from: RowRef, to: RowRef) => {
      const { setProblem, cancelLink, announce } = store.getState()
      const added = addLink(links, leaves, from, to)

      setProblem(null)

      if (added.ok) {
        cancelLink()
        onChange(added.change)
      } else if (added.reason === 'alreadyLinked') {
        setProblem(tLinks('alreadyLinked', { target: to.path, source: added.existing.sourcePath }))
      } else {
        announce(tLinks('notLinkable', { label: labelOf(to) }))
      }

      return added.ok
    },
    [labelOf, leaves, links, onChange, store, tLinks],
  )

  const remove = useCallback(
    (removed: MappingLink) => {
      store.getState().setProblem(null)
      onChange(removeLink(links, removed))
    },
    [links, onChange, store],
  )

  const start = useCallback(
    (row: RowRef) => {
      const { startLink, select, announce } = store.getState()

      startLink(row)
      select(row)
      announce(tLinks('started', { source: row.path }))
    },
    [store, tLinks],
  )

  const cancel = useCallback(() => {
    const { linkFrom, cancelLink, announce } = store.getState()

    if (linkFrom) {
      cancelLink()
      announce(tLinks('cancelled', { source: linkFrom.path }))
    }
  }, [store, tLinks])

  // A panel button that goes away takes the focus with it, so each action moves it on.
  const panelActions = useMemo((): PanelActions => {
    const selectedRow = () => store.getState().selected

    return {
      clear: () => {
        const row = selectedRow()

        clearSelection()
        focusRow(row)
      },
      start: (row) => {
        start(row)
        focusRow(row)
      },
      cancel: () => {
        const row = store.getState().linkFrom

        cancel()
        focusRow(selectedRow() ?? row)
      },
      link: (from, to) => {
        if (link(from, to)) {
          focusRow(to)
        }
      },
      remove: (removed, index) => {
        const row = selectedRow()

        const buttons = () =>
          panel.current?.querySelectorAll<HTMLElement>('[data-remove-link]') ?? []

        const before = buttons().length

        remove(removed)
        whenRendered(
          () => buttons().length < before,
          () => {
            const left = buttons()
            const next = left[Math.min(index, left.length - 1)]

            if (next) {
              next.focus()
            } else {
              focusRow(row)
            }
          },
        )
      },
    }
  }, [cancel, clearSelection, focusRow, link, remove, start, store])

  const edgeActions = useMemo(
    (): LinkActions => ({
      remove,
      show: (edge) => {
        store.getState().select(rowListingLinks(edge))
        afterRender(() => panel.current?.querySelector<HTMLElement>('[data-remove-link]')?.focus())
      },
    }),
    [remove, store],
  )

  // A linked target is no valid drop, so the drag does not mark it as one.
  const isValidConnection = useCallback<IsValidConnection<LinkFlowEdge>>(
    ({ source: from, target: to }) => {
      const rows = rowsOfConnection(from, to)

      return rows !== null && addLink(links, leaves, rows.from, rows.to).ok
    },
    [leaves, links],
  )

  const onConnect = useCallback(
    ({ source: from, target: to }: Connection) => {
      const rows = rowsOfConnection(from, to)

      if (rows) {
        link(rows.from, rows.to)
      }
    },
    [link],
  )

  // A drop on a handle that refused the link still says why.
  const onConnectEnd = useCallback<OnConnectEnd>(
    (_, { isValid, fromNode, toNode }) => {
      const rows = !isValid && fromNode && toNode && rowsOfConnection(fromNode.id, toNode.id)

      if (rows) {
        link(rows.from, rows.to)
      }
    },
    [link],
  )

  const onConnectStart = useCallback(() => store.getState().setProblem(null), [store])

  const tooltip = useMeaningTooltip()
  const area = useRef<HTMLDivElement>(null)

  // Listened to natively: the area holds the canvas and the panel but is no control of its own.
  useEffect(() => {
    const element = area.current

    const onLinkKey = (row: RowRef) => {
      const { linkFrom, announce } = store.getState()

      if (!isLinkableRow(leaves, row)) {
        announce(tLinks('notLinkable', { label: labelOf(row) }))
      } else if (row.side === 'source') {
        start(row)
      } else if (linkFrom) {
        link(linkFrom, row)
      } else {
        announce(tLinks('startOnSource'))
      }
    }

    const onDeleteKey = (row: RowRef) => {
      const item = itemOf(row)
      const own = item ? linksOfItem(links, row.side, item) : []
      const [only] = own

      if (own.length === 1 && only) {
        remove(only)
      } else if (own.length > 1) {
        store
          .getState()
          .announce(tLinks('severalLinks', { label: labelOf(row), count: own.length }))
      }
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        // The first Escape closes an open tooltip (WCAG 1.4.13), the next a pending link, and
        // only the one after that clears the selection.
        if (tooltip.handle.isOpen) {
          return
        }

        if (store.getState().linkFrom) {
          cancel()
        } else if (store.getState().selected) {
          clearSelection()
        }

        return
      }

      const row = rowOfButton(event.target)

      if (!row || event.altKey || event.ctrlKey || event.metaKey) {
        return
      }

      if (event.key === 'l' || event.key === 'L') {
        event.preventDefault()
        onLinkKey(row)
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        onDeleteKey(row)
      }
    }

    element?.addEventListener('keydown', onKeyDown)

    return () => element?.removeEventListener('keydown', onKeyDown)
  }, [
    cancel,
    clearSelection,
    itemOf,
    labelOf,
    leaves,
    link,
    links,
    remove,
    start,
    store,
    tLinks,
    tooltip,
  ])

  return (
    // Beside the canvas the panel would cost the trees their room below 2xl, so it goes under it.
    <div ref={area} className="flex min-h-[32rem] flex-1 flex-col gap-4 2xl:flex-row">
      <div
        ref={container}
        className="mapping-canvas relative min-h-[32rem] flex-1 overflow-hidden rounded-lg border">
        <div className="absolute inset-0">
          <LinkActionsContext value={edgeActions}>
            <ReactFlow<CanvasNode, LinkFlowEdge>
              ariaLabelConfig={{
                'controls.ariaLabel': t('controls.panel'),
                'controls.zoomIn.ariaLabel': t('controls.zoomIn'),
                'controls.zoomOut.ariaLabel': t('controls.zoomOut'),
                'controls.fitView.ariaLabel': t('controls.fitView'),
              }}
              attributionPosition="bottom-left"
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
              onPaneClick={clearSelection}>
              <Background gap={16} variant={BackgroundVariant.Dots} />
              <Controls position="top-left" showInteractive={false} />
            </ReactFlow>
          </LinkActionsContext>
        </div>
      </div>
      <MeaningTooltip />
      <LinkHints />
      <DetailsPanel
        actions={panelActions}
        itemOf={itemOf}
        leaves={leaves}
        links={links}
        ref={panel}
      />
    </div>
  )
}
