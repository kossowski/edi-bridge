'use client'

import { AiMagicIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId } from 'react'

import {
  CreateMappingError,
  useCreateMappingWithDraft,
} from '@/components/mappings/create-mapping-with-draft'
import { useCanChange } from '@/hooks/use-session'
import { documentStructuresQuery } from '@/lib/api/queries'
import { onlyDocumentStructureId } from '@/lib/document-structures'
import { newMappingHref } from '@/lib/navigation'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'
import { Spinner } from '@edi-bridge/ui/components/spinner'
import { cn } from '@edi-bridge/ui/lib/utils'

type SketchField = {
  key: 'orderNumber' | 'customer' | 'deliveryDate' | 'itemCode'
  edi: string
  transform?: { key: 'lookUpPartner' | 'changeDateFormat'; shift: number }
}

type Box = {
  id: string
  kind: 'source' | 'transform' | 'target'
  field: SketchField
  x: number
  y: number
  width: number
  height: number
}

type Edge = { id: string; path: string }

type Sketch = { width: number; height: number; boxes: Box[]; edges: Edge[] }

const fields: SketchField[] = [
  { key: 'orderNumber', edi: 'BGM 1004' },
  { key: 'customer', edi: 'NAD+BY 3039', transform: { key: 'lookUpPartner', shift: -21 } },
  { key: 'deliveryDate', edi: 'DTM+2 2380', transform: { key: 'changeDateFormat', shift: 25 } },
  { key: 'itemCode', edi: 'LIN 7140' },
]

function box(
  field: SketchField,
  kind: Box['kind'],
  place: Pick<Box, 'x' | 'y' | 'width' | 'height'>,
): Box {
  return { id: `${field.key}-${kind}`, kind, field, ...place }
}

function sideways(from: Box, to: Box): Edge {
  const x1 = from.x + from.width
  const y1 = from.y + from.height / 2
  const x2 = to.x
  const y2 = to.y + to.height / 2
  const middle = (x1 + x2) / 2

  return {
    id: `${from.id}-${to.id}`,
    path: `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`,
  }
}

function downwards(from: Box, to: Box): Edge {
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height
  const x2 = to.x + to.width / 2
  const y2 = to.y
  const middle = (y1 + y2) / 2

  return {
    id: `${from.id}-${to.id}`,
    path: `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`,
  }
}

function wideSketch(): Sketch {
  const fieldHeight = 34
  const transformHeight = 44
  const width = 190
  const boxes: Box[] = []
  const edges: Edge[] = []

  fields.forEach((field, index) => {
    const y = 28 + index * 60
    const source = box(field, 'source', { x: 24, y, width, height: fieldHeight })
    const target = box(field, 'target', { x: 746, y, width, height: fieldHeight })

    boxes.push(source, target)

    if (!field.transform) {
      edges.push(sideways(source, target))

      return
    }

    const transform = box(field, 'transform', {
      x: 385,
      y: y + (fieldHeight - transformHeight) / 2 + field.transform.shift,
      width,
      height: transformHeight,
    })

    boxes.push(transform)
    edges.push(sideways(source, transform), sideways(transform, target))
  })

  return { width: 960, height: 270, boxes, edges }
}

function narrowSketch(): Sketch {
  const height = 30
  const gap = 8
  const step = 44
  const boxes: Box[] = []
  const edges: Edge[] = []
  let y = 4

  for (const field of fields.filter(({ key }) => key !== 'deliveryDate')) {
    const source = box(field, 'source', { x: 4, y, width: 136, height })

    if (!field.transform) {
      const target = box(field, 'target', { x: 220, y, width: 136, height })

      boxes.push(source, target)
      edges.push(sideways(source, target))
      y += height + gap

      continue
    }

    const transform = box(field, 'transform', { x: 95, y: y + step, width: 170, height })
    const target = box(field, 'target', { x: 220, y: y + 2 * step, width: 136, height })

    boxes.push(source, transform, target)
    edges.push(downwards(source, transform), downwards(transform, target))
    y += 2 * step + height + gap
  }

  return { width: 360, height: y - gap + 4, boxes, edges }
}

