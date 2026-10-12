'use client'

import { BracesIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { AppPage } from '@/components/app-page'
import { Fact, FactGrid, LoadFailure, Loading } from '@/components/detail-parts'
import { fieldEntries, FieldList, scrollToField } from '@/components/document-structures/field-list'
import { type Mappings, UsedByMappings } from '@/components/document-structures/mapping-list'
import { SampleFile, scrollToValue } from '@/components/document-structures/sample-file'
import { firstValues, sampleContent } from '@/components/document-structures/sample-segments'
import { leafCount } from '@/components/document-structures/structure-tree'
import { TechnicalSettings } from '@/components/document-structures/technical-settings'
import { useSession } from '@/hooks/use-session'
import { ApiError } from '@/lib/api/client'
import { documentStructureQuery, documentStructuresQuery } from '@/lib/api/queries'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

import type { DocumentStructure } from '@edi-bridge/contracts'

function useMappings(id: string): Mappings | undefined {
  const summaries = useQuery(documentStructuresQuery)

  return summaries.data?.find((summary) => summary.id === id)?.mappings
}

function Facts({
  structure,
  mappings,
}: {
  structure: DocumentStructure
  mappings: Mappings | undefined
}) {
  const t = useTranslations('DocumentStructure.facts')
  const tList = useTranslations('DocumentStructures')

  return (
    <FactGrid label={t('label')}>
      <Fact label={t('format')}>
        <Badge variant="outline">{tList(`format.${structure.format}`)}</Badge>
      </Fact>
      <Fact label={t('fields')}>
        {tList('fieldCount', { count: leafCount(structure.children) })}
      </Fact>
      <Fact label={t('mappings')}>
        {mappings ? (
          <UsedByMappings mappings={mappings} />
        ) : (
          <Loading label={t('mappingsLoading')} rowClassName="h-4 w-32" rows={1} />
        )}
      </Fact>
    </FactGrid>
  )
}

function NoSample() {
  const t = useTranslations('DocumentStructure.sample')

  return (
    <div className="text-muted-foreground flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm">
      <HugeiconsIcon
        icon={BracesIcon}
        strokeWidth={2}
        aria-hidden
        className="mt-0.5 size-5 shrink-0"
      />
      <div className="flex flex-col gap-1">
        <p className="text-foreground font-medium">{t('none')}</p>
        <p className="text-pretty">{t('noneDescription')}</p>
      </div>
    </div>
  )
}

function StructurePage({
  structure,
  canChange,
}: {
  structure: DocumentStructure
  canChange: boolean
}) {
  const t = useTranslations('DocumentStructure.fieldList')
  const id = useId()
  const mappings = useMappings(structure.id)
  const valuesRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const { sample } = structure
  const entries = useMemo(() => fieldEntries(structure.children), [structure])
  const [selected, setSelected] = useState(() => entries[0]?.node.path ?? null)

  const labels = useMemo(
    () => new Map(entries.map(({ node }) => [node.path, node.label])),
    [entries],
  )

  const content = useMemo(() => sample && sampleContent(structure, sample), [structure, sample])

  const examples = useMemo(
    () => (content ? firstValues(content) : new Map<string, string>()),
    [content],
  )

  const shown = selected !== null && labels.has(selected) ? selected : null

  const fields = (
    <section aria-labelledby={`${id}-fields`} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-fields`} className="font-semibold">
          {sample ? t('title') : t('titleNoSample')}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">{t('description')}</p>
      </div>
      <FieldList
        canChange={canChange}
        entries={entries}
        examples={examples}
        listRef={listRef}
        mappings={mappings}
        selected={shown}
        structure={structure}
        onSelect={(path) => {
          setSelected(path)

          if (path !== null) {
            scrollToValue(valuesRef.current, path)
          }
        }}
      />
    </section>
  )

  return (
    <div className="flex flex-col gap-6">
      <Facts mappings={mappings} structure={structure} />
      {sample && content ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="min-w-0 lg:sticky lg:top-4">
            <SampleFile
              content={content}
              labels={labels}
              sample={sample}
              selected={shown}
              valuesRef={valuesRef}
              onSelect={(path) => {
                flushSync(() => setSelected(path))
                scrollToField(listRef.current, path)
              }}
            />
          </div>
          {fields}
        </div>
      ) : (
        <div className="flex max-w-3xl flex-col gap-4">
          <NoSample />
          {fields}
        </div>
      )}
      <TechnicalSettings canChange={canChange} mappings={mappings} structure={structure} />
    </div>
  )
}

export function DocumentStructureScreen({ id }: { id: string }) {
  const t = useTranslations('DocumentStructure')
  const { data, error, isPending, refetch } = useQuery(documentStructureQuery(id))
  const session = useSession()

  return (
    <AppPage name={data?.name}>
      {isPending || session.isPending ? (
        <div aria-busy className="flex flex-col gap-4">
          <p role="status" className="sr-only">
            {t('loading')}
          </p>
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      ) : data ? (
        <StructurePage canChange={session.canChange} structure={data} />
      ) : (
        <LoadFailure
          namespace="DocumentStructure"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </AppPage>
  )
}
