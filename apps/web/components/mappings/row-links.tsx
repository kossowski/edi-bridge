'use client'

import { useTranslations } from 'next-intl'
import { useId } from 'react'

import {
  isStartRow,
  useCanvasStore,
  useLinkHints,
} from '@/components/mappings/mapping-canvas-store'
import {
  isLinkablePart,
  isLinkableRow,
  linksOfItem,
  type RowLink,
  type RowRef,
} from '@/components/mappings/mapping-links'
import { Button } from '@edi-bridge/ui/components/button'

import type { GraphText } from '@/components/mappings/graph-text'
import type { Graph, LinkableRows } from '@/components/mappings/mapping-graph'
import type { TreeItem } from '@/components/mappings/mapping-tree'
import type { LinkStart } from '@edi-bridge/contracts'

export type PanelActions = {
  clear: () => void
  start: (row: RowRef) => void
  cancel: () => void
  link: (from: LinkStart, to: RowRef) => void
  remove: (link: RowLink, index: number) => void
}

export function rowLinkNames(link: RowLink, text: GraphText) {
  return link.kind === 'link'
    ? { source: link.link.sourcePath, target: link.link.targetPath }
    : { source: text.start(link.link.from), target: text.end(link.link.to) }
}

export function PendingLink({ text, onCancel }: { text: GraphText; onCancel: () => void }) {
  const t = useTranslations('Mapping.links')
  const linkFrom = useCanvasStore((state) => state.linkFrom)

  if (!linkFrom) {
    return null
  }

  return (
    <div className="border-primary/40 bg-primary/5 flex flex-col items-start gap-2 rounded-md border px-3 py-2 text-sm">
      <p className="[overflow-wrap:anywhere]">{t('pending', { source: text.start(linkFrom) })}</p>
      <Button size="sm" variant="outline" onClick={onCancel}>
        {t('cancel')}
      </Button>
    </div>
  )
}

export function RowLinks({
  row,
  item,
  graph,
  rows,
  text,
  actions,
}: {
  row: RowRef
  item: TreeItem
  graph: Graph
  rows: LinkableRows
  text: GraphText
  actions: PanelActions
}) {
  const t = useTranslations('Mapping.links')
  const heading = useId()
  const linkFrom = useCanvasStore((state) => state.linkFrom)
  const own = linksOfItem(graph, row.side, item)
  const linkable = isLinkableRow(rows.leaves, row) || isLinkablePart(rows.parts, row)

  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2">
      <h3 id={heading} className="text-xs font-medium tracking-wide uppercase">
        {t('heading')}
      </h3>
      {linkable && row.side === 'source' && !isStartRow(linkFrom, row) && (
        <Button size="sm" className="w-fit" onClick={() => actions.start(row)}>
          {t('linkFromHere')}
        </Button>
      )}
      {linkable && row.side === 'target' && linkFrom && (
        <Button size="sm" className="w-fit" onClick={() => actions.link(linkFrom, row)}>
          {t('linkToHere')}
        </Button>
      )}
      {own.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {own.map((link, index) => {
            const names = rowLinkNames(link, text)

            return (
              <li
                key={`${names.source}->${names.target}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                <span className="min-w-0 font-mono [overflow-wrap:anywhere]">
                  {t('item', names)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={t('removeLabel', names)}
                  data-remove-link
                  onClick={() => actions.remove(link, index)}>
                  {t('remove')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function LinkHints({ text }: { text: GraphText }) {
  const t = useTranslations('Mapping.links')
  const hints = useLinkHints()
  const linkFrom = useCanvasStore((state) => state.linkFrom)

  return (
    <>
      <span id={hints.linkTarget} hidden>
        {linkFrom && t('targetHint', { source: text.start(linkFrom) })}
      </span>
      <span id={hints.linkStart} hidden>
        {linkFrom && t('startHint')}
      </span>
    </>
  )
}
