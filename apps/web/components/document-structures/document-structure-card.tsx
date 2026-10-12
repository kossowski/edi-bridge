'use client'

import { File02Icon, BracesIcon, Upload01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useId } from 'react'

import { documentStructureHref, mappingHref, newDocumentStructureHref } from '@/lib/navigation'
import { Badge } from '@edi-bridge/ui/components/badge'
import { buttonVariants } from '@edi-bridge/ui/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@edi-bridge/ui/components/card'

import type { DocumentStructureSummary } from '@edi-bridge/contracts'

export function AddDocumentStructureCard() {
  const t = useTranslations('DocumentStructures.add')

  return (
    <Link
      href={newDocumentStructureHref}
      className="hover:border-primary hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-ring/50 flex h-full min-h-64 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors outline-none focus-visible:ring-3">
      <HugeiconsIcon
        icon={Upload01Icon}
        strokeWidth={2}
        aria-hidden
        className="text-muted-foreground size-8"
      />
      <span className="font-medium">{t('title')}</span>
      <span className="text-muted-foreground max-w-64 text-sm text-pretty">{t('description')}</span>
    </Link>
  )
}

function SamplePreview({ sample }: { sample: NonNullable<DocumentStructureSummary['sample']> }) {
  const t = useTranslations('DocumentStructures.sample')
  const format = useFormatter()
  const takenAt = new Date(sample.takenAt)

  return (
    <figure className="min-w-0 overflow-hidden rounded-lg border">
      <figcaption className="bg-muted/50 flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-3 py-2 text-xs">
        <HugeiconsIcon icon={File02Icon} strokeWidth={2} aria-hidden className="size-3.5" />
        <span className="min-w-0 truncate font-medium">
          <span className="sr-only">{t('label')} </span>
          {sample.fileName}
        </span>
        <time
          dateTime={sample.takenAt}
          title={format.dateTime(takenAt, { dateStyle: 'medium', timeStyle: 'short' })}
          className="text-muted-foreground ml-auto">
          {format.dateTime(takenAt, { dateStyle: 'medium' })}
        </time>
      </figcaption>
      <pre className="max-h-36 overflow-hidden mask-b-from-60% p-3 font-mono text-xs leading-5">
        {sample.preview}
      </pre>
    </figure>
  )
}

function NoSample() {
  const t = useTranslations('DocumentStructures.sample')

  return (
    <div className="text-muted-foreground flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center text-xs">
      <HugeiconsIcon icon={BracesIcon} strokeWidth={2} aria-hidden className="size-5" />
      <p className="text-foreground font-medium">{t('none')}</p>
      <p className="text-pretty">{t('noneDescription')}</p>
    </div>
  )
}

function FieldNames({ summary }: { summary: DocumentStructureSummary }) {
  const t = useTranslations('DocumentStructures')
  const format = useFormatter()
  const more = summary.fieldCount - summary.firstFieldLabels.length

  const names = [
    ...summary.firstFieldLabels,
    ...(more > 0 ? [t('moreFields', { count: more })] : []),
  ]

  return (
    <p className="text-sm">
      <span className="font-medium">{t('fieldCount', { count: summary.fieldCount })}</span>
      {names.length > 0 && <span className="text-muted-foreground">: {format.list(names)}</span>}
    </p>
  )
}

function ReadingMappings({ mappings }: { mappings: DocumentStructureSummary['mappings'] }) {
  const t = useTranslations('DocumentStructures')

  if (mappings.length === 0) {
    return <p className="text-muted-foreground text-xs">{t('notRead')}</p>
  }

  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs">
      <p className="text-muted-foreground">{t('readBy')}</p>
      <ul className="flex flex-col gap-1">
        {mappings.map((mapping) => (
          <li key={mapping.id} className="min-w-0">
            <Link
              href={mappingHref(mapping.id)}
              className="text-foreground font-medium break-words underline-offset-4 hover:underline">
              {mapping.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function DocumentStructureCard({ summary }: { summary: DocumentStructureSummary }) {
  const t = useTranslations('DocumentStructures')
  const titleId = useId()
  const href = documentStructureHref(summary.id)

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          <h2 id={titleId} className="min-w-0 break-words">
            <Link href={href} className="hover:underline">
              {summary.name}
            </Link>
          </h2>
        </CardTitle>
        <CardAction>
          <Badge variant="outline">{t(`format.${summary.format}`)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {summary.sample ? <SamplePreview sample={summary.sample} /> : <NoSample />}
        <FieldNames summary={summary} />
      </CardContent>
      <CardFooter className="mt-auto flex items-end justify-between gap-3">
        <ReadingMappings mappings={summary.mappings} />
        <Link
          href={href}
          aria-describedby={titleId}
          className={buttonVariants({ size: 'sm', variant: 'outline', className: 'shrink-0' })}>
          {t('open')}
        </Link>
      </CardFooter>
    </Card>
  )
}
