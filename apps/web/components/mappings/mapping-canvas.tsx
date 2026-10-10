'use client'

import '@xyflow/react/dist/style.css'
import './mapping-canvas.css'

import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type IsValidConnection,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { type Ref, useCallback, useEffect, useId, useMemo, useRef } from 'react'

import {
  LinkActionsContext,
  type LinkActions,
  LinkEdge,
  type LinkFlowEdge,
} from '@/components/mappings/link-edge'
import {
  isSameRow,
  type RowRef,
  useCanvasStore,
  useCanvasStoreApi,
  useLinkHints,
  useMeaningTooltip,
} from '@/components/mappings/mapping-canvas-store'
import {
  addLink,
  canLink,
  isLinkableRow,
  leafPaths,
  type Leaves,
  type LinkChange,
  linksOfItem,
  removeLink,
} from '@/components/mappings/mapping-links'
import {
  canvasLinks,
  columnGap,
  columnWidth,
  findItem,
  headingHeight,
  layoutTree,
  nodeId,
  rowOfNodeId,
  type Side,
  type TreeItem,
} from '@/components/mappings/mapping-tree'
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

// The zoom controls and the attribution sit in this left strip, so the trees start right of it.
const panelGutter = 88

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

type PanelActions = {
  clear: () => void
  start: (row: RowRef) => void
  cancel: () => void
  link: (from: RowRef, to: RowRef) => void
  remove: (link: MappingLink, index: number) => void
}

