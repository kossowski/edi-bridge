'use client'

import { BaseEdge, type Edge, type EdgeProps, getBezierPath } from '@xyflow/react'
import { memo } from 'react'

import { useCanvasStore } from '@/components/mappings/mapping-canvas-store'

import type { CanvasLink } from '@/components/mappings/mapping-tree'
import type { TransformLink } from '@edi-bridge/contracts'

export type PlainEdgeData = Omit<CanvasLink, 'id'>

export type LinkEdgeData = (
  | ({ kind: 'link' } & PlainEdgeData)
  | { kind: 'transformLink'; link: TransformLink; source: string; target: string }
) & { aiProposed: boolean }

export type LinkFlowEdge = Edge<LinkEdgeData, 'link'>

function LinkEdgeView({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  interactionWidth = 20,
}: EdgeProps<LinkFlowEdge>) {
  const marked = useCanvasStore(
    (state) => state.hoveredEdge === id || (state.linkMenuOpen && state.linkMenu?.edgeId === id),
  )

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <BaseEdge
      interactionWidth={interactionWidth}
      path={path}
      style={{
        ...style,
        ...(data?.aiProposed && { stroke: 'var(--ai-proposed)', strokeDasharray: '6 3' }),
        ...(marked && { strokeWidth: 2.5 }),
        ...(marked && !data?.aiProposed && { stroke: 'var(--foreground)' }),
      }}
    />
  )
}

export const LinkEdge = memo(LinkEdgeView)
