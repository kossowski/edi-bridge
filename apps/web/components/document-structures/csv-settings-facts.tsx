'use client'

import { useTranslations } from 'next-intl'

import { Fact } from '@/components/detail-parts'

import type { CsvDelimiter, CsvSettings } from '@edi-bridge/contracts'

const delimiterKeys = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
} as const satisfies Record<CsvDelimiter, string>

const encodingLabels = { 'utf-8': 'UTF-8', 'windows-1252': 'Windows-1252' } as const

export function CsvSettingsFacts({ id, csv }: { id: string; csv: CsvSettings }) {
  const t = useTranslations('CsvSettings')

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-lg border p-4">
      <h2 id={id} className="font-semibold">
        {t('title')}
      </h2>
      <p className="text-muted-foreground text-sm">{t('description')}</p>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact label={t('delimiter')}>{t(`delimiters.${delimiterKeys[csv.delimiter]}`)}</Fact>
        <Fact label={t('headerRow')}>{t(`headerRows.${csv.headerRow ? 'yes' : 'no'}`)}</Fact>
        <Fact label={t('encoding')}>{encodingLabels[csv.encoding]}</Fact>
      </dl>
    </section>
  )
}