function PendingLink({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations('Mapping.links')
  const linkFrom = useCanvasStore((state) => state.linkFrom)

  if (!linkFrom) {
    return null
  }

  return (
    <div className="border-primary/40 bg-primary/5 flex flex-col items-start gap-2 rounded-md border px-3 py-2 text-sm">
      <p className="[overflow-wrap:anywhere]">{t('pending', { source: linkFrom.path })}</p>
      <Button size="sm" variant="outline" onClick={onCancel}>
        {t('cancel')}
      </Button>
    </div>
  )
}

function RowLinks({
  row,
  item,
  links,
  leaves,
  actions,
}: {
  row: RowRef
  item: TreeItem
  links: ReadonlyArray<MappingLink>
  leaves: Leaves
  actions: PanelActions
}) {
  const t = useTranslations('Mapping.links')
  const heading = useId()
  const linkFrom = useCanvasStore((state) => state.linkFrom)
  const own = linksOfItem(links, row.side, item)
  const leaf = isLinkableRow(leaves, row)

  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2">
      <h3 id={heading} className="text-xs font-medium tracking-wide uppercase">
        {t('heading')}
      </h3>
      {leaf && row.side === 'source' && !isSameRow(linkFrom, row) && (
        <Button size="sm" className="w-fit" onClick={() => actions.start(row)}>
          {t('linkFromHere')}
        </Button>
      )}
      {leaf && row.side === 'target' && linkFrom && (
        <Button size="sm" className="w-fit" onClick={() => actions.link(linkFrom, row)}>
          {t('linkToHere')}
        </Button>
      )}
      {own.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {own.map((link, index) => (
            <li
              key={`${link.sourcePath}->${link.targetPath}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <span className="min-w-0 font-mono [overflow-wrap:anywhere]">
                {t('item', { source: link.sourcePath, target: link.targetPath })}
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-label={t('removeLabel', {
                  source: link.sourcePath,
                  target: link.targetPath,
                })}
                data-remove-link
                onClick={() => actions.remove(link, index)}>
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function DetailsPanel({
  source,
  target,
  links,
  leaves,
  actions,
  ref,
}: {
  source: CanvasSide
  target: CanvasSide
  links: ReadonlyArray<MappingLink>
  leaves: Leaves
  actions: PanelActions
  ref: Ref<HTMLElement>
}) {
  const t = useTranslations('Mapping')
  const heading = useId()
  const selected = useCanvasStore((state) => state.selected)
  const items = selected?.side === 'target' ? target.items : source.items
  const item = selected && findItem(items, selected.path)

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

// Rendered beside the page title, outside the canvas, so it reads the store only.
export function LinkSaveStatus({ saving }: { saving: boolean }) {
  const t = useTranslations('Mapping.links')
  const lastSave = useCanvasStore((state) => state.lastSave)
  const problem = useCanvasStore((state) => state.problem)
  const announcement = useCanvasStore((state) => state.announcement)

  const status = saving
    ? t('saving')
    : lastSave === 'saved'
      ? t('saved')
      : lastSave === 'failed'
        ? t('saveFailed')
        : null

  return (
    <>
      {status && <span className="text-muted-foreground text-sm">{status}</span>}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <p role="alert" className="basis-full text-sm text-red-800 empty:hidden dark:text-red-300">
        {problem}
      </p>
    </>
  )
}

function LinkHints() {
  const t = useTranslations('Mapping.links')
  const hints = useLinkHints()
  const linkFrom = useCanvasStore((state) => state.linkFrom)

  return (
    <>
      <span id={hints.linkTarget} hidden>
        {linkFrom && t('targetHint', { source: linkFrom.path })}
      </span>
      <span id={hints.linkStart} hidden>
        {linkFrom && t('startHint')}
      </span>
    </>
  )
}

// Focus moves once the change has rendered, when the button it goes to exists.
function afterRender(focus: () => void) {
  requestAnimationFrame(focus)
}

// The cached Draft updates after the mutation starts, a few frames after the click.
function once(done: () => boolean, then: () => void, frames = 60) {
  requestAnimationFrame(() => (done() || frames === 0 ? then() : once(done, then, frames - 1)))
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

  const onInit = useCallback((instance: ReactFlowInstance<CanvasNode, LinkFlowEdge>) => {
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

  const labelOf = useCallback(
    (row: RowRef) =>
      findItem(row.side === 'source' ? source.items : target.items, row.path)?.label ?? row.path,
    [source.items, target.items],
  )

  const link = useCallback(
    (from: RowRef, to: RowRef) => {
      const { setProblem, cancelLink, announce } = store.getState()
      const added = addLink(links, leaves, from, to)

      if (added.ok) {
        setProblem(null)
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
        once(
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
      show: ({ sourcePath, targetPath, links: merged }) => {
        const collapsedSource = merged.some((one) => one.sourcePath !== sourcePath)

        store
          .getState()
          .select(
            collapsedSource
              ? { side: 'source', path: sourcePath }
              : { side: 'target', path: targetPath },
          )
        afterRender(() => panel.current?.querySelector<HTMLElement>('[data-remove-link]')?.focus())
      },
    }),
    [remove, store],
  )

  const isValidConnection = useCallback<IsValidConnection<LinkFlowEdge>>(
    ({ source: from, target: to }) => {
      const fromRow = rowOfNodeId(from)
      const toRow = rowOfNodeId(to)

      return fromRow !== null && toRow !== null && canLink(leaves, fromRow, toRow)
    },
    [leaves],
  )

  const onConnect = useCallback(
    ({ source: from, target: to }: Connection) => {
      const fromRow = rowOfNodeId(from)
      const toRow = rowOfNodeId(to)

      if (fromRow && toRow) {
        link(fromRow, toRow)
      }
    },
    [link],
  )

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
      const item = findItem(row.side === 'source' ? source.items : target.items, row.path)
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
    labelOf,
    leaves,
    link,
    links,
    remove,
    source.items,
    start,
    store,
    tLinks,
    target.items,
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
              // A click shows the remove button too, for pointers that cannot hover.
              onEdgeClick={(_, edge) => hoverEdge(edge.id)}
              onEdgeMouseEnter={(_, edge) => hoverEdge(edge.id)}
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
        leaves={leaves}
        links={links}
        ref={panel}
        source={source}
        target={target}
      />
    </div>
  )
}
