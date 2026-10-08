import { ArrowLeft01Icon, PlayListIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import type { Metadata } from 'next'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@edi-bridge/ui/components/empty'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations()

  return { title: { absolute: `${t('RunDetail.title')} · ${t('Shell.appName')}` } }
}

export default async function Page({ params }: PageProps<'/runs/[id]'>) {
  const { id } = await params
  const t = await getTranslations()

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Link
        href="/runs"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex w-fit items-center gap-1 rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3">
        <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} aria-hidden className="size-4" />
        {t('RunDetail.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('RunDetail.title')}</h1>
        <p className="text-muted-foreground font-mono text-sm break-all">{id}</p>
      </div>
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={PlayListIcon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>{t('Placeholder.title')}</EmptyTitle>
          <EmptyDescription>{t('RunDetail.placeholder')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
