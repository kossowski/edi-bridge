'use client'

import { ArrowRight01Icon, RepeatIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Handle,
  type Node,
  type NodeProps,
  Position,
  useConnection,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { type FocusEvent, memo, type ReactNode, useCallback } from 'react'

import {
  isSameRow,
  isStartRow,
  useCanvasStore,
  useLinkHints,
  useMeaningTooltip,
  usePendingPartLink,
} from '@/components/mappings/mapping-canvas-store'
import {
  nodeId,
  type Repeat,
  rowHeight,
  rowOfNodeId,
  type TreeRow,
} from '@/components/mappings/mapping-tree'
import { kindMeanings } from '@/components/mappings/row-meaning'
import { TooltipTrigger } from '@edi-bridge/ui/components/tooltip'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { RowRef } from '@/components/mappings/mapping-links'

// `filled` says a link ends at this very target, not only somewhere inside it.
export type TreeNodeData = TreeRow & { linked: boolean; filled: boolean; wholePart: boolean }

export type TreeFlowNode = Node<TreeNodeData, 'tree'>

export type HeadingNodeData = { side: string; title: string }

export type HeadingFlowNode = Node<HeadingNodeData, 'heading'>

const rowIdAttribute = 'data-row-id'

export function findRowButton(container: ParentNode, row: RowRef) {
  return container.querySelector<HTMLElement>(
    `[${rowIdAttribute}="${CSS.escape(nodeId(row.side, row.path))}"]`,
  )
}

export function rowOfButton(element: EventTarget | null) {
  const id = element instanceof HTMLElement ? element.getAttribute(rowIdAttribute) : null

  return id ? rowOfNodeId(id) : null
}

const focusMargin = 24

function shift(start: number, size: number, extent: number) {
  if (start < focusMargin) {
    return focusMargin - start
  }

  return Math.min(0, extent - focusMargin - start - size)
}

// Shows as much of `outer` as fits, but never at the cost of `inner`.
function shiftAround(outer: [number, number], inner: [number, number], extent: number) {
  const whole = shift(outer[0], outer[1], extent)

  return shift(inner[0] + whole, inner[1], extent) === 0 ? whole : shift(inner[0], inner[1], extent)
}

// The canvas cannot be panned by keyboard, so a part that gets focus outside the view is panned in.
// With `whole`, the element listening is shown along with the focused one, e.g. a whole Transform
// with its problems rather than only its focused button.
export function usePanIntoView({ whole = false }: { whole?: boolean } = {}) {
  const store = useStoreApi()
  const { setViewport } = useReactFlow()

  return useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const { transform, domNode } = store.getState()

      if (!domNode) {
        return
      }

      // The browser has already scrolled the clipped pane to the part, and React Flow undoes that
      // scroll later; undo it first so the part is measured where it ends up.
      for (
        let element: HTMLElement | null = event.target;
        element && domNode.contains(element);
        element = element.parentElement
      ) {
        if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
          element.scrollTo({ top: 0, left: 0, behavior: 'instant' })
        }
      }

      const [x, y, zoom] = transform
      const pane = domNode.getBoundingClientRect()
      const focused = event.target.getBoundingClientRect()
      const shown = (whole ? event.currentTarget : event.target).getBoundingClientRect()

      const dx = shiftAround(
        [shown.left - pane.left, shown.width],
        [focused.left - pane.left, focused.width],
        pane.width,
      )

      const dy = shiftAround(
        [shown.top - pane.top, shown.height],
        [focused.top - pane.top, focused.height],
        pane.height,
      )

      if (dx !== 0 || dy !== 0) {
        void setViewport({ x: x + dx, y: y + dy, zoom })
      }
    },
    [setViewport, store, whole],
  )
}

function RepeatBadge({ repeat }: { repeat: Exclude<Repeat, null> }) {
  const t = useTranslations('Mapping.canvas')
  const unbounded = repeat === 'unbounded'

  return (
    <span className="border-border text-foreground inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium">
      <HugeiconsIcon icon={RepeatIcon} strokeWidth={2} aria-hidden className="size-3" />
      <span aria-hidden>
        {unbounded ? t('repeatsUnbounded') : t('repeatsUpTo', { count: repeat })}
      </span>
      <span className="sr-only">
        {unbounded ? t('repeatsUnboundedLabel') : t('repeatsUpToLabel', { count: repeat })}
      </span>
    </span>
  )
}

function ToggleButton({ data }: { data: TreeNodeData }) {
  const t = useTranslations('Mapping.canvas')
  const toggleCollapsed = useCanvasStore((state) => state.toggleCollapsed)

  return (
    <button
      type="button"
      aria-expanded={data.expanded ?? false}
      aria-label={t(data.expanded ? 'collapse' : 'expand', { label: data.label })}
      className="nodrag nopan hover:bg-muted focus-visible:ring-ring/50 pointer-events-auto -ml-1.5 inline-flex size-7.5 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-3"
      onClick={() => toggleCollapsed(data)}>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        strokeWidth={2}
        aria-hidden
        className={cn('size-4 transition-transform', data.expanded && 'rotate-90')}
      />
    </button>
  )
}

