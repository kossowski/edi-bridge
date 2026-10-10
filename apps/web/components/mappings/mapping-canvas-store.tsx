'use client'

import { createContext, type ReactNode, useContext, useId, useState } from 'react'
import { createStore, type StoreApi, useStore } from 'zustand'

import type { XYPosition } from '@xyflow/react'

import { createTooltipHandle } from '@edi-bridge/ui/components/tooltip'

import type { RowRef } from '@/components/mappings/mapping-links'
import type { Side, TreeRow } from '@/components/mappings/mapping-tree'

export type CanvasState = {
  collapsed: Readonly<Record<Side, ReadonlySet<string>>>
  selected: RowRef | null
  linkFrom: RowRef | null
  tooltipRowId: string | null
  hoveredEdge: string | null
  // Where the pointer met the hovered edge, in flow coordinates; its middle may be out of view.
  edgeAnchor: XYPosition | null
  announcement: string
  problem: string | null
  toggleCollapsed: (row: RowRef) => void
  toggleSelected: (row: RowRef) => void
  select: (row: RowRef) => void
  clearSelection: () => void
  startLink: (row: RowRef) => void
  cancelLink: () => void
  setTooltipRowId: (id: string | null) => void
  hoverEdge: (id: string, at?: XYPosition) => void
  leaveEdge: (id: string) => void
  announce: (text: string) => void
  setProblem: (problem: string | null) => void
}

export function isSameRow(a: RowRef | null, b: RowRef) {
  return a !== null && a.side === b.side && a.path === b.path
}

function toRowRef({ side, path }: RowRef): RowRef {
  return { side, path }
}

// Moving from an edge to its remove button leaves the edge first; the grace keeps the button.
const edgeLeaveGrace = 300

export function createCanvasStore() {
  let leaveTimer: ReturnType<typeof setTimeout> | undefined

  return createStore<CanvasState>()((set, get) => ({
    collapsed: { source: new Set(), target: new Set() },
    selected: null,
    linkFrom: null,
    tooltipRowId: null,
    hoveredEdge: null,
    edgeAnchor: null,
    announcement: '',
    problem: null,
    toggleCollapsed: ({ side, path }) =>
      set(({ collapsed }) => {
        const next = new Set(collapsed[side])

        if (!next.delete(path)) {
          next.add(path)
        }

        return { collapsed: { ...collapsed, [side]: next } }
      }),
    toggleSelected: (row) =>
      set(({ selected }) => ({
        selected: isSameRow(selected, row) ? null : toRowRef(row),
      })),
    select: (row) => set({ selected: toRowRef(row) }),
    clearSelection: () => set({ selected: null }),
    startLink: (row) => set({ linkFrom: toRowRef(row), problem: null }),
    cancelLink: () => set({ linkFrom: null }),
    setTooltipRowId: (tooltipRowId) => set({ tooltipRowId }),
    hoverEdge: (id, at) => {
      clearTimeout(leaveTimer)
      set(({ hoveredEdge, edgeAnchor }) => ({
        hoveredEdge: id,
        edgeAnchor: at ?? (hoveredEdge === id ? edgeAnchor : null),
      }))
    },
    leaveEdge: (id) => {
      clearTimeout(leaveTimer)
      leaveTimer = setTimeout(() => {
        if (get().hoveredEdge === id) {
          set({ hoveredEdge: null })
        }
      }, edgeLeaveGrace)
    },
    // A live region repeats nothing it already shows, so a repeated text gets a trailing space.
    announce: (text) =>
      set(({ announcement }) => ({
        announcement: announcement === text ? `${text}\u00a0` : text,
      })),
    setProblem: (problem) => set({ problem }),
  }))
}

type CanvasContext = {
  store: StoreApi<CanvasState>
  tooltip: { handle: ReturnType<typeof createTooltipHandle<TreeRow>>; id: string }
  hints: { linkTarget: string; linkStart: string }
}

const Context = createContext<CanvasContext | null>(null)

// One store per mounted canvas, so two canvases (or two stories) never share a selection.
export function MappingCanvasProvider({ children }: { children: ReactNode }) {
  const id = useId()

  const [value] = useState<CanvasContext>(() => ({
    store: createCanvasStore(),
    tooltip: { handle: createTooltipHandle<TreeRow>(), id: `${id}meaning` },
    hints: { linkTarget: `${id}link-target`, linkStart: `${id}link-start` },
  }))

  return <Context.Provider value={value}>{children}</Context.Provider>
}

function useCanvasContext() {
  const context = useContext(Context)

  if (!context) {
    throw new Error('useCanvasStore needs a MappingCanvasProvider')
  }

  return context
}

export function useCanvasStore<Selected>(selector: (state: CanvasState) => Selected) {
  return useStore(useCanvasContext().store, selector)
}

export function useCanvasStoreApi() {
  return useCanvasContext().store
}

export function useMeaningTooltip() {
  return useCanvasContext().tooltip
}

export function useLinkHints() {
  return useCanvasContext().hints
}
