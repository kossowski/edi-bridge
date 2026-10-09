'use client'

import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import type { ParsedMessage, ParsedSegment } from '@edi-bridge/contracts'

function Value({ value }: { value: string }) {
  const t = useTranslations('RunDetail.tree')

  return value === '' ? (
    <span className="text-muted-foreground italic">{t('empty')}</span>
  ) : (
    <code className="font-mono">{value}</code>
  )
}

function SegmentNode({ segment }: { segment: ParsedSegment }) {
  const t = useTranslations('RunDetail.tree')

  return (
    <li>
      <details className="group">
        <summary className="hover:bg-muted focus-visible:ring-ring/50 flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 outline-none focus-visible:ring-3 [&::-webkit-details-marker]:hidden">
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            aria-hidden
            className="size-4 shrink-0 transition-transform group-open:rotate-90"
          />
          <code className="font-mono font-semibold">{segment.tag}</code>
          {segment.name && <span className="text-muted-foreground">{segment.name}</span>}
        </summary>
        <ol className="border-border ml-4 flex flex-col gap-1 border-l py-1 pl-4">
          {segment.elements.map((components, elementIndex) => (
            <li key={elementIndex}>
              <span className="text-muted-foreground">
                {t('element', { number: elementIndex + 1 })}
              </span>
              {components.length === 1 ? (
                <>
                  {': '}
                  <Value value={components[0]!} />
                </>
              ) : (
                <ol className="ml-4 flex flex-col">
                  {components.map((value, componentIndex) => (
                    <li key={componentIndex}>
                      <span className="text-muted-foreground">
                        {t('component', { number: componentIndex + 1 })}
                      </span>
                      {': '}
                      <Value value={value} />
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      </details>
    </li>
  )
}

export function MessageTree({ message }: { message: ParsedMessage }) {
  const t = useTranslations('RunDetail.tree')

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">
        {t('heading', { reference: message.reference, messageType: message.messageType })}
      </p>
      <ul className="flex flex-col">
        {message.segments.map((segment, index) => (
          <SegmentNode key={index} segment={segment} />
        ))}
      </ul>
    </div>
  )
}
