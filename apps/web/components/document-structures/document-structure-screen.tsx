'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type ReactNode, useId, useState } from 'react'

import { BackLink, Fact, LoadFailure, Loading } from '@/components/detail-parts'
import { CsvSettingsFields, FirstRows } from '@/components/document-structures/csv-settings'
import { sameCsvSettings } from '@/components/document-structures/csv-text'
import {
  encodeBase64,
  fileProblem,
  type FileProblem,
} from '@/components/document-structures/document-file'
import { RefusalAlert } from '@/components/document-structures/document-structure-problem'
import { FileField } from '@/components/document-structures/file-field'
import { UsedByMappings } from '@/components/document-structures/mapping-list'
import {
  type Adjustments,
  ancestorPaths,
  leafCount,
  type StructureTree,
  withAdjustment,
} from '@/components/document-structures/structure-tree'
import {
  type Reveal,
  revealOf,
  type RowMark,
  StructureTreeGrid,
} from '@/components/document-structures/structure-tree-grid'
import { TextField } from '@/components/form-field'
import {
  ApiError,
  documentStructureProblemOf,
  inferDocumentStructure,
  updateDocumentStructure,
} from '@/lib/api/client'
import {
  documentStructureQuery,
  documentStructuresQuery,
  storeSavedDocumentStructure,
} from '@/lib/api/queries'
import {
  type CsvSettings,
  type DocumentStructure,
  type DocumentStructureOrigin,
  type DocumentStructureProblem,
  type EncodedFile,
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

type Reread = ReturnType<typeof useReread>

function useReread() {
  return useMutation({
    mutationFn: (origin: DocumentStructureOrigin) => inferDocumentStructure(origin),
  })
}

function CsvSection({
  id,
  csv,
  savedCsv,
  csvDocument,
  fileError,
  reread,
  onChange,
  onChoose,
  onRetry,
}: {
  id: string
  csv: CsvSettings
  savedCsv: CsvSettings
  csvDocument: EncodedFile | null
  fileError: FileProblem | null
  reread: Reread
  onChange: (csv: CsvSettings) => void
  onChoose: (file: File) => void
  onRetry: () => void
}) {
  const t = useTranslations('DocumentStructure.csv')
  const tForm = useTranslations('DocumentStructureForm')
  const unreadable = documentStructureProblemOf(reread.error) !== null

  return (
    <CsvSettingsFields id={id} csv={csv} description={t('description')} onChange={onChange}>
      <FileField
        id={`${id}-document`}
        accept=".csv,.txt,text/csv,text/plain"
        description={t('document.description')}
        error={
          fileError
            ? tForm(`errors.${fileError}`)
            : unreadable
              ? tForm('errors.unreadableCsv')
              : null
        }
        fileName={csvDocument?.fileName ?? null}
        label={t('document.label')}
        onChange={onChoose}
      />
      {csvDocument === null && !sameCsvSettings(csv, savedCsv) && (
        <p className="text-sm font-medium">{t('documentNeeded')}</p>
      )}
      {csvDocument && <FirstRows csv={csv} file={csvDocument} />}
      <RefusalAlert error={reread.error} failed={tForm('preview.failed')}>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {tForm('preview.retry')}
        </Button>
      </RefusalAlert>
    </CsvSettingsFields>
  )
}

function Fields({
  id,
  structure,
  csvDocument,
  reread,
  tree,
  children,
}: {
  id: string
  structure: DocumentStructure
  csvDocument: EncodedFile | null
  reread: Reread
  tree: StructureTree | null
  children: ReactNode
}) {
  const t = useTranslations('DocumentStructure')

  return (
    <section aria-labelledby={`${id}-fields`} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-fields`} className="font-semibold">
          {t('fields')}
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">
          {csvDocument
            ? t('csv.rereadFieldsDescription', { fileName: csvDocument.fileName })
            : structure.format === 'csv'
              ? t('csvFieldsDescription')
              : t('fieldsDescription')}
        </p>
      </div>
      {tree ? (
        children
      ) : reread.isPending ? (
        <Loading label={t('csv.reading')} rows={8} />
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
          {t('csv.unread')}
        </p>
      )}
    </section>
  )
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
  const savedCsv = structure.format === 'csv' ? structure.csv : null
  const [csv, setCsv] = useState(savedCsv)
  const [csvDocument, setCsvDocument] = useState<EncodedFile | null>(null)
  const [fileError, setFileError] = useState<FileProblem | null>(null)
  const reread = useReread()
  const nameMissing = name.trim() === ''
  const nameChanged = name.trim() !== structure.name
  const csvChanged = csv !== null && savedCsv !== null && !sameCsvSettings(csv, savedCsv)

  const changeCount =
    adjustments.size + (nameChanged ? 1 : 0) + (csvChanged ? 1 : 0) + (csvDocument ? 1 : 0)

  const tree: StructureTree | null = csvDocument ? (reread.data ?? null) : structure

  const save = useMutation({
    mutationFn: (body: UpdateDocumentStructureBody) => updateDocumentStructure(structure.id, body),
    onSuccess: (updated) => {
      storeSavedDocumentStructure(queryClient, updated)
      setAdjustments(new Map())
      setName(updated.name)
      setCsv(updated.format === 'csv' ? updated.csv : null)
      setCsvDocument(null)
      reread.reset()
      setSaved(true)
    },
  })

  const problem = documentStructureProblemOf(save.error)
  const marks = markOf(problem)
  const shownPath = problem?.path && tree && ancestorPaths(tree.children, problem.path) !== null

  function discard() {
    setAdjustments(new Map())
    setName(structure.name)
    setCsv(savedCsv)
    setCsvDocument(null)
    setFileError(null)
    reread.reset()
    save.reset()
  }

  function read(file: EncodedFile, settings: CsvSettings) {
    setAdjustments(new Map())
    setSaved(false)
    save.reset()
    reread.mutate({ kind: 'csvDocument', document: file, csv: settings })
  }

  async function choose(chosen: File) {
    const sizeProblem = fileProblem(chosen.size)

    setFileError(sizeProblem)

    if (sizeProblem || csv === null) {
      setCsvDocument(null)
      reread.reset()

      return
    }

    const encoded = {
      fileName: chosen.name,
      content: encodeBase64(new Uint8Array(await chosen.arrayBuffer())),
    }

    setCsvDocument(encoded)
    read(encoded, csv)
  }

  function changeCsv(next: CsvSettings) {
    setCsv(next)
    setSaved(false)

    if (csvDocument) {
      read(csvDocument, next)
    }
  }

  function body(): UpdateDocumentStructureBody {
    const update: UpdateDocumentStructureBody = {
      name: name.trim(),
      adjustments: [...adjustments.values()],
    }

    if (csv && (csvChanged || csvDocument)) {
      update.csv = csv
    }

    if (csvDocument) {
      update.document = csvDocument
    }

    return update
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
          save.mutate(body())
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
        {csv && savedCsv && (
          <CsvSection
            id={`${id}-csv`}
            csv={csv}
            csvDocument={csvDocument}
            fileError={fileError}
            reread={reread}
            savedCsv={savedCsv}
            onChange={changeCsv}
            onChoose={(chosen) => void choose(chosen)}
            onRetry={() => csvDocument && read(csvDocument, csv)}
          />
        )}
        <Fields id={id} csvDocument={csvDocument} reread={reread} structure={structure} tree={tree}>
          {tree && (
            <StructureTreeGrid
              key={csvDocument ? `reread-${reread.submittedAt}` : 'saved'}
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
              tree={tree}
            />
          )}
        </Fields>
        <div className="bg-background/95 sticky bottom-0 -mx-6 flex flex-col gap-3 border-t px-6 py-3 backdrop-blur">
          <RefusalAlert
            error={save.error}
            failed={t('failed')}
            mappings={mappings ?? []}
            takeFocus
            className="max-h-[40vh] w-full overflow-y-auto"
            onShowPath={shownPath ? (path) => setReveal(revealOf(path)) : undefined}
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
              <Button
                disabled={changeCount === 0 || save.isPending || reread.isPending}
                type="submit">
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
