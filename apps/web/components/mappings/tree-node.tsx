'use client'

import { ArrowRight01Icon, RepeatIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Handle,
  type Node,
  type NodeProps,
  Position,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { type FocusEvent, memo, useCallback } from 'react'

import { type Repeat, rowHeight, type TreeRow } from '@/components/mappings/mapping-tree'
import { cn } from '@edi-bridge/ui/lib/utils'

export type TreeNodeData = TreeRow & {
  linked: boolean
  onToggle: (row: TreeRow) => void
}

export type TreeFlowNode = Node<TreeNodeData, 'tree'>

export type HeadingNodeData = { side: string; title: string }

export type HeadingFlowNode = Node<HeadingNodeData, 'heading'>

const focusMargin = 24

function shift(start: number, size: number, extent: number) {
  if (start < focusMargin) {
    return focusMargin - start
  }

  return Math.min(0, extent - focusMargin - start - size)
}

// The canvas cannot be panned by keyboard, so a part that gets focus outside the view is panned in.
function usePanIntoView() {
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
      const dx = shift(focused.left - pane.left, focused.width, pane.width)
      const dy = shift(focused.top - pane.top, focused.height, pane.height)

      if (dx !== 0 || dy !== 0) {
        void setViewport({ x: x + dx, y: y + dy, zoom })
      }
    },
    [setViewport, store],
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

  return (
    <button
      type="button"
      aria-expanded={data.expanded ?? false}
      aria-label={t(data.expanded ? 'collapse' : 'expand', { label: data.label })}
      className="nodrag nopan hover:bg-muted focus-visible:ring-ring/50 pointer-events-auto -ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-3"
      onClick={() => data.onToggle(data)}>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        strokeWidth={2}
        aria-hidden
        className={cn('size-4 transition-transform', data.expanded && 'rotate-90')}
      />
    </button>
  )
}

function TreeNodeView({ data }: NodeProps<TreeFlowNode>) {
  const t = useTranslations('Mapping.canvas')
  const container = !data.linkable
  const showHandle = data.linkable || (data.expanded === false && data.linked)
  const onFocus = usePanIntoView()

  return (
    <div
      className={cn(
        'text-foreground relative h-full w-full rounded-md border text-xs',
        container ? 'bg-card/70' : 'bg-card',
        data.kind === 'segmentGroup' && 'border-foreground/40 border-2',
        data.repeat !== null &&
          'border-muted-foreground border-dashed shadow-[3px_3px_0_-1px_var(--border)]',
      )}
      data-kind={data.kind}
      onFocus={onFocus}>
      <div className="flex items-center gap-1.5 px-2" style={{ height: rowHeight - 2 }}>
        {data.expanded !== null && <ToggleButton data={data} />}
        <code className={cn('shrink-0 font-mono', container && 'font-semibold')}>{data.label}</code>
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
      </div>
      <Handle
        isConnectable={false}
        position={data.side === 'source' ? Position.Right : Position.Left}
        type={data.side === 'source' ? 'source' : 'target'}
        className={cn(!showHandle && 'invisible')}
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
