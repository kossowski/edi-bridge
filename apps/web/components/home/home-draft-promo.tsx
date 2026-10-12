'use client'

import { AiMagicIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import {
  CreateMappingError,
  useCreateMappingWithDraft,
} from '@/components/mappings/create-mapping-with-draft'
import { useCanChange } from '@/hooks/use-session'
import { Button } from '@edi-bridge/ui/components/button'
import { Spinner } from '@edi-bridge/ui/components/spinner'

const fieldHeight = 34

const transformHeight = 44

const boxWidth = 190

const columns = { source: 24, transform: 385, target: 746 }

const fields = [
  { source: 'orderNumber', edi: 'BGM 1004', y: 28 },
  { source: 'customer', edi: 'NAD+BY 3039', y: 88 },
  { source: 'deliveryDate', edi: 'DTM+2 2380', y: 148 },
  { source: 'itemCode', edi: 'LIN 7140', y: 208 },
] as const

const transforms = [
  { key: 'lookUpPartner', y: 62, fieldY: 88 },
  { key: 'changeDateFormat', y: 168, fieldY: 148 },
] as const

const transformed = new Set<number>(transforms.map(({ fieldY }) => fieldY))

const fieldMiddle = (y: number) => y + fieldHeight / 2

const transformMiddle = (y: number) => y + transformHeight / 2

function curve(x1: number, y1: number, x2: number, y2: number) {
  const middle = (x1 + x2) / 2

  return `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`
}

const sourceEnd = columns.source + boxWidth

const transformEnd = columns.transform + boxWidth

const edges = [
  ...fields.flatMap(({ y }) =>
    transformed.has(y) ? [] : [curve(sourceEnd, fieldMiddle(y), columns.target, fieldMiddle(y))],
  ),
  ...transforms.flatMap(({ y, fieldY }) => [
    curve(sourceEnd, fieldMiddle(fieldY), columns.transform, transformMiddle(y)),
    curve(transformEnd, transformMiddle(y), columns.target, fieldMiddle(fieldY)),
  ]),
]

function MiniMapping() {
  const t = useTranslations('Home.promo.sketch')

  return (
    <svg
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 960 270"
      aria-hidden
      className="absolute inset-0 -z-10 size-full opacity-70 blur-[2px]">
      {edges.map((path) => (
        <path key={path} d={path} strokeWidth={2} className="stroke-primary/50 fill-none" />
      ))}
      {fields.map(({ source, y }) => (
        <g key={source}>
          <rect
            height={fieldHeight}
            rx={8}
            width={boxWidth}
            x={columns.source}
            y={y}
            className="fill-card stroke-border"
          />
          <text
            x={columns.source + 14}
            y={fieldMiddle(y) + 5}
            className="fill-foreground text-[14px]">
            {t(source)}
          </text>
        </g>
      ))}
      {transforms.map(({ key, y }) => (
        <g key={key}>
          <rect
            height={transformHeight}
            rx={10}
            strokeDasharray="5 3"
            width={boxWidth}
            x={columns.transform}
            y={y}
            className="fill-background stroke-primary/60"
          />
          <text
            textAnchor="middle"
            x={columns.transform + boxWidth / 2}
            y={transformMiddle(y) + 5}
            className="fill-foreground text-[14px] font-medium">
            {t(key)}
          </text>
        </g>
      ))}
      {fields.map(({ edi, y }) => (
        <g key={edi}>
          <rect
            height={fieldHeight}
            rx={8}
            width={boxWidth}
            x={columns.target}
            y={y}
            className="fill-card stroke-border"
          />
          <text
            x={columns.target + 14}
            y={fieldMiddle(y) + 5}
            className="fill-muted-foreground font-mono text-[13px]">
            {edi}
          </text>
        </g>
      ))}
    </svg>
  )
}

export function HomeDraftPromo() {
  const t = useTranslations('Home.promo')
  const tCreate = useTranslations('Mappings.create')
  const headingId = useId()
  const canChange = useCanChange()
  const create = useCreateMappingWithDraft()

  if (!canChange) {
    return null
  }

  return (
    <section
      aria-labelledby={headingId}
      className="bg-muted/40 relative isolate overflow-hidden rounded-2xl border px-4 py-10 sm:py-14">
      <MiniMapping />
      <div className="bg-background/85 mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border p-6 text-center shadow-lg backdrop-blur-sm">
        <span
          aria-hidden
          className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-lg">
          <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} className="size-5" />
        </span>
        <h2 id={headingId} className="text-xl font-semibold text-balance">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">{t('description')}</p>
        <Button
          size="lg"
          aria-disabled={create.locked || undefined}
          className="mt-1 aria-disabled:cursor-progress aria-disabled:opacity-50"
          onClick={() => create.start({ messageType: 'ORDERS' })}>
          {create.locked ? (
            <Spinner role="presentation" aria-hidden data-icon="inline-start" />
          ) : (
            <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} data-icon="inline-start" />
          )}
          {create.locked ? tCreate('creating') : t('button')}
        </Button>
        <p role="status" className="sr-only">
          {create.locked ? tCreate('creating') : ''}
        </p>
        <CreateMappingError error={create.error} />
      </div>
    </section>
  )
}