function RowButton({
  data,
  selected,
  hint,
  children,
}: {
  data: TreeNodeData
  selected: boolean
  hint: string | null
  children: ReactNode
}) {
  const tooltip = useMeaningTooltip()
  const toggleSelected = useCanvasStore((state) => state.toggleSelected)
  const described = useCanvasStore((state) => state.tooltipRowId === data.id)
  const describedBy = [described && tooltip.id, hint].filter(Boolean).join(' ')

  const props = {
    type: 'button' as const,
    'aria-pressed': selected,
    'aria-describedby': describedBy || undefined,
    [rowIdAttribute]: data.id,
    className:
      'nodrag focus-visible:ring-ring/50 pointer-events-auto flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-3',
    onClick: () => toggleSelected(data),
  }

  if (!kindMeanings[data.kind].tooltip) {
    return <button {...props}>{children}</button>
  }

  return (
    <TooltipTrigger handle={tooltip.handle} payload={data} {...props}>
      {children}
    </TooltipTrigger>
  )
}

function TreeNodeView({ data }: NodeProps<TreeFlowNode>) {
  const t = useTranslations('Mapping.canvas')
  const container = !data.linkable
  const linkable = data.linkable || data.wholePart
  const showHandle = linkable || (data.expanded === false && data.linked)
  const onFocus = usePanIntoView()
  const selected = useCanvasStore((state) => isSameRow(state.selected, data))
  const hints = useLinkHints()
  const linkStart = useCanvasStore((state) => isStartRow(state.linkFrom, data))
  const pendingPart = usePendingPartLink()

  // Only a free target can take the pending link: a leaf, or a repeating part for a loop's items.
  const linkTarget = useCanvasStore(
    (state) =>
      state.linkFrom !== null &&
      data.side === 'target' &&
      !data.filled &&
      (pendingPart ? data.repeat !== null : data.linkable),
  )

  // While a link is dragged, a filled target refuses it; the drop there still says why.
  const unavailable = useConnection(
    (connection) => connection.inProgress && data.side === 'target' && linkable && data.filled,
  )

  const hint = linkStart ? hints.linkStart : linkTarget ? hints.linkTarget : null

  return (
    <div
      className={cn(
        'text-foreground relative h-full w-full rounded-md border text-xs',
        container ? 'bg-card/70' : 'bg-card',
        data.kind === 'segmentGroup' && 'border-foreground/40 border-2',
        data.repeat !== null &&
          'border-muted-foreground border-dashed shadow-[3px_3px_0_-1px_var(--border)]',
        linkTarget && 'outline-primary bg-primary/5 outline-2 outline-offset-1 outline-dashed',
        linkStart && 'bg-primary/10',
        selected && 'outline-primary outline-2 outline-offset-1 outline-solid',
        unavailable && 'bg-muted',
      )}
      data-kind={data.kind}
      data-link-target={linkTarget || undefined}
      data-link-unavailable={unavailable || undefined}
      data-selected={selected || undefined}
      onFocus={onFocus}>
      <div
        className={cn(
          'flex items-center gap-1.5 px-2',
          // Keeps the row button clear of the link handle that overlaps this edge of the part.
          linkable && (data.side === 'source' ? 'pr-4' : 'pl-4'),
        )}
        style={{ height: rowHeight - 2 }}>
        {data.expanded !== null && <ToggleButton data={data} />}
        <RowButton data={data} hint={hint} selected={selected}>
          <code className={cn('shrink-0 font-mono', container && 'font-semibold')}>
            {data.label}
          </code>
          {data.name && <span className="text-muted-foreground min-w-0 truncate">{data.name}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {data.detail && <code className="text-muted-foreground font-mono">{data.detail}</code>}
            {data.repeat !== null && <RepeatBadge repeat={data.repeat} />}
            {container && data.childCount === 0 && (
              <span className="text-muted-foreground">{t('emptyPart')}</span>
            )}
            {data.expanded === false && (
              <span className="text-muted-foreground">
                {t('hiddenParts', { count: data.childCount })}
              </span>
            )}
          </span>
        </RowButton>
      </div>
      <Handle
        isConnectable={linkable}
        isConnectableEnd={data.side === 'target'}
        isConnectableStart={data.side === 'source'}
        position={data.side === 'source' ? Position.Right : Position.Left}
        type={data.side === 'source' ? 'source' : 'target'}
        className={cn(
          linkable ? 'link-handle' : 'part-handle',
          !showHandle && 'invisible',
          (linkStart || linkTarget) && 'link-handle-marked',
          unavailable && 'link-handle-unavailable',
        )}
        style={{ top: rowHeight / 2 }}
      />
    </div>
  )
}

export const TreeNode = memo(TreeNodeView)

function HeadingNodeView({ data }: NodeProps<HeadingFlowNode>) {
  return (
    <div className="flex h-full flex-col justify-end gap-0.5 pb-2">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {data.side}
      </span>
      <span className="truncate text-sm font-semibold">{data.title}</span>
    </div>
  )
}

export const HeadingNode = memo(HeadingNodeView)
