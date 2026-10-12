'use client'

import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'

import { SelectField } from '@/components/form-field'
import { ChoiceCards } from '@/components/trading-partners/choice-cards'
import { latestMappingVersions } from '@/components/trading-partners/partner-documents'
import {
  chooseMapping,
  type MappingWay,
  type WizardDocument,
  type WizardErrors,
  type WizardMapping,
  wizardFieldId,
} from '@/components/trading-partners/partner-wizard-state'
import { publishedMappingVersionsQuery } from '@/lib/api/queries'
import { type MappingVersionSummary } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

type UpdateMapping = (
  document: WizardDocument,
  update: (current: WizardMapping | undefined) => WizardMapping,
) => void

function useVersionLabel() {
  const t = useTranslations('Flow')
  const format = useFormatter()

  return (version: MappingVersionSummary) =>
    t('versionOption', {
      version: version.version,
      publishedAt: format.dateTime(new Date(version.publishedAt), { dateStyle: 'medium' }),
    })
}

function DocumentMapping({
  document,
  mapping,
  errors,
  idPrefix,
  onUpdate,
}: {
  document: WizardDocument
  mapping: WizardMapping | undefined
  errors: WizardErrors
  idPrefix: string
  onUpdate: UpdateMapping
}) {
  const t = useTranslations('PartnerWizard')
  const versionLabel = useVersionLabel()
  const versions = useQuery(publishedMappingVersionsQuery(document))
  const mappings = latestMappingVersions(versions.data ?? [])
  const versionIds = mappings.map(({ id }) => id)
  const only = mappings.length === 1 ? mappings[0] : undefined
  const documents = t(`documentNames.${document}`)
  const label = t('mappings.label', { documents })
  const fieldId = wizardFieldId(idPrefix, `${document}.mapping`)

  const existing =
    only === undefined
      ? {
          value: 'existing' as const,
          title: t('mappings.existing.title'),
          description: t('mappings.existing.description', { count: mappings.length, documents }),
        }
      : {
          value: 'existing' as const,
          title: t('mappings.use', { mapping: only.mappingName }),
          description: versionLabel(only),
          badge: t('mappings.suggested'),
        }

  const items = [
    ...(mappings.length > 0 ? [existing] : []),
    {
      value: 'ai' as const,
      title: t('mappings.ai.title'),
      description: t('mappings.ai.description'),
    },
    {
      value: 'later' as const,
      title: t('mappings.later.title'),
      description: t('mappings.later.description'),
    },
  ]

  const wayError = errors[`${document}.mapping`]
  const versionError = errors[`${document}.mappingVersion`]
  const way = mapping?.way === 'existing' && mappings.length === 0 ? null : (mapping?.way ?? null)

  function choose(next: MappingWay) {
    onUpdate(document, (current) => chooseMapping(current, next, versionIds))
  }

  if (versions.isPending) {
    return (
      <div id={fieldId} className="flex flex-col gap-2">
        <span className="text-sm font-medium">{label}</span>
        <p role="status" className="text-muted-foreground text-sm">
          {t('mappings.loading', { documents })}
        </p>
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        {wayError !== undefined && (
          <p className="text-sm text-red-800 dark:text-red-300">{t('errors.mapping.required')}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {versions.isError && (
        <div
          role="alert"
          className="bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 text-sm">
          <p>{t('mappings.failed', { documents })}</p>
          <Button size="sm" type="button" variant="outline" onClick={() => void versions.refetch()}>
            {t('mappings.retry')}
          </Button>
        </div>
      )}
      <ChoiceCards
        id={fieldId}
        error={wayError === undefined ? null : t('errors.mapping.required')}
        items={items}
        label={label}
        value={way}
        onChange={choose}
      />
      {versions.isSuccess && mappings.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('mappings.empty', { documents })}</p>
      )}
      {mapping?.way === 'existing' && only === undefined && mappings.length > 0 && (
        <SelectField
          id={wizardFieldId(idPrefix, `${document}.mappingVersion`)}
          description={t('mappings.select.description')}
          error={versionError === undefined ? null : t('errors.mappingVersion.required')}
          items={mappings.map((version) => ({
            value: version.id,
            label: version.mappingName,
            detail: versionLabel(version),
          }))}
          label={t('mappings.select.label', { documents })}
          placeholder={t('mappings.select.placeholder')}
          value={mapping.mappingVersionId}
          className="w-full"
          onChange={(mappingVersionId) =>
            onUpdate(document, () => ({ way: 'existing', mappingVersionId }))
          }
        />
      )}
    </div>
  )
}

export function MappingsStep({
  documents,
  mappings,
  errors,
  idPrefix,
  onUpdate,
}: {
  documents: ReadonlyArray<WizardDocument>
  mappings: Partial<Record<WizardDocument, WizardMapping>>
  errors: WizardErrors
  idPrefix: string
  onUpdate: UpdateMapping
}) {
  return (
    <div className="flex flex-col gap-8">
      {documents.map((document) => (
        <DocumentMapping
          key={document}
          document={document}
          errors={errors}
          idPrefix={idPrefix}
          mapping={mappings[document]}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  )
}
