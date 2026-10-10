'use client'

import { Alert02Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Handle, type Node, type NodeProps, Position, useConnection } from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { createContext, memo, useCallback, useContext, useId } from 'react'

import { useCanvasStore, useLinkHints } from '@/components/mappings/mapping-canvas-store'
import { sameStart, transformWidth } from '@/components/mappings/mapping-graph'
import { usePanIntoView } from '@/components/mappings/tree-node'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { LinkEnd, LinkStart } from '@edi-bridge/contracts'

export type PortView = {
  port: string
  label: string
  // Who the input is linked from, or where the output goes; read out with the port.
  status: string
  linked: boolean
}

export type TransformNodeData = {
  transformId: string
  name: string
  summary: string
  inputs: PortView[]
  outputs: PortView[]
  issues: string[]
}

export type TransformFlowNode = Node<TransformNodeData, 'transform'>

export type TransformActions = {
  toggle: (transformId: string) => void
  remove: (transformId: string) => void
  output: (start: LinkStart) => void
  input: (end: LinkEnd) => void
  reportHeight: (transformId: string, height: number) => void
}

export const TransformActionsContext = createContext<TransformActions | null>(null)

function useTransformActions() {
  const actions = useContext(TransformActionsContext)

  if (!actions) {
    throw new Error('TransformNode needs a TransformActionsContext')
  }

  return actions
}

const transformIdAttribute = 'data-transform-id'

const portAttribute = 'data-port'

export type PortRef =
  | { kind: 'header'; transformId: string }
  | { kind: 'input'; transformId: string; port: string }
  | { kind: 'output'; transformId: string; port: string }

export function portOfButton(element: EventTarget | null): PortRef | null {
  if (!(element instanceof HTMLElement)) {
    return null
  }

  const transformId = element.getAttribute(transformIdAttribute)
  const port = element.getAttribute(portAttribute)

  if (!transformId) {
    return null
  }

  if (!port) {
    return { kind: 'header', transformId }
  }

  const [kind, name = ''] = port.split(':')

  return kind === 'in' || kind === 'out'
    ? { kind: kind === 'in' ? 'input' : 'output', transformId, port: name }
    : null
}

export function findTransformButton(container: ParentNode, ref: PortRef) {
  const port =
    ref.kind === 'header'
      ? `:not([${portAttribute}])`
      : `[${portAttribute}="${ref.kind === 'input' ? 'in' : 'out'}:${CSS.escape(ref.port)}"]`

  return container.querySelector<HTMLElement>(
    `[${transformIdAttribute}="${CSS.escape(ref.transformId)}"]${port}`,
  )
}

export const inputHandle = (port: string) => `in:${port}`

export const outputHandle = (port: string) => `out:${port}`

export function portOfHandle(handle: string | null | undefined, prefix: 'in' | 'out') {
  return handle?.startsWith(`${prefix}:`) ? handle.slice(prefix.length + 1) : null
}

const portButton =
  'nodrag nopan hover:bg-muted focus-visible:ring-ring/50 flex h-7.5 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-sm text-left outline-none focus-visible:ring-3'

function InputPort({
  transformId,
  name,
  view,
}: {
  transformId: string
  name: string
  view: PortView
}) {
  const t = useTranslations('Mapping.transforms.node')
  const actions = useTransformActions()
  const hints = useLinkHints()
  const status = useId()
  const end: LinkEnd = { kind: 'transform', transformId, input: view.port }

  const target = useCanvasStore(
    (state) =>
      state.linkFrom !== null &&
      !view.linked &&
      !(state.linkFrom.kind === 'transform' && state.linkFrom.transformId === transformId),
  )

  const unavailable = useConnection((connection) => connection.inProgress && view.linked)

  return (
    <div className="relative flex items-center pr-1 pl-3.5">
      <Handle
        id={inputHandle(view.port)}
        isConnectableStart={false}
        position={Position.Left}
        type="target"
        className={cn(
          'link-handle',
          target && 'link-handle-marked',
          unavailable && 'link-handle-unavailable',
        )}
      />
      <button
        type="button"
        aria-describedby={[status, target && hints.linkTarget].filter(Boolean).join(' ')}
        aria-label={t('inputLabel', { port: view.label, transform: name })}
        className={cn(portButton, 'pl-1', target && 'outline-primary outline-1 outline-dashed')}
        data-link-target={target || undefined}
        data-port={inputHandle(view.port)}
        data-transform-id={transformId}
        onClick={() => actions.input(end)}>
        <span className="truncate">{view.label}</span>
        {!view.linked && (
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            aria-hidden
            className="size-3.5 shrink-0 text-amber-700 dark:text-amber-300"
          />
        )}
      </button>
      <span id={status} hidden>
        {view.status}
      </span>
    </div>
  )
}

