'use client'

import { type RefObject, useEffect, useMemo, useState } from 'react'

import type { ReactFlowInstance } from '@xyflow/react'

import {
  linkElement,
  linkIdOf,
  type LinkFlowEdge,
  pointInView,
} from '@/components/mappings/link-edge'
import { clamp } from '@/lib/clamp'

const steps = new Map([
  ['ArrowDown', 1],
  ['ArrowRight', 1],
  ['ArrowUp', -1],
  ['ArrowLeft', -1],
])

function nextIndex(key: string, index: number, count: number) {
  if (key === 'Home') {
    return 0
  }

  if (key === 'End') {
    return count - 1
  }

  const step = steps.get(key)

  return step === undefined ? null : clamp(index + step, 0, count - 1)
}

// The links are one Tab stop, so Tab reaches the trees past them; the arrow keys move between them.
export function useLinkTabStop(
  containerRef: RefObject<HTMLElement | null>,
  flowRef: RefObject<Pick<ReactFlowInstance, 'setCenter' | 'getZoom'> | null>,
  edges: ReadonlyArray<LinkFlowEdge>,
) {
  const [lastFocused, setLastFocused] = useState<string | null>(null)

  const tabStop = edges.some(({ id }) => id === lastFocused) ? lastFocused : (edges[0]?.id ?? null)

  const withTabStop = useMemo(
    () =>
      edges.map((edge) =>
        edge.id === tabStop
          ? edge
          : { ...edge, domAttributes: { ...edge.domAttributes, tabIndex: -1 } },
      ),
    [edges, tabStop],
  )

  useEffect(() => {
    const element = containerRef.current

    // A link out of view is moved into it, so its focus shows.
    const onFocusIn = (event: FocusEvent) => {
      const edgeId = linkIdOf(event.target)

      if (edgeId === null || !(event.target instanceof Element) || !element) {
        return
      }

      setLastFocused(edgeId)

      const path = event.target.querySelector<SVGPathElement>('.react-flow__edge-path')
      const instance = flowRef.current

      if (!path || !instance || pointInView(event.target, element.getBoundingClientRect())) {
        return
      }

      const middle = path.getPointAtLength(path.getTotalLength() / 2)

      void instance.setCenter(middle.x, middle.y, { zoom: instance.getZoom() })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const edgeId = linkIdOf(event.target)

      if (edgeId === null || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return
      }

      const index = edges.findIndex(({ id }) => id === edgeId)
      const next = nextIndex(event.key, index, edges.length)
      const nextEdge = next === null ? undefined : edges[next]

      if (nextEdge) {
        event.preventDefault()
        linkElement(element, nextEdge.id)?.focus()
      }
    }

    element?.addEventListener('focusin', onFocusIn)
    element?.addEventListener('keydown', onKeyDown)

    return () => {
      element?.removeEventListener('focusin', onFocusIn)
      element?.removeEventListener('keydown', onKeyDown)
    }
  }, [containerRef, edges, flowRef])

  return withTabStop
}
