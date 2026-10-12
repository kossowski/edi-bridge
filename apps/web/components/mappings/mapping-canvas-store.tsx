'use client'

import {
  createContext,
  createRef,
  type ReactNode,
  type RefObject,
  useContext,
  useId,
  useMemo,
  useState,
} from 'react'
import { createStore, type StoreApi, useStore } from 'zustand'

import type { XYPosition } from '@xyflow/react'

import { aiMarks, AiMarksContext } from '@/components/mappings/ai-marks'
import { sameStart, startsAtPart } from '@/components/mappings/mapping-graph'
import { createTooltipHandle } from '@edi-bridge/ui/components/tooltip'

import type { LinkableRows, RowRef } from '@/components/mappings/mapping-links'
import type { Side, TreeRow } from '@/components/mappings/mapping-tree'
import type { AiReview, LinkStart } from '@edi-bridge/contracts'

// Opened on the focused link, the menu takes the focus back to it when it closes without an action.
export type LinkMenuAnchor = { edgeId: string; point: XYPosition; linkFocused: boolean }

export type CanvasState = {
  collapsed: Readonly<Record<Side, ReadonlySet<string>>>
  selected: RowRef | null
  selectedTransform: string | null
  linkFrom: LinkStart | null
  tooltipRowId: string | null
  hoveredEdge: string | null
  // Kept while the menu closes, so it fades out where it was.
  linkMenu: LinkMenuAnchor | null
  linkMenuOpen: boolean
  announcement: string
  problem: string | null
  // Opened from the toolbar; a selected Transform shows its settings there too. A selected row or
  // a pending link does not, so the panel never covers the targets a link is being drawn to.
  detailsOpen: boolean
  openDetails: () => void
  closeDetails: () => void
  toggleCollapsed: (row: RowRef) => void
  expand: (side: Side, paths: ReadonlyArray<string>) => void
  toggleSelected: (row: RowRef) => void
  select: (row: RowRef) => void
  toggleTransform: (id: string) => void
  selectTransform: (id: string) => void
  clearSelection: () => void
  startLink: (start: LinkStart) => void
  cancelLink: () => void
  setTooltipRowId: (id: string | null) => void
  hoverEdge: (id: string) => void
  leaveEdge: (id: string) => void
  openLinkMenu: (menu: LinkMenuAnchor) => void
  closeLinkMenu: () => void
  announce: (text: string) => void
  setProblem: (problem: string | null) => void
}

export function detailsShown(state: CanvasState) {
  return state.detailsOpen || state.selectedTransform !== null
}

export function isSameRow(a: RowRef | null, b: RowRef) {
  return a !== null && a.side === b.side && a.path === b.path
}

export function isStartRow(start: LinkStart | null, row: RowRef) {
  return row.side === 'source' && sameStart(start, { kind: 'source', path: row.path })
}

function toRowRef({ side, path }: RowRef): RowRef {
  return { side, path }
}

