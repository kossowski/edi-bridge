'use client'

import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'

import { CsvSettingsFields } from '@/components/document-structures/csv-settings'
import { FileField } from '@/components/document-structures/file-field'
import { type CsvSettings } from '@edi-bridge/contracts'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@edi-bridge/ui/components/collapsible'

const jsonSchemaFiles = '.json,application/json,application/schema+json'

export function TechnicalOptions({
  id,
  csvId,
  open,
  csv,
  jsonSchemaName,
  onOpenChange,
  onCsv,
  onJsonSchema,
}: {
  id: string
  csvId: string
  open: boolean
  csv: CsvSettings
  jsonSchemaName: string | null
  onOpenChange: (open: boolean) => void
  onCsv: (csv: CsvSettings) => void
  onJsonSchema: (file: File) => void
}) {
  const t = useTranslations('DocumentStructureForm.technical')

  return (
    <Collapsible
      open={open}
      render={<section aria-labelledby={`${id}-title`} />}
      className="group/technical flex flex-col gap-4 border-t pt-4"
      onOpenChange={onOpenChange}>
      <h2 id={`${id}-title`} className="font-semibold">
        <CollapsibleTrigger className="hover:bg-muted focus-visible:outline-ring -mx-2 flex min-h-9 items-center gap-2 rounded-md px-2 outline-hidden focus-visible:outline-2 focus-visible:outline-solid">
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            aria-hidden
            className="size-4 transition-transform group-data-open/technical:rotate-90"
          />
          {t('title')}
        </CollapsibleTrigger>
      </h2>
      <p className="text-muted-foreground -mt-2 max-w-prose text-sm">{t('description')}</p>
      <CollapsibleContent keepMounted className="grid items-start gap-6 lg:grid-cols-2">
        <section
          aria-labelledby={`${id}-schema`}
          className="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
          <h3 id={`${id}-schema`} className="font-semibold">
            {t('jsonSchema.title')}
          </h3>
          <FileField
            id={`${id}-schema-file`}
            accept={jsonSchemaFiles}
            description={t('jsonSchema.description')}
            fileName={jsonSchemaName}
            label={t('jsonSchema.label')}
            message={null}
            onChange={onJsonSchema}
          />
        </section>
        <CsvSettingsFields
          id={csvId}
          csv={csv}
          description={t('csvDescription')}
          onChange={onCsv}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}
