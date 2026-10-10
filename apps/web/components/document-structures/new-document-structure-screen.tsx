'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'

import { BackLink, Loading } from '@/components/detail-parts'
import { CsvSettingsFacts } from '@/components/document-structures/csv-settings-facts'
import {
  ProblemAlert,
  problemTextClass,
} from '@/components/document-structures/document-structure-problem'
import { FileField } from '@/components/document-structures/file-field'
import {
  encodeBase64,
  fileProblem,
  type FileProblem,
  leafCount,
  nameFromFileName,
  originKindOf,
  toOrigin,
} from '@/components/document-structures/structure-tree'
import { StructureTreeGrid } from '@/components/document-structures/structure-tree-grid'
import { RadioField, TextField } from '@/components/form-field'
import {
  createDocumentStructure,
  documentStructureProblemOf,
  inferDocumentStructure,
} from '@/lib/api/client'
import { storeSavedDocumentStructure } from '@/lib/api/queries'
import {
  type CreateDocumentStructureBody,
  defaultCsvSettings,
  type DocumentStructureOrigin,
  type DocumentStructureOriginKind,
  documentStructureOriginKinds,
  type EncodedFile,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'

type FileError = FileProblem | 'fileRequired'

function Preview({
  file,
  infer,
  name,
  onRetry,
}: {
  file: EncodedFile | null
  infer: ReturnType<typeof useInference>
  name: string
  onRetry: () => void
}) {
  const t = useTranslations('DocumentStructureForm.preview')
  const problem = documentStructureProblemOf(infer.error)

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

  if (problem) {
    return <ProblemAlert problem={problem} />
  }

  if (infer.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className={problemTextClass}>
          {t('failed')}
        </p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t('retry')}
        </Button>
      </div>
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

function useInference() {
  return useMutation({
    mutationFn: (origin: DocumentStructureOrigin) => inferDocumentStructure(origin),
  })
}

export function NewDocumentStructureScreen() {
  const t = useTranslations('DocumentStructureForm')
  const id = useId()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<DocumentStructureOriginKind>('jsonDocument')
  const [file, setFile] = useState<EncodedFile | null>(null)
  const [fileError, setFileError] = useState<FileError | null>(null)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState(false)
  const infer = useInference()

  const create = useMutation({
    mutationFn: (body: CreateDocumentStructureBody) => createDocumentStructure(body),
    onSuccess: (created) => {
      storeSavedDocumentStructure(queryClient, created)
      router.push(`/document-structures/${created.id}`)
    },
  })

  const createProblem = documentStructureProblemOf(create.error)
  const previewProblem = documentStructureProblemOf(infer.error) !== null

  function preview(nextKind: DocumentStructureOriginKind, nextFile: EncodedFile) {
    create.reset()
    infer.mutate(toOrigin(nextKind, nextFile))
  }

  async function choose(chosen: File) {
    const problem = fileProblem(chosen.size)

    setFileError(problem)

    if (problem) {
      setFile(null)
      infer.reset()

      return
    }

    const encoded = {
      fileName: chosen.name,
      content: encodeBase64(new Uint8Array(await chosen.arrayBuffer())),
    }

    const nextKind = originKindOf(chosen.name) ?? kind

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

    create.mutate({ name: name.trim(), origin: toOrigin(kind, file) })
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 p-6">
      <BackLink href="/document-structures" label={t('back')} />
      <h1 className="text-2xl font-semibold tracking-tight">{t('createTitle')}</h1>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <form
          noValidate
          aria-busy={create.isPending || undefined}
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}>
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

              if (file) {
                preview(next, file)
              }
            }}
          />
          <FileField
            id={`${id}-file`}
            error={
              fileError ? t(`errors.${fileError}`) : previewProblem ? t('errors.unreadable') : null
            }
            fileName={file?.fileName ?? null}
            onChange={(chosen) => void choose(chosen)}
          />
          {kind === 'csvDocument' && <CsvSettingsFacts id={`${id}-csv`} csv={defaultCsvSettings} />}
          <TextField
            id={`${id}-name`}
            description={t('name.description')}
            error={nameError ? t('errors.nameRequired') : null}
            label={t('name.label')}
            maxLength={70}
            value={name}
            onChange={(next) => {
              setName(next)
              setNameError(false)
            }}
          />
          {createProblem ? (
            <ProblemAlert problem={createProblem} />
          ) : (
            create.isError && (
              <p role="alert" className={problemTextClass}>
                {t('failed')}
              </p>
            )
          )}
          <Button disabled={create.isPending} type="submit" className="self-start">
            {create.isPending ? t('creating') : t('create')}
          </Button>
        </form>
        <section aria-labelledby={`${id}-preview`} className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id={`${id}-preview`} className="font-semibold">
              {t('preview.title')}
            </h2>
            <p className="text-muted-foreground text-sm">{t('preview.description')}</p>
          </div>
          <Preview
            file={file}
            infer={infer}
            name={name}
            onRetry={() => file && preview(kind, file)}
          />
        </section>
      </div>
    </div>
  )
}
