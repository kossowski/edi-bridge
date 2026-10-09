'use client'

import '@xyflow/react/dist/style.css'
import './mapping-canvas.css'

import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useId, useMemo, useRef } from 'react'

import {
  CanvasStoreProvider,
  useCanvasStore,
  useCanvasStoreApi,
  useMeaningTooltip,
} from '@/components/mappings/mapping-canvas-store'
import {
  canvasLinks,
  columnGap,
  columnWidth,
  findItem,
  headingHeight,
  layoutTree,
  nodeId,
  type Side,
  type TreeItem,
} from '@/components/mappings/mapping-tree'
import { RowMeaning } from '@/components/mappings/row-meaning-view'
import {
  HeadingNode,
  type HeadingFlowNode,
  TreeNode,
  type TreeFlowNode,
} from '@/components/mappings/tree-node'
import { Button } from '@edi-bridge/ui/components/button'
import { Tooltip, TooltipContent } from '@edi-bridge/ui/components/tooltip'

import type { MappingLink } from '@edi-bridge/contracts'

type CanvasNode = TreeFlowNode | HeadingFlowNode

const nodeTypes = { tree: TreeNode, heading: HeadingNode }

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
}

// Mounted only while the tooltip shows a row, so that row's button can point at the tooltip.
function HintedRow({ id }: { id: string }) {
  const setHinted = useCanvasStore((state) => state.setHinted)

  useEffect(() => {
    setHinted(id)

    return () => setHinted(null)
  }, [id, setHinted])

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
            <HintedRow id={payload.id} />
            <RowMeaning codeLimit={5} item={payload} />
          </TooltipContent>
        )
      }
    </Tooltip>
  )
}

function DetailsPanel({
  source,
  target,
  onClear,
}: {
  source: CanvasSide
  target: CanvasSide
  onClear: () => void
}) {
  const t = useTranslations('Mapping')
  const heading = useId()
  const selected = useCanvasStore((state) => state.selected)
  const items = selected?.side === 'target' ? target.items : source.items
  const item = selected && findItem(items, selected.path)

  return (
    <section
      aria-labelledby={heading}
      className="bg-card flex w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border p-4">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h2 id={heading} className="text-sm font-semibold">
          {t('details.title')}
        </h2>
        {item && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            {t('details.clear')}
          </Button>
        )}
      </div>
      <div aria-live="polite" className="flex flex-col gap-1">
        {selected && item ? (
          <>
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t(`canvas.${selected.side}`)}
            </p>
            <RowMeaning item={item} className="text-sm" />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t('details.empty')}</p>
        )}
      </div>
    </section>
  )
}

export function MappingCanvas(props: MappingCanvasProps) {
  return (
    <CanvasStoreProvider>
      <MappingCanvasView {...props} />
    </CanvasStoreProvider>
  )
}

function MappingCanvasView({ label, links, source, target }: MappingCanvasProps) {
  const t = useTranslations('Mapping.canvas')
  const container = useRef<HTMLDivElement>(null)
  const store = useCanvasStoreApi()
  const collapsed = useCanvasStore((state) => state.collapsed)
  const clearSelection = useCanvasStore((state) => state.clearSelection)

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

    const flowEdges = shown.map(({ id, sourcePath, targetPath, links: merged }): Edge => {
      const [first] = merged

      return {
        id,
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

  const onInit = useCallback((instance: ReactFlowInstance<CanvasNode>) => {
    const width = container.current?.clientWidth ?? canvasWidth
    const zoom = Math.min(1, Math.max(minInitialZoom, (width - 2 * viewportPadding) / canvasWidth))

    void instance.setViewport({
      x: Math.max(panelGutter, (width - canvasWidth * zoom) / 2),
      y: viewportPadding,
      zoom,
    })
  }, [])

  // Clearing removes the panel's clear button, so the focus goes back to the row it described.
  const onClear = useCallback(() => {
    const { selected } = store.getState()

    const row =
      selected &&
      container.current?.querySelector<HTMLElement>(
        `[data-row-id="${CSS.escape(nodeId(selected.side, selected.path))}"]`,
      )

    clearSelection()
    row?.focus()
  }, [clearSelection, store])

  const tooltip = useMeaningTooltip()
  const area = useRef<HTMLDivElement>(null)

  // Listened to natively: the area holds the canvas and the panel but is no control of its own.
  useEffect(() => {
    const element = area.current

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // The first Escape closes an open tooltip (WCAG 1.4.13); only the next one clears.
      if (event.key === 'Escape' && store.getState().selected && !tooltip.handle.isOpen) {
        clearSelection()
      }
    }

    element?.addEventListener('keydown', onKeyDown)

    return () => element?.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, store, tooltip])

  return (
    <div ref={area} className="flex min-h-[32rem] flex-1 gap-4">
      <div
        ref={container}
        className="mapping-canvas relative min-h-[32rem] flex-1 overflow-hidden rounded-lg border">
        <div className="absolute inset-0">
          <ReactFlow<CanvasNode>
            ariaLabelConfig={{
              'controls.ariaLabel': t('controls.panel'),
              'controls.zoomIn.ariaLabel': t('controls.zoomIn'),
              'controls.zoomOut.ariaLabel': t('controls.zoomOut'),
              'controls.fitView.ariaLabel': t('controls.fitView'),
            }}
            attributionPosition="bottom-left"
            edges={edges}
            edgesFocusable={false}
            elementsSelectable={false}
            maxZoom={1.5}
            minZoom={0.2}
            nodes={nodes}
            nodesConnectable={false}
            nodesDraggable={false}
            nodesFocusable={false}
            nodeTypes={nodeTypes}
            panOnScroll
            zoomOnDoubleClick={false}
            aria-label={label}
            onInit={onInit}
            onPaneClick={clearSelection}>
            <Background gap={16} variant={BackgroundVariant.Dots} />
            <Controls position="top-left" showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
      <MeaningTooltip />
      <DetailsPanel source={source} target={target} onClear={onClear} />
    </div>
  )
}