export function createCanvasStore() {
  return createStore<CanvasState>()((set) => ({
    collapsed: { source: new Set(), target: new Set() },
    selected: null,
    selectedTransform: null,
    linkFrom: null,
    tooltipRowId: null,
    hoveredEdge: null,
    linkMenu: null,
    linkMenuOpen: false,
    announcement: '',
    problem: null,
    detailsOpen: false,
    openDetails: () => set({ detailsOpen: true }),
    closeDetails: () => set({ detailsOpen: false, selectedTransform: null }),
    toggleCollapsed: ({ side, path }) =>
      set(({ collapsed }) => {
        const next = new Set(collapsed[side])

        if (!next.delete(path)) {
          next.add(path)
        }

        return { collapsed: { ...collapsed, [side]: next } }
      }),
    expand: (side, paths) =>
      set(({ collapsed }) => {
        const next = new Set(collapsed[side])

        paths.forEach((path) => next.delete(path))

        return { collapsed: { ...collapsed, [side]: next } }
      }),
    toggleSelected: (row) =>
      set(({ selected }) => ({
        selected: isSameRow(selected, row) ? null : toRowRef(row),
        selectedTransform: null,
      })),
    select: (row) => set({ selected: toRowRef(row), selectedTransform: null }),
    toggleTransform: (id) =>
      set(({ selectedTransform }) => ({
        selectedTransform: selectedTransform === id ? null : id,
        selected: null,
      })),
    selectTransform: (id) => set({ selectedTransform: id, selected: null }),
    clearSelection: () => set({ selected: null, selectedTransform: null }),
    startLink: (linkFrom) => set({ linkFrom, problem: null }),
    cancelLink: () => set({ linkFrom: null }),
    setTooltipRowId: (tooltipRowId) => set({ tooltipRowId }),
    hoverEdge: (id) => set({ hoveredEdge: id }),
    leaveEdge: (id) =>
      set(({ hoveredEdge }) => ({ hoveredEdge: hoveredEdge === id ? null : hoveredEdge })),
    openLinkMenu: (linkMenu) => set({ linkMenu, linkMenuOpen: true }),
    closeLinkMenu: () => set({ linkMenuOpen: false }),
    // A live region repeats nothing it already shows, so a repeated text gets a trailing space.
    announce: (text) =>
      set(({ announcement }) => ({
        announcement: announcement === text ? `${text}\u00a0` : text,
      })),
    setProblem: (problem) => set({ problem }),
  }))
}

export type CanvasRefs = {
  canvas: RefObject<HTMLDivElement | null>
  detailsBody: RefObject<HTMLDivElement | null>
  detailsTrigger: RefObject<HTMLButtonElement | null>
}

type CanvasContext = {
  store: StoreApi<CanvasState>
  refs: CanvasRefs
  tooltip: { handle: ReturnType<typeof createTooltipHandle<TreeRow>>; id: string }
  hints: { linkTarget: string; linkStart: string }
  viewOnly: boolean
}

const Context = createContext<CanvasContext | null>(null)

// One store per mounted canvas, so two canvases (or two stories) never share a selection.
export function MappingCanvasProvider({
  viewOnly = false,
  aiReview = null,
  children,
}: {
  viewOnly?: boolean
  aiReview?: AiReview | null
  children: ReactNode
}) {
  const id = useId()

  const [shared] = useState(() => ({
    store: createCanvasStore(),
    refs: {
      canvas: createRef<HTMLDivElement>(),
      detailsBody: createRef<HTMLDivElement>(),
      detailsTrigger: createRef<HTMLButtonElement>(),
    },
    tooltip: { handle: createTooltipHandle<TreeRow>(), id: `${id}meaning` },
    hints: { linkTarget: `${id}link-target`, linkStart: `${id}link-start` },
  }))

  const value = useMemo<CanvasContext>(() => ({ ...shared, viewOnly }), [shared, viewOnly])
  const marks = useMemo(() => aiMarks(aiReview), [aiReview])

  return (
    <Context.Provider value={value}>
      <AiMarksContext value={marks}>{children}</AiMarksContext>
    </Context.Provider>
  )
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

export function useCanvasRefs() {
  return useCanvasContext().refs
}

export function useCanvasViewOnly() {
  return useCanvasContext().viewOnly
}

export function useMeaningTooltip() {
  return useCanvasContext().tooltip
}

const noRows: LinkableRows = {
  leaves: { source: new Set(), target: new Set() },
  parts: { source: new Set(), target: new Set() },
}

export const LinkableRowsContext = createContext<LinkableRows>(noRows)

// A pending link from a repeating part or a loop's items output goes to a part, not a field.
export function usePendingPartLink() {
  const rows = useContext(LinkableRowsContext)

  return useCanvasStore((state) => startsAtPart(rows, state.linkFrom))
}

export function useLinkHints() {
  return useCanvasContext().hints
}