function OutputPort({
  transformId,
  name,
  view,
}: {
  transformId: string
  name: string
  view: PortView
}) {
  const t = useTranslations('Mapping.transforms.node')
  const actions = useTransformActions()
  const hints = useLinkHints()
  const status = useId()
  const start: LinkStart = { kind: 'transform', transformId, output: view.port }
  const pending = useCanvasStore((state) => sameStart(state.linkFrom, start))

  return (
    <div className="relative flex items-center pr-3.5 pl-1">
      <button
        type="button"
        aria-describedby={[status, pending && hints.linkStart].filter(Boolean).join(' ')}
        aria-label={t('outputLabel', { port: view.label, transform: name })}
        aria-pressed={pending}
        className={cn(portButton, 'justify-end pr-1', pending && 'bg-primary/10')}
        data-port={outputHandle(view.port)}
        data-transform-id={transformId}
        onClick={() => actions.output(start)}>
        <span className="truncate">{view.label}</span>
      </button>
      <span id={status} hidden>
        {view.status}
      </span>
      <Handle
        id={outputHandle(view.port)}
        isConnectableEnd={false}
        position={Position.Right}
        type="source"
        className={cn('link-handle', pending && 'link-handle-marked')}
      />
    </div>
  )
}

function TransformNodeView({ data }: NodeProps<TransformFlowNode>) {
  const t = useTranslations('Mapping.transforms.node')
  const actions = useTransformActions()
  const onFocus = usePanIntoView()
  const issuesId = useId()
  const selected = useCanvasStore((state) => state.selectedTransform === data.transformId)
  const invalid = data.issues.length > 0
  const { reportHeight } = actions
  const { transformId } = data

  const measure = useCallback(
    (element: HTMLElement | null) => {
      if (!element) {
        return
      }

      const observer = new ResizeObserver(() => reportHeight(transformId, element.offsetHeight))

      observer.observe(element)

      return () => observer.disconnect()
    },
    [reportHeight, transformId],
  )

  return (
    <div
      ref={measure}
      role="group"
      aria-label={t('label', { name: data.name })}
      className={cn(
        'bg-card text-foreground flex flex-col gap-1 rounded-md border-2 py-1 text-xs shadow-sm',
        invalid ? 'border-dashed border-amber-700 dark:border-amber-300' : 'border-border',
        selected && 'outline-primary outline-2 outline-offset-2 outline-solid',
      )}
      style={{ width: transformWidth }}
      data-invalid={invalid || undefined}
      data-selected={selected || undefined}
      onFocus={onFocus}>
      <div className="flex items-center gap-1 px-1.5">
        <button
          type="button"
          aria-describedby={invalid ? issuesId : undefined}
          aria-pressed={selected}
          className="nodrag nopan hover:bg-muted focus-visible:ring-ring/50 flex h-7.5 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm px-1 text-left font-semibold outline-none focus-visible:ring-3"
          data-transform-id={data.transformId}
          onClick={() => actions.toggle(data.transformId)}>
          {invalid && (
            <HugeiconsIcon
              icon={Alert02Icon}
              strokeWidth={2}
              aria-hidden
              className="size-4 shrink-0 text-amber-700 dark:text-amber-300"
            />
          )}
          <span className="truncate">{data.name}</span>
        </button>
        <button
          type="button"
          aria-label={t('remove', { name: data.name })}
          className="nodrag nopan hover:bg-muted focus-visible:ring-ring/50 text-muted-foreground hover:text-foreground inline-flex size-7.5 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-3"
          onClick={() => actions.remove(data.transformId)}>
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden className="size-3.5" />
        </button>
      </div>
      {/* Not a control, so a drag that starts here moves the node. */}
      <p title={data.summary} className="text-muted-foreground truncate px-2.5 font-mono">
        {data.summary}
      </p>
      <div className="grid grid-cols-2 gap-x-1">
        <div className="flex min-w-0 flex-col">
          {data.inputs.length === 0 ? (
            <span className="text-muted-foreground px-2.5 py-1.5">{t('noInputs')}</span>
          ) : (
            data.inputs.map((view) => (
              <InputPort
                key={view.port}
                name={data.name}
                transformId={data.transformId}
                view={view}
              />
            ))
          )}
        </div>
        <div className="flex min-w-0 flex-col">
          {data.outputs.map((view) => (
            <OutputPort
              key={view.port}
              name={data.name}
              transformId={data.transformId}
              view={view}
            />
          ))}
        </div>
      </div>
      {invalid && (
        <div id={issuesId} className="flex flex-col gap-0.5 border-t px-2.5 pt-1">
          <p className="font-medium">{t('problems', { count: data.issues.length })}</p>
          <ul className="flex flex-col gap-0.5">
            {data.issues.map((issue, index) => (
              <li key={`${index}:${issue}`} className="flex gap-1">
                <span aria-hidden>–</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{issue}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export const TransformNode = memo(TransformNodeView)
