'use client'

import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { createContext, memo, useContext } from 'react'

import { useCanvasStore } from '@/components/mappings/mapping-canvas-store'

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
        <EdgeLabelRenderer>
          <div
            className="pointer-events-auto absolute"
            // Above the edges, which sit on a raised layer so they cross the parts.
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              zIndex: 1000,
            }}>
            <EdgeButton id={id} data={data} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const LinkEdge = memo(LinkEdgeView)
