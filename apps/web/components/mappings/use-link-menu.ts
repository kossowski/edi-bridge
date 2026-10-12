'use client'

import { type RefObject, useCallback, useEffect, useMemo } from 'react'

import type { XYPosition } from '@xyflow/react'

import {
  insidePane,
  linkElement,
  linkIdOf,
  type LinkFlowEdge,
  pointInView,
} from '@/components/mappings/link-edge'
import { useCanvasStore, useCanvasStoreApi } from '@/components/mappings/mapping-canvas-store'
import { rowOfNodeId, transformOfNodeId } from '@/components/mappings/mapping-tree'
import { clamp } from '@/lib/clamp'

import type { GraphText } from '@/components/mappings/graph-text'
import type { LinkMenuEnd, LinkMenuTarget } from '@/components/mappings/link-menu'

function opensMenu(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return false
  }

  return (
    event.key === 'Enter' ||
    event.key === ' ' ||
    event.key === 'ContextMenu' ||
    (event.key === 'F10' && event.shiftKey)
  )
}

function keyPoint(link: Element, pane: DOMRect): XYPosition {
  const box = link.getBoundingClientRect()

  return (
    pointInView(link, pane) ?? {
      x: clamp(box.x + box.width / 2, pane.left, pane.right),
      y: clamp(box.y + box.height / 2, pane.top, pane.bottom),
    }
  )
}

export function useLinkMenu(
  containerRef: RefObject<HTMLElement | null>,
  edges: ReadonlyArray<LinkFlowEdge>,
  text: GraphText,
) {
  const store = useCanvasStoreApi()
  const menuEdgeId = useCanvasStore((state) => state.linkMenu?.edgeId)

  // A pointer opens the menu where it is; a key, or a point outside the pane like the 0,0 of a
  // synthetic event, on the part of the link in view.
  const openLinkMenu = useCallback(
    (edgeId: string, pointer?: XYPosition) => {
      const link = linkElement(containerRef.current, edgeId)
      const pane = containerRef.current?.getBoundingClientRect()

      if (!link || !pane) {
        return
      }

      store.getState().openLinkMenu({
        edgeId,
        point: pointer && insidePane(pointer, pane) ? pointer : keyPoint(link, pane),
        linkFocused: link === link.ownerDocument.activeElement,
      })
    },
    [containerRef, store],
  )

  useEffect(() => {
    const element = containerRef.current

    const onKeyDown = (event: KeyboardEvent) => {
      const edgeId = linkIdOf(event.target)

      if (edgeId !== null && opensMenu(event)) {
        event.preventDefault()
        openLinkMenu(edgeId)
      }
    }

    element?.addEventListener('keydown', onKeyDown)

    return () => element?.removeEventListener('keydown', onKeyDown)
  }, [containerRef, openLinkMenu])

  const target = useMemo((): LinkMenuTarget | null => {
    const edge = edges.find(({ id }) => id === menuEdgeId)

    if (!edge?.data) {
      return null
    }

    const endOf = (id: string): LinkMenuEnd[] => {
      const row = rowOfNodeId(id)
      const transformId = transformOfNodeId(id)

      if (row) {
        return [{ kind: 'row', row }]
      }

      return transformId ? [{ kind: 'transform', transformId, name: text.name(transformId) }] : []
    }

    return {
      data: edge.data,
      ends: [...endOf(edge.source), ...endOf(edge.target)],
      element: () => linkElement(containerRef.current, edge.id),
    }
  }, [containerRef, edges, menuEdgeId, text])

  return { openLinkMenu, target }
}
