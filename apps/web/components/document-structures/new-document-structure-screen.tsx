'use client'

import {
  AiMagicIcon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
  Loading03Icon,
  Upload01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { type DragEvent, useCallback, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { AppPage } from '@/components/app-page'
import { CsvSettingsFields, delimiterKeys } from '@/components/document-structures/csv-settings'
import {
  encodeFile,
  type FileProblem,
  nameFromFileName,
  originKindOf,
  toOrigin,
} from '@/components/document-structures/document-file'
import { RefusalAlert } from '@/components/document-structures/document-structure-problem'
import { fieldEntries } from '@/components/document-structures/field-list'
import { FileField } from '@/components/document-structures/file-field'
import {
  type LabelChoices,
  namesToCheck,
  type ReadingStepState,
  readingSteps,
  type ReadProgress,
  type SaveBlock,
  saveBlock,
} from '@/components/document-structures/new-document-structure'
import {
  confirmButtonId,
  ReviewFieldList,
} from '@/components/document-structures/review-field-list'
import {
  SampleFile,
  scrollToField,
  scrollToValue,
} from '@/components/document-structures/sample-file'
import { firstValues, sampleContent } from '@/components/document-structures/sample-segments'
import { leafCount } from '@/components/document-structures/structure-tree'
import { TextField } from '@/components/form-field'
import { createDocumentStructure, documentStructureProblemOf } from '@/lib/api/client'
import { storeSavedDocumentStructure, useDocumentStructureInference } from '@/lib/api/queries'
import { documentStructureHref } from '@/lib/navigation'
import {
  type CreateDocumentStructureBody,
  type CsvSettings,
  defaultCsvSettings,
  type DocumentStructureOriginKind,
  type EncodedFile,
  type InferredDocumentStructure,
  maxDocumentStructureNameLength,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@edi-bridge/ui/components/collapsible'
import { cn } from '@edi-bridge/ui/lib/utils'

const revealDelayMs = 700

const exportFiles = '.csv,.json,.txt,text/csv,application/json,text/plain'

const jsonSchemaFiles = '.json,application/json,application/schema+json'

type Chosen = { file: EncodedFile; kind: DocumentStructureOriginKind }

type Unopened = { fileName: string; problem: FileProblem }

type FocusOnMount = (element: HTMLElement | null) => void

function DropZone({
  id,
  focusOnMount,
  onChoose,
}: {
  id: string
  focusOnMount: FocusOnMount
  onChoose: (file: File) => void
}) {
  const t = useTranslations('DocumentStructureForm.drop')
  const [dragging, setDragging] = useState(false)

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    const dropped = event.dataTransfer.files[0]

    if (dropped) {
      onChoose(dropped)
    }
  }

  return (
    <label
      className={cn(
        'hover:bg-muted/50 has-focus-visible:border-ring has-focus-visible:ring-ring/50 mx-auto flex min-h-72 w-full max-w-2xl cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors has-focus-visible:ring-3',
        dragging && 'border-primary bg-primary/5',
      )}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDrop={drop}>
      <HugeiconsIcon
        icon={Upload01Icon}
        strokeWidth={2}
        aria-hidden
        className="text-muted-foreground size-10"
      />
      <span className="text-lg font-medium text-balance">{t('title')}</span>
      <span className="text-muted-foreground max-w-md text-sm text-pretty">{t('description')}</span>
      <span
        aria-hidden
        className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium">
        {t('choose')}
      </span>
      <input
        id={id}
        accept={exportFiles}
        ref={focusOnMount}
        type="file"
        className="sr-only"
        onChange={(event) => {
          const chosen = event.target.files?.[0]

          if (chosen) {
            onChoose(chosen)
          }
        }}
      />
    </label>
  )
}

function StepIcon({ state }: { state: ReadingStepState }) {
  switch (state) {
    case 'done':
      return (
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          strokeWidth={2}
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400"
        />
      )
    case 'active':
      return (
        <HugeiconsIcon
          icon={Loading03Icon}
          strokeWidth={2}
          aria-hidden
          className="text-ai-proposed mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
        />
      )
    case 'pending':
      return (
        <HugeiconsIcon
          icon={CircleIcon}
          strokeWidth={2}
          aria-hidden
          className="text-muted-foreground mt-0.5 size-4 shrink-0"
        />
      )
  }
}

function ReadingFacts({
  inferred,
  step,
}: {
  inferred: InferredDocumentStructure
  step: 'finding' | 'naming'
}) {
  const t = useTranslations('DocumentStructureForm.reading.facts')

  function facts() {
    if (step === 'naming') {
      return [t('names', { count: namesToCheck(inferred.children, new Map()).length })]
    }

    if (inferred.format === 'json') {
      return [t('fields', { count: inferred.facts.fieldCount })]
    }

    return [
      t('columns', {
        count: inferred.facts.columnCount,
        delimiter: delimiterKeys[inferred.csv.delimiter],
      }),
      t('rows', { count: inferred.facts.rowCount }),
    ]
  }

  return (
    <ul className="text-muted-foreground flex flex-col gap-0.5">
      {facts().map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  )
}

function Reading({
  fileName,
  kind,
  progress,
  inferred,
  focusOnMount,
}: {
  fileName: string
  kind: DocumentStructureOriginKind | null
  progress: ReadProgress
  inferred: InferredDocumentStructure | undefined
  focusOnMount: FocusOnMount
}) {
  const t = useTranslations('DocumentStructureForm.reading')
  const id = useId()

  return (
    <section
      ref={focusOnMount}
      tabIndex={-1}
      aria-labelledby={id}
      className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-2xl border p-6 outline-hidden">
      <h2 id={id} className="flex items-start gap-2 font-medium">
        <HugeiconsIcon
          icon={AiMagicIcon}
          strokeWidth={2}
          aria-hidden
          className="text-ai-proposed mt-0.5 size-5 shrink-0"
        />
        <span className="min-w-0 break-all">{t('title', { fileName })}</span>
      </h2>
      <ol aria-live="polite" className="flex flex-col gap-3 text-sm">
        {readingSteps(progress).map(({ key, state }) => (
          <li
            key={key}
            aria-current={state === 'active' ? 'step' : undefined}
            className="flex items-start gap-2">
            <StepIcon state={state} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  state === 'active' && 'font-medium',
                  state === 'pending' && 'text-muted-foreground',
                )}>
                {key === 'finding'
                  ? t(`steps.finding.${kind === 'csvDocument' ? 'csv' : 'json'}`)
                  : t(`steps.${key}`)}
                <span className="sr-only">: {t(`states.${state}`)}</span>
              </span>
              {state === 'done' && inferred && key !== 'opening' && (
                <ReadingFacts inferred={inferred} step={key} />
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ReadFailed({
  fileName,
  unopened,
  error,
  csv,
  focus,
  focusOnMount,
  onRetry,
  onAnotherFile,
  onCsvSettings,
}: {
  fileName: string
  unopened: FileProblem | null
  error: Error | null
  csv: boolean
  focus: boolean
  focusOnMount: FocusOnMount
  onRetry: () => void
  onAnotherFile: () => void
  onCsvSettings: () => void
}) {
  const t = useTranslations('DocumentStructureForm')
  const id = useId()
  const refused = documentStructureProblemOf(error) !== null

  return (
    <section
      ref={unopened ? focusOnMount : undefined}
      tabIndex={-1}
      aria-labelledby={id}
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-2xl border p-6 outline-hidden">
      <h2 id={id} className="font-medium break-all">
        {t('failed.title', { fileName })}
      </h2>
      {unopened ? (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t(`errors.${unopened}`)}
        </p>
      ) : (
        <RefusalAlert error={error} failed={t('failed.message')} takeFocus={focus}>
          <Button size="sm" type="button" variant="outline" onClick={onRetry}>
            {t('failed.retry')}
          </Button>
        </RefusalAlert>
      )}
      {refused && csv && <p className="text-muted-foreground text-sm">{t('failed.csvHint')}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="button" onClick={onAnotherFile}>
          {t('anotherFile')}
        </Button>
        {refused && csv && (
          <Button size="sm" type="button" variant="outline" onClick={onCsvSettings}>
            {t('failed.csvSettings')}
          </Button>
        )}
      </div>
    </section>
  )
}

function SaveLabel({ block, saving }: { block: SaveBlock | null; saving: boolean }) {
  const t = useTranslations('DocumentStructureForm.save')

  if (block?.reason === 'names') {
    return t('checkNames', { count: block.count })
  }

  if (block?.reason === 'name') {
    return t('nameFirst')
  }

  return saving ? t('saving') : t('submit')
}

function Review({
  inferred,
  choices,
  name,
  saving,
  saveError,
  focusOnMount,
  onChoose,
  onUndo,
  onName,
  onSave,
  onAnotherFile,
}: {
  inferred: InferredDocumentStructure
  choices: LabelChoices
  name: string
  saving: boolean
  saveError: Error | null
  focusOnMount: FocusOnMount
  onChoose: (path: string, label: string) => void
  onUndo: (path: string) => void
  onName: (name: string) => void
  onSave: () => void
  onAnotherFile: () => void
}) {
  const t = useTranslations('DocumentStructureForm')
  const id = useId()
  const valuesRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const { sample } = inferred
  const entries = useMemo(() => fieldEntries(inferred.children), [inferred])
  const toCheck = namesToCheck(inferred.children, choices)
  const block = saveBlock(toCheck.length, name)

  const labels = useMemo(
    () => new Map(entries.map(({ node }) => [node.path, choices.get(node.path) ?? node.label])),
    [entries, choices],
  )

  const content = useMemo(() => sample && sampleContent(inferred, sample), [inferred, sample])

  const examples = useMemo(
    () => (content ? firstValues(content) : new Map<string, string>()),
    [content],
  )

  function focusAfter(path: string) {
    const index = toCheck.findIndex((node) => node.path === path)
    const rest = toCheck.filter((node) => node.path !== path)
    const next = toCheck.slice(index + 1)[0] ?? rest[0]

    if (next) {
      document.getElementById(confirmButtonId(id, next.path))?.focus()
    } else {
      document.getElementById(name.trim() === '' ? `${id}-name` : `${id}-save`)?.focus()
    }
  }

  const fields = (
    <ReviewFieldList
      choices={choices}
      entries={entries}
      examples={examples}
      listId={id}
      listRef={listRef}
      selected={selected}
      onChoose={(path, label) => {
        const confirmed = toCheck.find((node) => node.path === path)?.label === label

        flushSync(() => onChoose(path, label))
        setAnnouncement(
          [
            confirmed
              ? t('field.announce.confirmed', { label })
              : t('field.announce.renamed', { label }),
            t('field.announce.left', { count: toCheck.length - 1 }),
          ].join(' '),
        )
        focusAfter(path)
      }}
      onSelect={(path) => {
        setSelected(path)
        scrollToValue(valuesRef.current, path)
      }}
      onUndo={(path) => {
        flushSync(() => onUndo(path))
        setAnnouncement('')
        document.getElementById(confirmButtonId(id, path))?.focus()
      }}
    />
  )

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby={`${id}-title`}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id={`${id}-title`}
            ref={focusOnMount}
            tabIndex={-1}
            className="font-semibold break-all outline-hidden">
            {sample ? t('review.title', { fileName: sample.fileName }) : t('review.titleNoSample')}
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span>{t('review.fields', { count: leafCount(inferred.children) })}</span>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            {toCheck.length > 0 ? (
              <span className="font-medium">{t('review.toCheck', { count: toCheck.length })}</span>
            ) : (
              <span className="flex items-center gap-1">
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  strokeWidth={2}
                  aria-hidden
                  className="size-4 text-emerald-700 dark:text-emerald-400"
                />
                {t('review.allChecked')}
              </span>
            )}
          </p>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>
        <Button size="sm" type="button" variant="outline" onClick={onAnotherFile}>
          {t('anotherFile')}
        </Button>
      </section>
      {sample && content ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="min-w-0 lg:sticky lg:top-4">
            <SampleFile
              content={content}
              labels={labels}
              sample={sample}
              selected={selected}
              valuesRef={valuesRef}
              onSelect={(path) => {
                flushSync(() => setSelected(path))
                scrollToField(listRef.current, path)
              }}
            />
          </div>
          <section aria-label={t('review.fieldsLabel')} className="min-w-0">
            {fields}
          </section>
        </div>
      ) : (
        <section aria-label={t('review.fieldsLabel')} className="max-w-3xl min-w-0">
          {fields}
        </section>
      )}
      <form
        noValidate
        aria-busy={saving || undefined}
        className="bg-muted/30 flex flex-col gap-3 rounded-xl border p-4"
        onSubmit={(event) => {
          event.preventDefault()

          if (block === null) {
            onSave()
          }
        }}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-64 sm:max-w-sm">
            <TextField
              id={`${id}-name`}
              description={t('name.description')}
              error={null}
              label={t('name.label')}
              maxLength={maxDocumentStructureNameLength}
              value={name}
              onChange={onName}
            />
          </div>
          <Button id={`${id}-save`} disabled={block !== null || saving} type="submit">
            <SaveLabel block={block} saving={saving} />
          </Button>
        </div>
        <RefusalAlert error={saveError} failed={t('save.failed')} takeFocus />
      </form>
    </div>
  )
}

function TechnicalOptions({
  id,
  open,
  csv,
  jsonSchemaName,
  onOpenChange,
  onCsv,
  onJsonSchema,
}: {
  id: string
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
          id={`${id}-csv`}
          csv={csv}
          description={t('csvDescription')}
          onChange={onCsv}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}

type Stage = 'drop' | 'reading' | 'failed' | 'review'

function stageOf(state: {
  opening: boolean
  unopened: boolean
  chosen: boolean
  failed: boolean
  shown: boolean
}): Stage {
  if (state.opening) {
    return 'reading'
  }

  if (state.unopened || state.failed) {
    return 'failed'
  }

  if (!state.chosen) {
    return 'drop'
  }

  return state.shown ? 'review' : 'reading'
}

function progressOf(opening: boolean, read: boolean): ReadProgress {
  if (opening) {
    return 'opening'
  }

  return read ? 'read' : 'reading'
}

export function NewDocumentStructureScreen() {
  const t = useTranslations('DocumentStructureForm')
  const id = useId()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [opening, setOpening] = useState<string | null>(null)
  const [unopened, setUnopened] = useState<Unopened | null>(null)
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [csv, setCsv] = useState<CsvSettings>(defaultCsvSettings)
  const [holding, setHolding] = useState(false)
  const [choices, setChoices] = useState<LabelChoices>(new Map())
  const [name, setName] = useState('')
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

  function read(next: Chosen, nextCsv: CsvSettings) {
    readCount.current += 1
    const current = readCount.current

    setChoices(new Map())
    setHolding(true)
    create.reset()
    infer.mutate(toOrigin(next.kind, next.file, nextCsv), {
      onSuccess: () => {
        window.setTimeout(() => {
          if (readCount.current === current) {
            setHolding(false)
          }
        }, revealDelayMs)
      },
    })
  }

  async function open(file: File, kind?: DocumentStructureOriginKind) {
    setFollowFocus(true)
    setOpening(file.name)
    setUnopened(null)
    infer.reset()

    const { problem, encoded } = await encodeFile(file)

    setOpening(null)

    if (encoded === null) {
      setChosen(null)
      setUnopened({ fileName: file.name, problem })

      return
    }

    const next = { file: encoded, kind: kind ?? originKindOf(file.name) ?? 'jsonDocument' }

    setChosen(next)

    if (name.trim() === '') {
      setName(nameFromFileName(file.name))
    }

    read(next, csv)
  }

  function anotherFile() {
    readCount.current += 1
    setFollowFocus(true)
    setUnopened(null)
    setChoices(new Map())
    setName('')
    setChosen(null)
    infer.reset()
    create.reset()
  }

  const stage = stageOf({
    opening: opening !== null,
    unopened: unopened !== null,
    chosen: chosen !== null,
    failed: infer.isError,
    shown: infer.isSuccess && !holding,
  })

  const fileName = opening ?? chosen?.file.fileName ?? unopened?.fileName ?? ''

  return (
    <AppPage title={t('createTitle')}>
      {stage === 'drop' && (
        <DropZone
          id={`${id}-drop`}
          focusOnMount={focusOnMount}
          onChoose={(file) => void open(file)}
        />
      )}
      {stage === 'reading' && (
        <Reading
          fileName={fileName}
          focusOnMount={focusOnMount}
          inferred={infer.data}
          kind={chosen?.kind ?? originKindOf(fileName)}
          progress={progressOf(opening !== null, infer.isSuccess)}
        />
      )}
      {stage === 'failed' && (
        <ReadFailed
          csv={chosen?.kind === 'csvDocument'}
          error={infer.error}
          fileName={fileName}
          focus={followFocus}
          focusOnMount={focusOnMount}
          unopened={unopened?.problem ?? null}
          onAnotherFile={anotherFile}
          onCsvSettings={() => {
            flushSync(() => setTechnicalOpen(true))
            document.getElementById(`${id}-technical-csv-delimiter`)?.focus()
          }}
          onRetry={() => chosen && read(chosen, csv)}
        />
      )}
      {stage === 'review' && infer.data && (
        <Review
          choices={choices}
          focusOnMount={focusOnMount}
          inferred={infer.data}
          name={name}
          saveError={create.error}
          saving={create.isPending}
          onAnotherFile={anotherFile}
          onChoose={(path, label) => setChoices(new Map([...choices, [path, label]]))}
          onName={(next) => {
            setName(next)
            create.reset()
          }}
          onSave={() => {
            if (chosen === null) {
              return
            }

            create.mutate({
              name: name.trim(),
              origin: toOrigin(chosen.kind, chosen.file, csv),
              labels: [...choices].map(([path, label]) => ({ path, label })),
            })
          }}
          onUndo={(path) =>
            setChoices(new Map([...choices].filter(([chosenPath]) => chosenPath !== path)))
          }
        />
      )}
      <TechnicalOptions
        id={`${id}-technical`}
        csv={csv}
        jsonSchemaName={chosen?.kind === 'jsonSchema' ? chosen.file.fileName : null}
        open={technicalOpen}
        onCsv={(next) => {
          setCsv(next)
          setFollowFocus(false)

          if (chosen?.kind === 'csvDocument') {
            read(chosen, next)
          }
        }}
        onJsonSchema={(file) => void open(file, 'jsonSchema')}
        onOpenChange={setTechnicalOpen}
      />
    </AppPage>
  )
}
