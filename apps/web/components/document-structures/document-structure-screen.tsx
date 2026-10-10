'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { BackLink, Fact, LoadFailure, Loading } from '@/components/detail-parts'
import { CsvSettingsFacts } from '@/components/document-structures/csv-settings-facts'
import { RefusalAlert } from '@/components/document-structures/document-structure-problem'
import { UsedByMappings } from '@/components/document-structures/mapping-list'
import {
  type Adjustments,
  leafCount,
  withAdjustment,
} from '@/components/document-structures/structure-tree'
import {
  type Reveal,
  revealOf,
  type RowMark,
  StructureTreeGrid,
} from '@/components/document-structures/structure-tree-grid'
import { TextField } from '@/components/form-field'
import { ApiError, documentStructureProblemOf, updateDocumentStructure } from '@/lib/api/client'
import {
  documentStructureQuery,
  documentStructuresQuery,
  storeSavedDocumentStructure,
} from '@/lib/api/queries'
import {
  type DocumentStructure,
  type DocumentStructureProblem,
  maxDocumentStructureNameLength,
  type UpdateDocumentStructureBody,
} from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'
import { Skeleton } from '@edi-bridge/ui/components/skeleton'

const markedCodes = new Set<DocumentStructureProblem['code']>([
  'usedByMappingVersion',
  'linkedByMapping',
  'notAdjustable',
  'unknownPath',
])

function markOf(problem: DocumentStructureProblem | null): ReadonlyMap<string, RowMark> {
  if (!problem?.path || !markedCodes.has(problem.code)) {
    return new Map()
  }

  const mark: RowMark =
    problem.code === 'usedByMappingVersion' || problem.code === 'linkedByMapping'
      ? problem.code
      : 'other'

  return new Map([[problem.path, mark]])
}

function Editor({ structure }: { structure: DocumentStructure }) {
  const t = useTranslations('DocumentStructure')
  const tList = useTranslations('DocumentStructures')
  const id = useId()
  const queryClient = useQueryClient()
  const summaries = useQuery(documentStructuresQuery)
  const mappings = summaries.data?.find((summary) => summary.id === structure.id)?.mappings
  const [name, setName] = useState(structure.name)
  const [adjustments, setAdjustments] = useState<Adjustments>(new Map())
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [saved, setSaved] = useState(false)
  const nameMissing = name.trim() === ''
  const nameChanged = name.trim() !== structure.name
  const changeCount = adjustments.size + (nameChanged ? 1 : 0)

  const save = useMutation({
    mutationFn: (body: UpdateDocumentStructureBody) => updateDocumentStructure(structure.id, body),
    onSuccess: (updated) => {
      storeSavedDocumentStructure(queryClient, updated)
      setAdjustments(new Map())
      setName(updated.name)
      setSaved(true)
    },
  })

  const problem = documentStructureProblemOf(save.error)
  const marks = markOf(problem)

  function discard() {
    setAdjustments(new Map())
    setName(structure.name)
    save.reset()
  }

  return (
    <div className="flex flex-col gap-6">
      <dl aria-label={t('facts.label')} className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3">
        <Fact label={t('facts.format')}>
          <Badge variant="outline">{tList(`format.${structure.format}`)}</Badge>
        </Fact>
        <Fact label={t('facts.fields')}>
          {tList('fieldCount', { count: leafCount(structure.children) })}
        </Fact>
        <Fact label={t('facts.mappings')}>
          {mappings ? (
            <UsedByMappings mappings={mappings} />
          ) : (
            <Loading label={t('facts.mappingsLoading')} rowClassName="h-4 w-32" rows={1} />
          )}
        </Fact>
      </dl>
      {mappings && mappings.length > 0 && (
        <p className="text-muted-foreground max-w-prose text-sm">{t('usedNote')}</p>
      )}
      <form
        noValidate
        aria-busy={save.isPending || undefined}
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault()

          if (nameMissing) {
            document.getElementById(`${id}-name`)?.focus()

            return
          }

          setSaved(false)
          save.mutate({ name: name.trim(), adjustments: [...adjustments.values()] })
        }}>
        <TextField
          id={`${id}-name`}
          description={t('name.description')}
          error={nameMissing ? t('errors.nameRequired') : null}
          label={t('name.label')}
          maxLength={maxDocumentStructureNameLength}
          value={name}
          className="sm:w-96"
          onChange={(next) => {
            setName(next)
            setSaved(false)
          }}
        />
        {structure.format === 'csv' && <CsvSettingsFacts id={`${id}-csv`} csv={structure.csv} />}
        <section aria-labelledby={`${id}-fields`} className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id={`${id}-fields`} className="font-semibold">
              {t('fields')}
            </h2>
            <p className="text-muted-foreground max-w-prose text-sm">
              {structure.format === 'csv' ? t('csvFieldsDescription') : t('fieldsDescription')}
            </p>
          </div>
          <StructureTreeGrid
            editing={{
              adjustments,
              onAdjust: (node, change) => {
                setAdjustments((current) => withAdjustment(current, node, change))
                setSaved(false)
              },
            }}
            marks={marks}
            name={name.trim() || structure.name}
            reveal={reveal}
            tree={structure}
          />
        </section>
        <div className="bg-background/95 sticky bottom-0 -mx-6 flex flex-col gap-3 border-t px-6 py-3 backdrop-blur">
          <RefusalAlert
            error={save.error}
            failed={t('failed')}
            mappings={mappings ?? []}
            takeFocus
            className="max-h-[40vh] w-full overflow-y-auto"
            onShowPath={(path) => setReveal(revealOf(path))}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p aria-live="polite" className="text-muted-foreground text-sm">
              {saved && changeCount === 0 ? t('saved') : t('unsaved', { count: changeCount })}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={changeCount === 0 || save.isPending}
                type="button"
                variant="outline"
                onClick={discard}>
                {t('discard')}
              </Button>
              <Button disabled={changeCount === 0 || save.isPending} type="submit">
                {save.isPending ? t('saving') : t('save')}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

export function DocumentStructureScreen({ id }: { id: string }) {
  const t = useTranslations('DocumentStructure')
  const { data, error, isPending, refetch } = useQuery(documentStructureQuery(id))

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/document-structures" label={t('back')} />
      <h1 className="text-2xl font-semibold tracking-tight">{data?.name ?? t('title')}</h1>
      {isPending ? (
        <div aria-busy className="flex flex-col gap-4">
          <p role="status" className="sr-only">
            {t('loading')}
          </p>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : data ? (
        <Editor structure={data} />
      ) : (
        <LoadFailure
          namespace="DocumentStructure"
          notFound={error instanceof ApiError && error.status === 404}
          onRetry={() => void refetch()}
        />
      )}
    </div>
  )
}