const wide = wideSketch()

const narrow = narrowSketch()

function MiniMapping({ sketch, className }: { sketch: Sketch; className: string }) {
  const t = useTranslations('Home.promo.sketch')

  return (
    <svg
      viewBox={`0 0 ${sketch.width} ${sketch.height}`}
      aria-hidden
      className={className}
      data-sketch={sketch === wide ? 'wide' : 'narrow'}>
      {sketch.edges.map(({ id, path }) => (
        <path key={id} d={path} strokeWidth={2} className="stroke-primary/50 fill-none" />
      ))}
      {sketch.boxes.map(({ id, kind, field, x, y, width, height }) => (
        <g key={id}>
          <rect
            height={height}
            rx={kind === 'transform' ? 10 : 8}
            strokeDasharray={kind === 'transform' ? '5 3' : undefined}
            width={width}
            x={x}
            y={y}
            className={
              kind === 'transform' ? 'fill-background stroke-primary/60' : 'fill-card stroke-border'
            }
          />
          {kind === 'source' && (
            <text x={x + 14} y={y + height / 2 + 5} className="fill-foreground text-[14px]">
              {t(field.key)}
            </text>
          )}
          {kind === 'transform' && field.transform && (
            <text
              textAnchor="middle"
              x={x + width / 2}
              y={y + height / 2 + 5}
              className="fill-foreground text-[14px] font-medium">
              {t(field.transform.key)}
            </text>
          )}
          {kind === 'target' && (
            <text
              x={x + 14}
              y={y + height / 2 + 5}
              className="fill-muted-foreground font-mono text-[13px]">
              {field.edi}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

function DraftAction() {
  const t = useTranslations('Home.promo')
  const tCreate = useTranslations('Mappings.create')
  const create = useCreateMappingWithDraft()
  const documentStructures = useQuery(documentStructuresQuery)
  const documentStructureId = onlyDocumentStructureId(documentStructures.data)
  const locked = create.locked || documentStructures.isPending

  if (!documentStructures.isPending && documentStructureId === null) {
    return (
      <Link href={newMappingHref('ORDERS')} className={cn(buttonVariants({ size: 'lg' }), 'mt-1')}>
        <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} data-icon="inline-start" />
        {t('button')}
      </Link>
    )
  }

  return (
    <>
      <Button
        size="lg"
        aria-disabled={locked || undefined}
        className="mt-1 aria-disabled:cursor-progress aria-disabled:opacity-50"
        onClick={() => {
          if (documentStructureId !== null) {
            create.start({ messageType: 'ORDERS', documentStructureId })
          }
        }}>
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
      <CreateMappingError
        error={create.error}
        withDocumentStructure={create.withDocumentStructure}
      />
    </>
  )
}

export function HomeDraftPromo() {
  const t = useTranslations('Home.promo')
  const headingId = useId()
  const canChange = useCanChange()

  if (!canChange) {
    return null
  }

  return (
    <section
      aria-labelledby={headingId}
      className="bg-muted/40 @container relative isolate overflow-hidden rounded-2xl border p-4">
      <MiniMapping
        sketch={narrow}
        className="mx-auto mb-4 block w-full max-w-sm opacity-80 @3xl:hidden"
      />
      <MiniMapping
        sketch={wide}
        className="absolute inset-0 -z-10 hidden size-full opacity-70 blur-[2px] @3xl:block"
      />
      <div className="bg-background/85 mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-xl border p-6 text-center shadow-lg backdrop-blur-sm @3xl:my-10">
        <span
          aria-hidden
          className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-lg">
          <HugeiconsIcon icon={AiMagicIcon} strokeWidth={2} className="size-5" />
        </span>
        <h2 id={headingId} className="text-xl font-semibold text-balance">
          {t('title')}
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">{t('description')}</p>
        <DraftAction />
      </div>
    </section>
  )
}
