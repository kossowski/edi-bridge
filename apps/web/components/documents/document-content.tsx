'use client'

import { Alert02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import {
  type ContentColumn,
  type ContentLine,
  contentLines,
  isMissing,
  type MissingPiece,
  missingPieceOf,
  shownColumns,
} from '@/components/documents/content-lines'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@edi-bridge/ui/components/empty'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@edi-bridge/ui/components/table'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { RunDetail } from '@edi-bridge/contracts'

function ContentCell({
  line,
  column,
  piece,
}: {
  line: ContentLine
  column: ContentColumn
  piece: MissingPiece | null
}) {
  const t = useTranslations('Document.content')
  const value = line[column]
  const missing = isMissing(line, column, piece)
  const numeric = column === 'quantity' || column === 'amount'

  return (
    <TableCell
      className={cn(
        numeric && 'text-right tabular-nums',
        column === 'gtin' && 'font-mono text-xs',
        missing && 'bg-destructive/10 text-destructive-text font-medium',
      )}>
      {missing ? (
        <span className="inline-flex items-center gap-1 font-sans">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden className="size-3.5" />
          {value === null ? t('missing') : `${value} (${t('noTranslation')})`}
        </span>
      ) : (
        value
      )}
    </TableCell>
  )
}

function ContentEmpty({ run }: { run: RunDetail }) {
  const t = useTranslations('Document.content.empty')

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>{t('title')}</EmptyTitle>
        <EmptyDescription>
          {run.message ? t('noLines') : run.status === 'failed' ? t('failed') : t('notYet')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function DocumentContent({ run }: { run: RunDetail }) {
  const t = useTranslations('Document.content')
  const lines = useMemo(() => (run.message ? contentLines(run.message) : []), [run.message])
  const piece = missingPieceOf(run.problem?.fixTarget ?? null)

  if (lines.length === 0) {
    return <ContentEmpty run={run} />
  }

  const columns = shownColumns(lines)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">
        {t('description')} {t('lineCount', { count: lines.length })}
      </p>
      <div
        role="region"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a tab stop to scroll many lines
        tabIndex={0}
        aria-label={t('label')}
        className="focus-visible:ring-ring/50 max-h-[32rem] overflow-auto rounded-lg border outline-none focus-visible:ring-3">
        <table className="w-full text-sm">
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow>
              <TableHead className="text-right">{t('column.line')}</TableHead>
              {columns.map((column) => (
                <TableHead
                  key={column}
                  className={cn((column === 'quantity' || column === 'amount') && 'text-right')}>
                  {t(`column.${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, index) => (
              <TableRow key={index}>
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {line.line}
                </TableCell>
                {columns.map((column) => (
                  <ContentCell key={column} column={column} line={line} piece={piece} />
                ))}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
    </div>
  )
}
