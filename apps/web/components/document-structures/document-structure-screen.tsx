'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { type ReactNode, useId, useState } from 'react'

import { BackLink, Fact, LoadFailure, Loading } from '@/components/detail-parts'
import {
  CsvSettingsFacts,
  CsvSettingsFields,
  FirstRows,
} from '@/components/document-structures/csv-settings'
import { sameCsvSettings } from '@/components/document-structures/csv-text'
import {
  encodeFile,
  fileMessageOf,
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
import { useSession } from '@/hooks/use-session'
import { ApiError, documentStructureProblemOf, updateDocumentStructure } from '@/lib/api/client'
import {
  documentStructureQuery,
  documentStructuresQuery,
  storeSavedDocumentStructure,
  useDocumentStructureInference,
} from '@/lib/api/queries'
import {
  type CsvSettings,
  defaultCsvSettings,
  type DocumentStructure,
  type DocumentStructureProblem,
  type DocumentStructureSummary,
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

type CsvReread = ReturnType<typeof useCsvReread>

function useCsvReread(savedCsv: CsvSettings, onRead: () => void) {
  const [csv, setCsv] = useState(savedCsv)
  const [csvDocument, setCsvDocument] = useState<EncodedFile | null>(null)
  const [fileError, setFileError] = useState<FileProblem | null>(null)
  const reread = useDocumentStructureInference()
  const changed = !sameCsvSettings(csv, savedCsv)
  const unreadable = documentStructureProblemOf(reread.error) !== null

  const blocked: 'documentNeeded' | 'unread' | null =
    csvDocument === null ? (changed ? 'documentNeeded' : null) : reread.isError ? 'unread' : null

  function read(file: EncodedFile, settings: CsvSettings) {
    onRead()
    reread.mutate({ kind: 'csvDocument', document: file, csv: settings })
  }

  function reset(next: CsvSettings) {
    setCsv(next)
    setCsvDocument(null)
    setFileError(null)
    reread.reset()
  }

  return {
    csv,
    csvDocument,
    reread,
    blocked,
    changeCount: (changed ? 1 : 0) + (csvDocument ? 1 : 0),
    tree: csvDocument ? (reread.data ?? null) : null,
    fileMessage: fileMessageOf(fileError, unreadable, true),
    reset,
    choose: async (chosen: File) => {
      const { problem, encoded } = await encodeFile(chosen)

      setFileError(problem)
      setCsvDocument(encoded)

      if (encoded === null) {
        reread.reset()
      } else {
        read(encoded, csv)
      }
    },
    change: (next: CsvSettings) => {
      setCsv(next)

      if (csvDocument) {
        read(csvDocument, next)
      }
    },
    retry: () => {
      if (csvDocument) {
        read(csvDocument, csv)
      }
    },
    addChanges: (update: UpdateDocumentStructureBody) => {
      if (changed || csvDocument) {
        update.csv = csv
      }

      if (csvDocument) {
        update.document = csvDocument
      }
    },
  }
}

function CsvSection({
  id,
  reading,
  onChange,
}: {
  id: string
  reading: CsvReread
  onChange: (csv: CsvSettings) => void
}) {
  const t = useTranslations('DocumentStructure.csv')
  const tForm = useTranslations('DocumentStructureForm')

  return (
    <CsvSettingsFields id={id} csv={reading.csv} description={t('description')} onChange={onChange}>
      <FileField
        id={`${id}-document`}
        accept=".csv,.txt,text/csv,text/plain"
        description={t('document.description')}
        fileName={reading.csvDocument?.fileName ?? null}
        label={t('document.label')}
        message={reading.fileMessage}
        onChange={(chosen) => void reading.choose(chosen)}
      />
      {reading.csvDocument && (
        <FirstRows csv={reading.csv} file={reading.csvDocument} tree={reading.tree} />
      )}
      <RefusalAlert error={reading.reread.error} failed={tForm('preview.failed')}>
        <Button size="sm" variant="outline" onClick={reading.retry}>
          {tForm('preview.retry')}
        </Button>
      </RefusalAlert>
    </CsvSettingsFields>
  )
}

function Fields({
  id,
  reading,
  tree,
  children,
}: {
  id: string
  reading: CsvReread | null
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
          {reading?.csvDocument
            ? t('csv.rereadFieldsDescription', { fileName: reading.csvDocument.fileName })
            : reading
              ? t('csvFieldsDescription')
              : t('fieldsDescription')}
        </p>
      </div>
      {tree ? (
        children
      ) : reading?.reread.isPending ? (
        <Loading label={t('csv.reading')} rows={8} />
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
          {t('csv.unread')}
        </p>
      )}
    </section>
  )
}

function useMappings(id: string) {
  const summaries = useQuery(documentStructuresQuery)

  return summaries.data?.find((summary) => summary.id === id)?.mappings
}

function StructureFacts({
  structure,
  mappings,
}: {
  structure: DocumentStructure
  mappings: DocumentStructureSummary['mappings'] | undefined
}) {
  const t = useTranslations('DocumentStructure')
  const tList = useTranslations('DocumentStructures')

  return (
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
  )
}

function StructureView({ structure }: { structure: DocumentStructure }) {
  const t = useTranslations('DocumentStructure')
  const id = useId()

  return (
    <div className="flex flex-col gap-6">
      <StructureFacts mappings={useMappings(structure.id)} structure={structure} />
      {structure.format === 'csv' && <CsvSettingsFacts id={`${id}-csv`} csv={structure.csv} />}
      <section aria-labelledby={`${id}-fields`} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={`${id}-fields`} className="font-semibold">
            {t('fields')}
          </h2>
          <p className="text-muted-foreground max-w-prose text-sm">
            {t('viewOnlyFieldsDescription')}
          </p>
        </div>
        <StructureTreeGrid name={structure.name} tree={structure} />
      </section>
    </div>
  )
}

function Editor({ structure }: { structure: DocumentStructure }) {
  const t = useTranslations('DocumentStructure')
  const id = useId()
  const queryClient = useQueryClient()
  const mappings = useMappings(structure.id)
  const [name, setName] = useState(structure.name)
  const [adjustments, setAdjustments] = useState<Adjustments>(new Map())
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [saved, setSaved] = useState(false)
  const savedCsv = structure.format === 'csv' ? structure.csv : defaultCsvSettings

  const save = useMutation({
    mutationFn: (body: UpdateDocumentStructureBody) => updateDocumentStructure(structure.id, body),
    onSuccess: (updated) => {
      storeSavedDocumentStructure(queryClient, updated)
      setAdjustments(new Map())
      setName(updated.name)
      setSaved(true)
    },
  })

  const csvReread = useCsvReread(savedCsv, () => {
    setAdjustments(new Map())
    setSaved(false)
    save.reset()
  })

  const reading = structure.format === 'csv' ? csvReread : null
  const nameMissing = name.trim() === ''
  const nameChanged = name.trim() !== structure.name
  const changeCount = adjustments.size + (nameChanged ? 1 : 0) + (reading?.changeCount ?? 0)
  const tree: StructureTree | null = reading?.csvDocument ? reading.tree : structure
  const blocked = reading?.blocked ?? null

  const problem = documentStructureProblemOf(save.error)
  const marks = markOf(problem)
  const shownPath = problem?.path && tree && ancestorPaths(tree.children, problem.path) !== null

  function discard() {
    setAdjustments(new Map())
    setName(structure.name)
    csvReread.reset(savedCsv)
    save.reset()
  }

  function body(): UpdateDocumentStructureBody {
    const update: UpdateDocumentStructureBody = {
      name: name.trim(),
      adjustments: [...adjustments.values()],
    }

    reading?.addChanges(update)

    return update
  }

  return (
    <div className="flex flex-col gap-6">
      <StructureFacts mappings={mappings} structure={structure} />
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
          save.mutate(body(), {
            onSuccess: (updated) => {
              if (updated.format === 'csv') {
                csvReread.reset(updated.csv)
              }
            },
          })
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
        {reading && (
          <CsvSection
            id={`${id}-csv`}
            reading={reading}
            onChange={(next) => {
              reading.change(next)
              setSaved(false)
            }}
          />
        )}
        <Fields id={id} reading={reading} tree={tree}>
          {tree && (
            <StructureTreeGrid
              key={reading?.csvDocument ? `reread-${reading.reread.submittedAt}` : 'saved'}
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
            <div className="flex flex-col gap-0.5">
              <p aria-live="polite" className="text-muted-foreground text-sm">
                {saved && changeCount === 0 ? t('saved') : t('unsaved', { count: changeCount })}
              </p>
              {blocked && (
                <p id={`${id}-blocked`} className="text-sm font-medium">
                  {t(`csv.blocked.${blocked}`)}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                disabled={changeCount === 0 || save.isPending}
                type="button"
                variant="outline"
                onClick={discard}>
                {t('discard')}
              </Button>
              <Button
                disabled={
                  changeCount === 0 ||
                  save.isPending ||
                  blocked !== null ||
                  reading?.reread.isPending === true
                }
                type="submit"
                aria-describedby={blocked ? `${id}-blocked` : undefined}>
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
  const session = useSession()

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/document-structures" label={t('back')} />
      <h1 className="text-2xl font-semibold tracking-tight">{data?.name ?? t('title')}</h1>
      {isPending || session.isPending ? (
        <div aria-busy className="flex flex-col gap-4">
          <p role="status" className="sr-only">
            {t('loading')}
          </p>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : data ? (
        session.canChange ? (
          <Editor structure={data} />
        ) : (
          <StructureView structure={data} />
        )
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
