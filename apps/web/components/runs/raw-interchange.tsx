'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef } from 'react'

import { interchangeLines, type InterchangeLine } from '@/components/runs/interchange-lines'
import { cn } from '@edi-bridge/ui/lib/utils'

import type { ErrorPosition } from '@edi-bridge/contracts'

function LineText({ line }: { line: InterchangeLine }) {
  const t = useTranslations('RunDetail.raw')

  if (line.highlight === null) {
    return line.text
  }

  const [start, end] = line.highlight

  return (
    <>
      {line.text.slice(0, start)}
      <mark
        className="rounded-sm bg-red-600 px-px text-white outline-2 outline-red-600 dark:bg-red-500 dark:text-black dark:outline-red-500"
        data-error-position>
        <span className="sr-only">{t('errorPosition')}: </span>
        {start === end ? (
          <>
            <span aria-hidden className="inline-block w-2" />
            <span className="sr-only">{t('emptyValue')}</span>
          </>
        ) : (
          line.text.slice(start, end)
        )}
      </mark>
      {line.text.slice(end)}
    </>
  )
}

export function RawInterchange({ raw, position }: { raw: string; position: ErrorPosition | null }) {
  const t = useTranslations('RunDetail.raw')
  const { lines, precision } = useMemo(() => interchangeLines(raw, position), [raw, position])
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const scroller = container.current
    const mark = scroller?.querySelector<HTMLElement>('[data-error-line]')

    if (scroller && mark) {
      scroller.scrollTop = mark.offsetTop - scroller.clientHeight / 2
    }
  }, [lines])

  return (
    <div className="flex flex-col gap-2">
      {position !== null && precision === null && (
        <p className="text-sm text-red-800 dark:text-red-300">{t('positionMissing')}</p>
      )}
      <div
        ref={container}
        role="region"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need a tab stop to scroll a long Interchange
        tabIndex={0}
        aria-label={t('label')}
        className="bg-muted/40 focus-visible:ring-ring/50 relative max-h-96 overflow-auto rounded-lg border font-mono text-xs leading-5 outline-none focus-visible:ring-3">
        <ol className="py-2">
          {lines.map((line, index) => (
            <li
              key={index}
              className={cn(
                'flex border-l-4 pr-4',
                line.highlight === null
                  ? 'border-transparent'
                  : 'border-red-600 dark:border-red-400',
              )}
              data-error-line={line.highlight === null ? undefined : true}>
              <span
                aria-hidden
                className="text-muted-foreground w-14 shrink-0 pr-3 text-right tabular-nums select-none">
                {line.number}
              </span>
              <code className="min-w-0 break-all whitespace-pre-wrap">
                <LineText line={line} />
              </code>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
