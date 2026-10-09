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
import { useCallback, useMemo, useRef, useState } from 'react'

import {
  canvasLinks,
  columnGap,
  columnWidth,
  headingHeight,
  layoutTree,
  nodeId,
  type Side,
  type TreeItem,
  type TreeRow,
} from '@/components/mappings/mapping-tree'
import {
  HeadingNode,
  type HeadingFlowNode,
  TreeNode,
  type TreeFlowNode,
} from '@/components/mappings/tree-node'

import type { MappingLink } from '@edi-bridge/contracts'

type CanvasNode = TreeFlowNode | HeadingFlowNode

const nodeTypes = { tree: TreeNode, heading: HeadingNode }

const targetX = columnWidth + columnGap

const canvasWidth = targetX + columnWidth

const viewportPadding = 24

// Below this the part labels shrink under a readable size; the user pans to the rest instead.
const minInitialZoom = 0.85

// React Flow announces every node as one to select, move or delete; these nodes are none of that.
const plainNode = { 'aria-roledescription': undefined, 'aria-describedby': undefined }

export type CanvasSide = { title: string; items: ReadonlyArray<TreeItem> }

type Collapsed = Readonly<Record<Side, ReadonlySet<string>>>

export function MappingCanvas({
  label,
  links,
  source,
  target,
}: {
  label: string
  links: ReadonlyArray<MappingLink>
  source: CanvasSide
  target: CanvasSide
}) {
  const t = useTranslations('Mapping.canvas')
  const container = useRef<HTMLDivElement>(null)

  const [collapsed, setCollapsed] = useState<Collapsed>({
    source: new Set(),
    target: new Set(),
  })

  const onToggle = useCallback((row: TreeRow) => {
    setCollapsed((previous) => {
      const next = new Set(previous[row.side])

      if (!next.delete(row.path)) {
        next.add(row.path)
      }

      return { ...previous, [row.side]: next }
    })
  }, [])

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
      data: { ...row, linked: linked.has(row.id), onToggle },
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
  }, [collapsed, links, onToggle, source.items, source.title, t, target.items, target.title])

  const onInit = useCallback((instance: ReactFlowInstance<CanvasNode>) => {
    const width = container.current?.clientWidth ?? canvasWidth
    const zoom = Math.min(1, Math.max(minInitialZoom, (width - 2 * viewportPadding) / canvasWidth))

    void instance.setViewport({
      x: Math.max(viewportPadding, (width - canvasWidth * zoom) / 2),
      y: viewportPadding,
      zoom,
    })
  }, [])

  return (
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
          onInit={onInit}>
          <Background gap={16} variant={BackgroundVariant.Dots} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
