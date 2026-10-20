'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useCallback, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { AppPage } from '@/components/app-page'
import { csvDelimiterId } from '@/components/document-structures/csv-settings'
import {
  encodeFile,
  type FileProblem,
  nameFromFileName,
  originKindOf,
  toOrigin,
} from '@/components/document-structures/document-file'
import {
  type ChosenFile,
  fileFacts,
  type FileFacts,
  inferredFacts,
  isBlank,
  keptChoices,
  type LabelChoices,
  labelsToSave,
  readProgress,
} from '@/components/document-structures/new-document-structure'
import {
  DropZone,
  type FocusOnMount,
  ReadFailed,
  Reading,
} from '@/components/document-structures/new-document-structure-reading'
import { Review } from '@/components/document-structures/new-document-structure-review'
import { TechnicalOptions } from '@/components/document-structures/new-document-structure-technical'
import { createDocumentStructure } from '@/lib/api/client'
import { storeSavedDocumentStructure, useDocumentStructureInference } from '@/lib/api/queries'
import { documentStructureHref } from '@/lib/navigation'
import {
  type CreateDocumentStructureBody,
  type CsvSettings,
  defaultCsvSettings,
  type DocumentStructureInference,
  type DocumentStructureOriginKind,
  type InferredDocumentStructure,
} from '@edi-bridge/contracts'

const revealDelayMs = 700

type Stage =
  | { kind: 'drop' }
  | {
      kind: 'reading'
      fileName: string
      originKind: DocumentStructureOriginKind | null
      chosen: ChosenFile | null
      facts: FileFacts | null
      inferred: DocumentStructureInference | null
      previous: InferredDocumentStructure | null
    }
  | {
      kind: 'failed'
      fileName: string
      chosen: ChosenFile | null
      problem: FileProblem | null
      error: Error | null
      previous: InferredDocumentStructure | null
    }
  | { kind: 'review'; chosen: ChosenFile; inferred: DocumentStructureInference }

function chosenOf(stage: Stage) {
  return stage.kind === 'drop' ? null : stage.chosen
}

function previousOf(stage: Stage) {
  switch (stage.kind) {
    case 'drop':
      return null
    case 'reading':
      return stage.inferred ?? stage.previous
    case 'failed':
      return stage.previous
    case 'review':
      return stage.inferred
  }
}

