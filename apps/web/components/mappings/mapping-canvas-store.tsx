'use client'

import { createContext, type ReactNode, useContext, useId, useState } from 'react'
import { createStore, type StoreApi, useStore } from 'zustand'

import { createTooltipHandle } from '@edi-bridge/ui/components/tooltip'

import type { Side, TreeRow } from '@/components/mappings/mapping-tree'

export type RowRef = { side: Side; path: string }

export type CanvasState = {
  collapsed: Readonly<Record<Side, ReadonlySet<string>>>
  selected: RowRef | null
  // The node id of the row whose meaning the tooltip shows, so that row can point at it.
  hinted: string | null
  toggleCollapsed: (row: RowRef) => void
  select: (row: RowRef) => void
  clearSelection: () => void
  setHinted: (id: string | null) => void
}

export function isRow(row: RowRef | null, side: Side, path: string) {
  return row !== null && row.side === side && row.path === path
}

export function createCanvasStore() {
  return createStore<CanvasState>()((set) => ({
    collapsed: { source: new Set(), target: new Set() },
    selected: null,
    hinted: null,
    toggleCollapsed: ({ side, path }) =>
      set(({ collapsed }) => {
        const next = new Set(collapsed[side])

        if (!next.delete(path)) {
          next.add(path)
        }

        return { collapsed: { ...collapsed, [side]: next } }
      }),
    select: (row) =>
      set(({ selected }) => ({
        selected: isRow(selected, row.side, row.path) ? null : { side: row.side, path: row.path },
      })),
    clearSelection: () => set({ selected: null }),
    setHinted: (hinted) => set({ hinted }),
  }))
}

type CanvasContext = {
  store: StoreApi<CanvasState>
  tooltip: { handle: ReturnType<typeof createTooltipHandle<TreeRow>>; id: string }
}

const Context = createContext<CanvasContext | null>(null)

// One store per mounted canvas, so two canvases (or two stories) never share a selection.
export function CanvasStoreProvider({ children }: { children: ReactNode }) {
  const id = useId()

  const [value] = useState<CanvasContext>(() => ({
    store: createCanvasStore(),
    tooltip: { handle: createTooltipHandle<TreeRow>(), id: `${id}meaning` },
  }))

  return <Context.Provider value={value}>{children}</Context.Provider>
}

function useCanvasContext() {
  const context = useContext(Context)

  if (!context) {
    throw new Error('useCanvasStore needs a CanvasStoreProvider')
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
