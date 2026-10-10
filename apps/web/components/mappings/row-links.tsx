'use client'

import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { isSameRow, useCanvasStore, useLinkHints } from '@/components/mappings/mapping-canvas-store'
import {
  isLinkableRow,
  type Leaves,
  linksOfItem,
  type RowRef,
} from '@/components/mappings/mapping-links'
import { Button } from '@edi-bridge/ui/components/button'

import type { TreeItem } from '@/components/mappings/mapping-tree'
import type { MappingLink } from '@edi-bridge/contracts'

export type PanelActions = {
  clear: () => void
  start: (row: RowRef) => void
  cancel: () => void
  link: (from: RowRef, to: RowRef) => void
  remove: (link: MappingLink, index: number) => void
}

export function PendingLink({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations('Mapping.links')
  const linkFrom = useCanvasStore((state) => state.linkFrom)

  if (!linkFrom) {
    return null
  }

  return (
    <div className="border-primary/40 bg-primary/5 flex flex-col items-start gap-2 rounded-md border px-3 py-2 text-sm">
      <p className="[overflow-wrap:anywhere]">{t('pending', { source: linkFrom.path })}</p>
      <Button size="sm" variant="outline" onClick={onCancel}>
        {t('cancel')}
      </Button>
    </div>
  )
}

export function RowLinks({
  row,
  item,
  links,
  leaves,
  actions,
}: {
  row: RowRef
  item: TreeItem
  links: ReadonlyArray<MappingLink>
  leaves: Leaves
  actions: PanelActions
}) {
  const t = useTranslations('Mapping.links')
  const heading = useId()
  const linkFrom = useCanvasStore((state) => state.linkFrom)
  const own = linksOfItem(links, row.side, item)
  const leaf = isLinkableRow(leaves, row)

  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2">
      <h3 id={heading} className="text-xs font-medium tracking-wide uppercase">
        {t('heading')}
      </h3>
      {leaf && row.side === 'source' && !isSameRow(linkFrom, row) && (
        <Button size="sm" className="w-fit" onClick={() => actions.start(row)}>
          {t('linkFromHere')}
        </Button>
      )}
      {leaf && row.side === 'target' && linkFrom && (
        <Button size="sm" className="w-fit" onClick={() => actions.link(linkFrom, row)}>
          {t('linkToHere')}
        </Button>
      )}
      {own.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {own.map((link, index) => (
            <li
              key={`${link.sourcePath}->${link.targetPath}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <span className="min-w-0 font-mono [overflow-wrap:anywhere]">
                {t('item', { source: link.sourcePath, target: link.targetPath })}
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-label={t('removeLabel', {
                  source: link.sourcePath,
                  target: link.targetPath,
                })}
                data-remove-link
                onClick={() => actions.remove(link, index)}>
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function LinkHints() {
  const t = useTranslations('Mapping.links')
  const hints = useLinkHints()
  const linkFrom = useCanvasStore((state) => state.linkFrom)

  return (
    <>
      <span id={hints.linkTarget} hidden>
        {linkFrom && t('targetHint', { source: linkFrom.path })}
      </span>
      <span id={hints.linkStart} hidden>
        {linkFrom && t('startHint')}
      </span>
    </>
  )
}