export function NewDocumentStructureScreen() {
  const t = useTranslations('DocumentStructureForm')
  const id = useId()
  const csvId = `${id}-technical-csv`
  const router = useRouter()
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<Stage>({ kind: 'drop' })
  const [csv, setCsv] = useState<CsvSettings>(defaultCsvSettings)
  const [choices, setChoices] = useState<LabelChoices>(new Map())
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [technicalOpen, setTechnicalOpen] = useState(false)
  const [followFocus, setFollowFocus] = useState(false)
  const readCount = useRef(0)
  const infer = useDocumentStructureInference()

  const create = useMutation({
    mutationFn: (body: CreateDocumentStructureBody) => createDocumentStructure(body),
    onSuccess: (created) => {
      storeSavedDocumentStructure(queryClient, created)
      router.push(documentStructureHref(created.id))
    },
  })

  const focusOnMount = useCallback<FocusOnMount>(
    (element) => {
      if (followFocus) {
        element?.focus()
      }
    },
    [followFocus],
  )

  function nextRead() {
    readCount.current += 1
    const current = readCount.current

    return () => readCount.current === current
  }

  function read(
    chosen: ChosenFile,
    nextCsv: CsvSettings,
    previous: InferredDocumentStructure | null,
  ) {
    const isCurrent = nextRead()

    const reading = {
      kind: 'reading',
      fileName: chosen.file.fileName,
      originKind: chosen.kind,
      chosen,
      facts: fileFacts(chosen.kind, chosen.file, nextCsv),
      inferred: null,
      previous,
    } as const

    setStage(reading)

    if (previous === null) {
      setChoices(new Map())
    }

    create.reset()
    infer.mutate(toOrigin(chosen.kind, chosen.file, nextCsv), {
      onSuccess: (inferred) => {
        if (!isCurrent()) {
          return
        }

        setStage({ ...reading, inferred })

        if (previous !== null) {
          setChoices((current) => keptChoices(current, previous.children, inferred.children))
        }

        window.setTimeout(() => {
          if (isCurrent()) {
            setStage({ kind: 'review', chosen, inferred })
          }
        }, revealDelayMs)
      },
      onError: (error) => {
        if (isCurrent()) {
          setStage({
            kind: 'failed',
            fileName: chosen.file.fileName,
            chosen,
            problem: null,
            error,
            previous,
          })
        }
      },
    })
  }

  async function open(file: File, kind?: DocumentStructureOriginKind) {
    const isCurrent = nextRead()
    const originKind = kind ?? originKindOf(file.name)

    setFollowFocus(true)
    infer.reset()
    setStage({
      kind: 'reading',
      fileName: file.name,
      originKind,
      chosen: null,
      facts: null,
      inferred: null,
      previous: null,
    })

    const { problem, encoded } = await encodeFile(file)

    if (!isCurrent()) {
      return
    }

    if (encoded === null) {
      setStage({
        kind: 'failed',
        fileName: file.name,
        chosen: null,
        problem,
        error: null,
        previous: null,
      })

      return
    }

    if (!nameEdited || isBlank(name)) {
      setName(nameFromFileName(file.name))
    }

    read({ file: encoded, kind: originKind ?? 'jsonDocument' }, csv, null)
  }

  function anotherFile() {
    nextRead()
    setFollowFocus(true)
    setStage({ kind: 'drop' })
    setChoices(new Map())
    setName('')
    setNameEdited(false)
    infer.reset()
    create.reset()
  }

  const chosen = chosenOf(stage)

  return (
    <AppPage title={t('createTitle')}>
      {stage.kind === 'drop' && (
        <DropZone
          id={`${id}-drop`}
          focusOnMount={focusOnMount}
          onChoose={(file) => void open(file)}
        />
      )}
      {stage.kind === 'reading' && (
        <Reading
          delimiter={csv.delimiter}
          facts={stage.inferred ? inferredFacts(stage.inferred) : stage.facts}
          fileName={stage.fileName}
          focusOnMount={focusOnMount}
          inferred={stage.inferred}
          kind={stage.originKind}
          progress={readProgress(stage)}
        />
      )}
      {stage.kind === 'failed' && (
        <ReadFailed
          csv={stage.chosen?.kind === 'csvDocument'}
          csvSettingsShown={technicalOpen}
          error={stage.error}
          fileName={stage.fileName}
          focus={followFocus}
          focusOnMount={focusOnMount}
          problem={stage.problem}
          onAnotherFile={anotherFile}
          onCsvSettings={() => {
            flushSync(() => setTechnicalOpen(true))
            document.getElementById(csvDelimiterId(csvId))?.focus()
          }}
          onRetry={() => stage.chosen && read(stage.chosen, csv, stage.previous)}
        />
      )}
      {stage.kind === 'review' && (
        <Review
          choices={choices}
          focusOnMount={focusOnMount}
          inferred={stage.inferred}
          name={name}
          saveError={create.error}
          saving={create.isPending}
          onAnotherFile={anotherFile}
          onChoose={(path, label) => setChoices(new Map([...choices, [path, label]]))}
          onName={(next) => {
            setName(next)
            setNameEdited(true)
            create.reset()
          }}
          onSave={() =>
            create.mutate({
              name: name.trim(),
              origin: toOrigin(stage.chosen.kind, stage.chosen.file, csv),
              labels: labelsToSave(stage.inferred, choices),
            })
          }
          onUndo={(path) =>
            setChoices(new Map([...choices].filter(([chosenPath]) => chosenPath !== path)))
          }
        />
      )}
      <TechnicalOptions
        id={`${id}-technical`}
        csv={csv}
        csvId={csvId}
        jsonSchemaName={chosen?.kind === 'jsonSchema' ? chosen.file.fileName : null}
        open={technicalOpen}
        onCsv={(next) => {
          setCsv(next)
          setFollowFocus(false)

          if (chosen?.kind === 'csvDocument') {
            read(chosen, next, previousOf(stage))
          }
        }}
        onJsonSchema={(file) => void open(file, 'jsonSchema')}
        onOpenChange={setTechnicalOpen}
      />
    </AppPage>
  )
}
