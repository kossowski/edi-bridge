'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'

import { AppPage } from '@/components/app-page'
import { Loading } from '@/components/detail-parts'
import { CsvSettingsFields, FirstRows } from '@/components/document-structures/csv-settings'
import {
  encodeFile,
  type FileError,
  fileMessageOf,
  nameFromFileName,
  originKindOf,
  toOrigin,
} from '@/components/document-structures/document-file'
import { RefusalAlert } from '@/components/document-structures/document-structure-problem'
import { FileField } from '@/components/document-structures/file-field'
import { leafCount } from '@/components/document-structures/structure-tree'
import { StructureTreeGrid } from '@/components/document-structures/structure-tree-grid'
import { RadioField, TextField } from '@/components/form-field'
import { createDocumentStructure, documentStructureProblemOf } from '@/lib/api/client'
import {
  type DocumentStructureInference,
  storeSavedDocumentStructure,
  useDocumentStructureInference,
} from '@/lib/api/queries'
import {
  type CreateDocumentStructureBody,
  type CsvSettings,
  defaultCsvSettings,
  type DocumentStructureOriginKind,
  documentStructureOriginKinds,
  type EncodedFile,
  maxDocumentStructureNameLength,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'

function Preview({
  file,
  csv,
  infer,
  name,
  onRetry,
}: {
  file: EncodedFile | null
  csv: CsvSettings | null
  infer: DocumentStructureInference
  name: string
  onRetry: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {file && csv && <FirstRows csv={csv} file={file} tree={infer.data ?? null} />}
      <InferredTree file={file} infer={infer} name={name} onRetry={onRetry} />
    </div>
  )
}

function InferredTree({
  file,
  infer,
  name,
  onRetry,
}: {
  file: EncodedFile | null
  infer: DocumentStructureInference
  name: string
  onRetry: () => void
}) {
  const t = useTranslations('DocumentStructureForm.preview')

  if (file === null) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
        {t('none')}
      </p>
    )
  }

  if (infer.isPending) {
    return <Loading label={t('loading')} rows={8} />
  }

  if (infer.isError) {
    return (
      <RefusalAlert error={infer.error} failed={t('failed')}>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      </RefusalAlert>
    )
  }

  if (!infer.data) {
    return null
  }

  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm">
        {t('fields', { count: leafCount(infer.data.children) })}
      </p>
      <StructureTreeGrid
        key={infer.submittedAt}
        name={name.trim() || file.fileName}
        tree={infer.data}
      />
      <p className="text-muted-foreground text-sm">{t('adjustLater')}</p>
    </div>
  )
}

export function NewDocumentStructureScreen() {
  const t = useTranslations('DocumentStructureForm')
  const id = useId()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<DocumentStructureOriginKind>('jsonDocument')
  const [kindChosen, setKindChosen] = useState(false)
  const [csv, setCsv] = useState<CsvSettings>(defaultCsvSettings)
  const [file, setFile] = useState<EncodedFile | null>(null)
  const [fileError, setFileError] = useState<FileError | null>(null)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState(false)
  const infer = useDocumentStructureInference()

  const create = useMutation({
    mutationFn: (body: CreateDocumentStructureBody) => createDocumentStructure(body),
    onSuccess: (created) => {
      storeSavedDocumentStructure(queryClient, created)
      router.push(`/document-structures/${created.id}`)
    },
  })

  const previewProblem = documentStructureProblemOf(infer.error) !== null

  function preview(
    nextKind: DocumentStructureOriginKind,
    nextFile: EncodedFile,
    nextCsv: CsvSettings = csv,
  ) {
    create.reset()
    infer.mutate(toOrigin(nextKind, nextFile, nextCsv))
  }

  async function choose(chosen: File) {
    const { problem, encoded } = await encodeFile(chosen)

    setFileError(problem)

    if (encoded === null) {
      setFile(null)
      infer.reset()

      return
    }

    const nextKind = kindChosen ? kind : (originKindOf(chosen.name) ?? kind)

    setKind(nextKind)
    setFile(encoded)

    if (name.trim() === '') {
      setName(nameFromFileName(chosen.name))
      setNameError(false)
    }

    preview(nextKind, encoded)
  }

  function submit() {
    const missingName = name.trim() === ''

    setNameError(missingName)

    if (file === null) {
      setFileError('fileRequired')
    }

    if (missingName || file === null) {
      document.getElementById(missingName ? `${id}-name` : `${id}-file`)?.focus()

      return
    }

    create.mutate({ name: name.trim(), origin: toOrigin(kind, file, csv) })
  }

  return (
    <AppPage title={t('createTitle')}>
      <form
        noValidate
        aria-busy={create.isPending || undefined}
        className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}>
        <div className="flex min-w-0 flex-col gap-6">
          <RadioField
            id={`${id}-kind`}
            description={t('origin.description')}
            items={documentStructureOriginKinds.map((value) => ({
              value,
              label: t(`origin.kinds.${value}`),
            }))}
            label={t('origin.label')}
            value={kind}
            onChange={(next) => {
              setKind(next)
              setKindChosen(true)

              if (file) {
                preview(next, file)
              }
            }}
          />
          <FileField
            id={`${id}-file`}
            fileName={file?.fileName ?? null}
            message={fileMessageOf(fileError, previewProblem, kind === 'csvDocument')}
            onChange={(chosen) => void choose(chosen)}
          />
          {kind === 'csvDocument' && (
            <CsvSettingsFields
              id={`${id}-csv`}
              csv={csv}
              description={t('csvDescription')}
              onChange={(next) => {
                setCsv(next)

                if (file) {
                  preview(kind, file, next)
                }
              }}
            />
          )}
        </div>
        <section
          aria-labelledby={`${id}-preview`}
          className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="flex flex-col gap-1">
            <h2 id={`${id}-preview`} className="font-semibold">
              {t('preview.title')}
            </h2>
            <p className="text-muted-foreground text-sm">{t('preview.description')}</p>
          </div>
          <Preview
            csv={kind === 'csvDocument' ? csv : null}
            file={file}
            infer={infer}
            name={name}
            onRetry={() => file && preview(kind, file)}
          />
        </section>
        <div className="flex min-w-0 flex-col gap-6">
          <TextField
            id={`${id}-name`}
            description={t('name.description')}
            error={nameError ? t('errors.nameRequired') : null}
            label={t('name.label')}
            maxLength={maxDocumentStructureNameLength}
            value={name}
            onChange={(next) => {
              setName(next)
              setNameError(false)
            }}
          />
          <RefusalAlert error={create.error} failed={t('failed')} takeFocus />
          <Button disabled={create.isPending} type="submit" className="self-start">
            {create.isPending ? t('creating') : t('create')}
          </Button>
        </div>
      </form>
    </AppPage>
  )
}
