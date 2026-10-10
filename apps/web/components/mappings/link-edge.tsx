'use client'

import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  useStore,
  type XYPosition,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { createContext, memo, useCallback, useContext, useState } from 'react'

import { useCanvasStore } from '@/components/mappings/mapping-canvas-store'
import { panelGutter } from '@/components/mappings/mapping-tree'

import type { CanvasLink } from '@/components/mappings/mapping-tree'
import type { MappingLink } from '@edi-bridge/contracts'

export type LinkEdgeData = Omit<CanvasLink, 'id'>

export type LinkFlowEdge = Edge<LinkEdgeData, 'link'>

export type LinkActions = {
  remove: (link: MappingLink) => void
  // A merged edge stands for several links; they are listed by name before any is removed.
  show: (edge: LinkEdgeData) => void
}

export const LinkActionsContext = createContext<LinkActions | null>(null)

function useLinkActions() {
  const actions = useContext(LinkActionsContext)

  if (!actions) {
    throw new Error('LinkEdge needs a LinkActionsContext')
  }

  return actions
}

function EdgeButton({ id, data }: { id: string; data: LinkEdgeData }) {
  const t = useTranslations('Mapping.links')
  const actions = useLinkActions()
  const hoverEdge = useCanvasStore((state) => state.hoverEdge)
  const leaveEdge = useCanvasStore((state) => state.leaveEdge)
  const [only] = data.links
  const single = data.links.length === 1 && only

  const names = { source: data.sourcePath, target: data.targetPath }

  return (
    <button
      type="button"
      aria-label={
        single
          ? t('removeLabel', { source: only.sourcePath, target: only.targetPath })
          : t('showLinksLabel', { count: data.links.length, ...names })
      }
      className="nodrag nopan bg-card text-foreground hover:bg-muted focus-visible:ring-ring/50 inline-flex h-7.5 min-w-7.5 items-center justify-center gap-1 rounded-full border px-1.5 text-xs font-medium shadow-sm outline-none focus-visible:ring-3"
      onBlur={() => leaveEdge(id)}
      onClick={() => (single ? actions.remove(only) : actions.show(data))}
      onFocus={() => hoverEdge(id)}
      onMouseEnter={() => hoverEdge(id)}
      onMouseLeave={() => leaveEdge(id)}>
      {single ? (
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden className="size-4" />
      ) : (
        <span aria-hidden>{t('showLinks', { count: data.links.length })}</span>
      )}
    </button>
  )
}

// Screen pixels kept between the button and the pane's border.
const paneInset = 8

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function useSize() {
  const [size, setSize] = useState({ width: 0, height: 0 })

  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) {
      return
    }

    const observer = new ResizeObserver(() =>
      setSize({ width: element.offsetWidth, height: element.offsetHeight }),
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return [size, ref] as const
}

// The button sits where the pointer met the edge and stays inside the pane, so a long edge whose
// middle is out of view still shows it.
function EdgeButtonAnchor({
  id,
  data,
  midpoint,
}: {
  id: string
  data: LinkEdgeData
  midpoint: XYPosition
}) {
  const at = useCanvasStore((state) => state.edgeAnchor) ?? midpoint
  const [x, y, zoom] = useStore((state) => state.transform)
  const paneWidth = useStore((state) => state.width)
  const paneHeight = useStore((state) => state.height)
  const [size, measure] = useSize()

  const left = clamp(
    at.x,
    (panelGutter - x) / zoom + size.width / 2,
    (paneWidth - paneInset - x) / zoom - size.width / 2,
  )

  const top = clamp(
    at.y,
    (paneInset - y) / zoom + size.height / 2,
    (paneHeight - paneInset - y) / zoom - size.height / 2,
  )

  return (
    <EdgeLabelRenderer>
      <div
        ref={measure}
        className="pointer-events-auto absolute"
        // Above the edges, which sit on a raised layer so they cross the parts.
        style={{
          transform: `translate(-50%, -50%) translate(${left}px, ${top}px)`,
          zIndex: 1000,
        }}>
        <EdgeButton id={id} data={data} />
      </div>
    </EdgeLabelRenderer>
  )
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
  const hovered = useCanvasStore((state) => state.hoveredEdge === id)

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  return (
    <>
      <BaseEdge
        interactionWidth={interactionWidth}
        path={path}
        style={hovered ? { ...style, stroke: 'var(--foreground)', strokeWidth: 2.5 } : style}
      />
      {hovered && data && (
        <EdgeButtonAnchor id={id} data={data} midpoint={{ x: labelX, y: labelY }} />
      )}
    </>
  )
}

export const LinkEdge = memo(LinkEdgeView)
