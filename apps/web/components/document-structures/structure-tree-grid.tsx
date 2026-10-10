'use client'

import { ArrowRight01Icon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { type KeyboardEvent, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  adjustable,
  adjustedSettings,
  type Adjustments,
  ancestorPaths,
  containerPaths,
  initialExpanded,
  type SettingsChange,
  type StructureRow,
  type StructureTree,
  visibleRows,
} from '@/components/document-structures/structure-tree'
import { documentFieldTypes, type DocumentStructureNode, nodeContent } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { NativeSelect, NativeSelectOption } from '@edi-bridge/ui/components/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'
import { cn } from '@edi-bridge/ui/lib/utils'

export type RowMark = 'usedByMappingVersion' | 'linkedByMapping' | 'other'

export type Editing = {
  adjustments: Adjustments
  onAdjust: (node: DocumentStructureNode, change: SettingsChange) => void
}

const indent = 1.25

function moveKey(event: KeyboardEvent, rows: StructureRow[], index: number) {
  const row = rows[index]!

  switch (event.key) {
    case 'ArrowDown':
      return { focus: rows[index + 1]?.node.path }
    case 'ArrowUp':
      return { focus: rows[index - 1]?.node.path }
    case 'Home':
      return { focus: rows[0]?.node.path }
    case 'End':
      return { focus: rows.at(-1)?.node.path }
    case 'ArrowRight':
      if (row.expanded === false) {
        return { toggle: row.node.path }
      }

      return row.expanded && (row.childCount ?? 0) > 0
        ? { focus: rows[index + 1]?.node.path }
        : null
    case 'ArrowLeft':
      if (row.expanded) {
        return { toggle: row.node.path }
      }

      return row.parentPath === null ? null : { focus: row.parentPath }
    default:
      return null
  }
}

function TypeCell({
  row,
  editing,
  tree,
  active,
}: {
  row: StructureRow
  editing: Editing | null
  tree: StructureTree
  active: boolean
}) {
  const t = useTranslations('DocumentStructureTree')
  const { node } = row
  const content = nodeContent(node)
  const own = content.kind === 'field' ? content.type : null
  const type = editing ? adjustedSettings(node, editing.adjustments).type : own

  if (type === null) {
    return <span className="text-muted-foreground">{t('object')}</span>
  }

  if (!editing || !adjustable(tree, node).type) {
    return t(`types.${type}`)
  }

  return (
    <NativeSelect
      size="sm"
      tabIndex={active ? 0 : -1}
      value={type}
      aria-label={t('typeLabel', { path: node.path })}
      onChange={(event) => {
        const next = documentFieldTypes.find((candidate) => candidate === event.target.value)

        if (next) {
          editing.onAdjust(node, { type: next })
        }
      }}>
      {documentFieldTypes.map((candidate) => (
        <NativeSelectOption key={candidate} value={candidate}>
          {t(`types.${candidate}`)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}

function FlagCell({
  checked,
  label,
  editable,
  always = false,
  active,
  onChange,
}: {
  checked: boolean
  label: string
  editable: boolean
  always?: boolean
  active: boolean
  onChange: (checked: boolean) => void
}) {
  const t = useTranslations('DocumentStructureTree')

  if (!editable) {
    return (
      <span className={cn(!checked && 'text-muted-foreground')}>
        {always ? t('always') : checked ? t('yes') : t('no')}
      </span>
    )
  }

  return (
    <input
      checked={checked}
      tabIndex={active ? 0 : -1}
      type="checkbox"
      aria-label={label}
      className="accent-primary focus-visible:ring-ring/50 size-4 rounded-sm outline-none focus-visible:ring-3"
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

function TreeRowView({
  row,
  tree,
  editing,
  active,
  mark,
  onToggle,
  onKeyDown,
  onActivate,
}: {
  row: StructureRow
  tree: StructureTree
  editing: Editing | null
  active: boolean
  mark: RowMark | undefined
  onToggle: (path: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => void
  onActivate: (path: string) => void
}) {
  const t = useTranslations('DocumentStructureTree')
  const { node } = row
  const can = adjustable(tree, node)
  const settings = editing ? adjustedSettings(node, editing.adjustments) : null
  const changed = editing?.adjustments.has(node.path) ?? false
  const required = settings?.required ?? node.required
  const repeating = settings?.repeating ?? node.kind === 'array'
  const rootList = !can.required && !can.repeating

  return (
    <TableRow
      tabIndex={active ? 0 : -1}
      aria-expanded={row.expanded ?? undefined}
      aria-level={row.level}
      aria-posinset={row.position}
      aria-setsize={row.setSize}
      className={cn(
        'focus-visible:ring-ring/50 outline-none focus-visible:ring-3 focus-visible:ring-inset',
        changed && 'bg-muted/60',
        mark && 'bg-red-50 dark:bg-red-950/30',
      )}
      data-path={node.path}
      onFocus={() => onActivate(node.path)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && event.target !== event.currentTarget) {
          event.preventDefault()
          event.currentTarget.focus()

          return
        }

        if (event.target === event.currentTarget) {
          onKeyDown(event)
        }
      }}>
      <TableCell role="gridcell" className="py-1.5 whitespace-normal">
        <div
          className="flex min-w-0 items-center gap-1.5"
          style={{ paddingLeft: `${(row.level - 1) * indent}rem` }}>
          {row.expanded === null ? (
            <span aria-hidden className="size-5 shrink-0" />
          ) : (
            <span
              aria-hidden
              className="hover:bg-muted inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm"
              onClick={() => onToggle(node.path)}>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                className={cn('size-4 transition-transform', row.expanded && 'rotate-90')}
              />
            </span>
          )}
          <code
            title={node.path}
            className={cn(
              'font-mono text-xs break-all',
              row.childCount !== null && 'font-semibold',
            )}>
            {node.name}
          </code>
          {row.childCount === 0 && <span className="text-muted-foreground">{t('empty')}</span>}
          {row.expanded === false && (row.childCount ?? 0) > 0 && (
            <span className="text-muted-foreground text-xs">
              {t('hidden', { count: row.childCount ?? 0 })}
            </span>
          )}
          {changed && (
            <span className="border-border rounded-sm border px-1 text-[11px] font-medium">
              {t('changed')}
            </span>
          )}
          {mark && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-800 dark:text-red-300">
              <HugeiconsIcon
                icon={SquareLock02Icon}
                strokeWidth={2}
                aria-hidden
                className="size-3.5"
              />
              {t(`marks.${mark}`)}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell role="gridcell" className="py-1.5">
        <TypeCell active={active} editing={editing} row={row} tree={tree} />
      </TableCell>
      <TableCell role="gridcell" className="py-1.5">
        <FlagCell
          active={active}
          checked={required}
          editable={editing !== null && can.required}
          label={t('requiredLabel', { path: node.path })}
          onChange={(next) => editing?.onAdjust(node, { required: next })}
        />
      </TableCell>
      <TableCell role="gridcell" className="py-1.5">
        <FlagCell
          active={active}
          always={rootList}
          checked={repeating}
          editable={editing !== null && can.repeating}
          label={t('repeatsLabel', { path: node.path })}
          onChange={(next) => editing?.onAdjust(node, { repeating: next })}
        />
      </TableCell>
    </TableRow>
  )
}

export function StructureTreeGrid({
  tree,
  name,
  editing = null,
  marks,
  reveal = null,
}: {
  tree: StructureTree
  name: string
  editing?: Editing | null
  marks?: ReadonlyMap<string, RowMark>
  reveal?: { path: string; key: number } | null
}) {
  const t = useTranslations('DocumentStructureTree')
  const hintId = useId()
  const container = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(() => initialExpanded(tree.children))
  const [activePath, setActivePath] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ path: string } | null>(null)
  const [revealed, setRevealed] = useState(reveal)
  const rows = useMemo(() => visibleRows(tree.children, expanded), [tree.children, expanded])
  const active = rows.some(({ node }) => node.path === activePath) ? activePath : rows[0]?.node.path

  if (reveal !== revealed) {
    setRevealed(reveal)
    const ancestors = reveal && ancestorPaths(tree.children, reveal.path)

    if (reveal && ancestors) {
      setExpanded(new Set([...expanded, ...ancestors]))
      setActivePath(reveal.path)
      setFocusRequest({ path: reveal.path })
    }
  }

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current)

      if (!next.delete(path)) {
        next.add(path)
      }

      return next
    })

  const focusRow = (path: string) => {
    setActivePath(path)
    setFocusRequest({ path })
  }

  useLayoutEffect(() => {
    if (!focusRequest) {
      return
    }

    const element = container.current?.querySelector<HTMLElement>(
      `tr[data-path="${CSS.escape(focusRequest.path)}"]`,
    )

    element?.focus()
    element?.scrollIntoView({ block: 'nearest' })
  }, [focusRequest])

  return (
    <div ref={container} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={hintId} className="text-muted-foreground max-w-prose text-sm">
          {t('hint')}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded(new Set(containerPaths(tree.children)))}>
            {t('expandAll')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExpanded(new Set())}>
            {t('collapseAll')}
          </Button>
        </div>
      </div>
      <div className="rounded-lg border">
        <Table role="treegrid" aria-describedby={hintId} aria-label={t('label', { name })}>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('columns.name')}</TableHead>
              <TableHead scope="col" className="w-40">
                {t('columns.type')}
              </TableHead>
              <TableHead scope="col" className="w-24">
                {t('columns.required')}
              </TableHead>
              <TableHead scope="col" className="w-28">
                {t('columns.repeats')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TreeRowView
                key={row.node.path}
                active={row.node.path === active}
                editing={editing}
                mark={marks?.get(row.node.path)}
                row={row}
                tree={tree}
                onActivate={setActivePath}
                onKeyDown={(event) => {
                  const move = moveKey(event, rows, index)

                  if (!move) {
                    return
                  }

                  event.preventDefault()

                  if ('toggle' in move) {
                    toggle(move.toggle)
                  } else if (move.focus !== undefined) {
                    focusRow(move.focus)
                  }
                }}
                onToggle={toggle}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
