'use client'

import { useQueries, useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'

import { SelectField } from '@/components/form-field'
import { ChoiceCards } from '@/components/trading-partners/choice-cards'
import { latestMappingVersions } from '@/components/trading-partners/partner-documents'
import {
  WizardLoadFailed,
  WizardLoading,
} from '@/components/trading-partners/partner-wizard-load-state'
import {
  chooseMapping,
  type MappingWay,
  type OfferedMappings,
  type WizardDocument,
  type WizardErrors,
  type WizardMapping,
  wizardFieldId,
} from '@/components/trading-partners/partner-wizard-state'
import { publishedMappingVersionsQuery } from '@/lib/api/queries'
import { type MappingVersionSummary } from '@edi-bridge/contracts'

type UpdateMapping = (
  document: WizardDocument,
  update: (current: WizardMapping | undefined) => WizardMapping,
) => void

export function useOfferedMappings(
  documents: ReadonlyArray<WizardDocument>,
  enabled: boolean,
): OfferedMappings {
  const results = useQueries({
    queries: documents.map((document) => ({
      ...publishedMappingVersionsQuery(document),
      enabled,
    })),
  })

  const offered: OfferedMappings = {}

  documents.forEach((document, index) => {
    const data = results[index]?.data

    if (data !== undefined) {
      offered[document] = latestMappingVersions(data).map(({ id }) => id)
    }
  })

  return offered
}

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

  const existing = {
    value: 'existing' as const,
    ...(only === undefined
      ? {
          title: t('mappings.existing.title'),
          description: t('mappings.existing.description', { count: mappings.length, documents }),
        }
      : {
          title: t('mappings.use', { mapping: only.mappingName }),
          description: versionLabel(only),
          badge: t('mappings.suggested'),
        }),
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
        <WizardLoading message={t('mappings.loading', { documents })} />
        {wayError !== undefined && (
          <p className="text-destructive-text text-sm">{t('errors.mapping.required')}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {versions.isError && (
        <WizardLoadFailed
          message={t('mappings.failed', { documents })}
          onRetry={() => void versions.refetch()}
        />
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
