'use client'

import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { type TransformKind, transformKinds } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'

export function TransformPalette({ onPlace }: { onPlace: (kind: TransformKind) => void }) {
  const t = useTranslations('Mapping.transforms')
  const heading = useId()
  const note = useId()

  return (
    <section
      aria-describedby={note}
      aria-labelledby={heading}
      className="flex shrink-0 flex-wrap items-center gap-1.5">
      <h2 id={heading} className="mr-1.5 text-sm font-semibold">
        {t('palette.heading')}
      </h2>
      {/* Its buttons flow on from the heading's line, which saves the canvas a row. */}
      <ul className="contents">
        {transformKinds.map((kind) => (
          <li key={kind}>
            <Button
              size="sm"
              variant="outline"
              aria-label={t('palette.add', { kind: t(`kinds.${kind}`) })}
              data-place={kind}
              onClick={() => onPlace(kind)}>
              <HugeiconsIcon
                icon={PlusSignIcon}
                strokeWidth={2}
                aria-hidden
                data-icon="inline-start"
              />
              {t(`kinds.${kind}`)}
            </Button>
          </li>
        ))}
      </ul>
      {/* Besides reading out, the line keeps rows panned partly above the canvas, which axe counts
          though clipped, off the buttons. */}
      <p id={note} className="text-muted-foreground basis-full text-xs">
        {t('palette.note')}
      </p>
    </section>
  )
}
