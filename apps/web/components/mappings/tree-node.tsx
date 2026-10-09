'use client'

import { ArrowRight01Icon, RepeatIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { memo } from 'react'

import { type Repeat, rowHeight, type TreeRow } from '@/components/mappings/mapping-tree'
import { cn } from '@edi-bridge/ui/lib/utils'

export type TreeNodeData = TreeRow & {
  linked: boolean
  onToggle: (row: TreeRow) => void
}

export type TreeFlowNode = Node<TreeNodeData, 'tree'>

export type HeadingNodeData = { side: string; title: string }

export type HeadingFlowNode = Node<HeadingNodeData, 'heading'>

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
  const container = data.expanded !== null
  const showHandle = data.linkable || (data.expanded === false && data.linked)

  return (
    <div
      className={cn(
        'text-foreground relative h-full w-full rounded-md border text-xs',
        container ? 'bg-card/70' : 'bg-card',
        data.kind === 'segmentGroup' && 'border-foreground/40 border-2',
        data.repeat !== null && 'border-dashed shadow-[3px_3px_0_-1px_var(--border)]',
      )}
      data-kind={data.kind}>
      <div className="flex items-center gap-1.5 px-2" style={{ height: rowHeight - 2 }}>
        {container && <ToggleButton data={data} />}
        <code className={cn('shrink-0 font-mono', container && 'font-semibold')}>{data.label}</code>
        {data.name && <span className="text-muted-foreground min-w-0 truncate">{data.name}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {data.detail && <code className="text-muted-foreground font-mono">{data.detail}</code>}
          {data.repeat !== null && <RepeatBadge repeat={data.repeat} />}
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
