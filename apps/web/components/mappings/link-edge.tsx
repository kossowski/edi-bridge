'use client'

import { BaseEdge, type Edge, type EdgeProps, getBezierPath, type XYPosition } from '@xyflow/react'
import { memo } from 'react'

import { useCanvasStore } from '@/components/mappings/mapping-canvas-store'

import type { RowLink } from '@/components/mappings/mapping-links'
import type { CanvasLink } from '@/components/mappings/mapping-tree'
import type { LinkStart, TransformLink } from '@edi-bridge/contracts'

export type PlainEdgeData = Omit<CanvasLink, 'id'>

export type LinkEdgeData = (
  | ({ kind: 'link' } & PlainEdgeData)
  | { kind: 'transformLink'; link: TransformLink; source: string; target: string }
) & { aiProposed: boolean }

export type LinkFlowEdge = Edge<LinkEdgeData, 'link'>

// Links into a collapsed part are drawn as one, which stands for several and removes none.
export function singleLink(data: LinkEdgeData): RowLink | null {
  if (data.kind === 'transformLink') {
    return { kind: 'transformLink', link: data.link }
  }

  const [only, ...more] = data.links

  return only && more.length === 0 ? { kind: 'link', link: only } : null
}

// A link drawn from a collapsed part starts at that part, not at the hidden field inside it.
export function startOfLink(data: LinkEdgeData): LinkStart {
  return data.kind === 'link' ? { kind: 'source', path: data.sourcePath } : data.link.from
}

export function linkElement(container: HTMLElement | null, edgeId: string) {
  return (
    container?.querySelector<SVGGElement>(`.react-flow__edge[data-id="${CSS.escape(edgeId)}"]`) ??
    null
  )
}

export function linkIdOf(target: EventTarget | null) {
  return target instanceof Element && target.matches('.react-flow__edge')
    ? target.getAttribute('data-id')
    : null
}

const pointsAlongLink = 64

export function insidePane(point: XYPosition, pane: DOMRect) {
  return (
    point.x >= pane.left && point.x <= pane.right && point.y >= pane.top && point.y <= pane.bottom
  )
}

// The middle of the link's part inside the pane, on the screen; null when none of it is in view.
export function pointInView(link: Element, pane: DOMRect): XYPosition | null {
  const path = link.querySelector<SVGPathElement>('.react-flow__edge-path')
  const matrix = path?.getScreenCTM()

  if (!path || !matrix) {
    return null
  }

  const length = path.getTotalLength()

  const inView = Array.from({ length: pointsAlongLink + 1 }, (_, step) => {
    const { x, y } = path.getPointAtLength((length * step) / pointsAlongLink)
    const { x: screenX, y: screenY } = new DOMPoint(x, y).matrixTransform(matrix)

    return { x: screenX, y: screenY }
  }).filter((point) => insidePane(point, pane))

  return inView[Math.floor(inView.length / 2)] ?? null
}

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
  const highlighted = useCanvasStore(
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
    <>
      <path d={path} className="link-focus-ring" />
      <path d={path} className="link-focus-gap" />
      <BaseEdge
        interactionWidth={interactionWidth}
        path={path}
        style={{
          ...style,
          ...(data?.aiProposed && { stroke: 'var(--ai-proposed)', strokeDasharray: '6 3' }),
          ...(highlighted && { strokeWidth: 2.5 }),
          ...(highlighted && !data?.aiProposed && { stroke: 'var(--foreground)' }),
        }}
      />
    </>
  )
}

export const LinkEdge = memo(LinkEdgeView)
