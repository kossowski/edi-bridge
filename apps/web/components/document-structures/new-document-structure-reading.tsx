'use client'

import { AiMagicIcon, CircleIcon, Loading03Icon, Upload01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { type DragEvent, useId, useState } from 'react'

import { delimiterKeys } from '@/components/document-structures/csv-settings'
import { type FileProblem } from '@/components/document-structures/document-file'
import { RefusalAlert } from '@/components/document-structures/document-structure-problem'
import { CheckedIcon } from '@/components/document-structures/field-list'
import {
  type FileFacts,
  type ReadingStepState,
  readingSteps,
  type ReadProgress,
  unsureLabelCount,
} from '@/components/document-structures/new-document-structure'
import { documentStructureProblemOf } from '@/lib/api/client'
import {
  type CsvDelimiter,
  type DocumentStructureOriginKind,
  type InferredDocumentStructure,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'
import { cn } from '@edi-bridge/ui/lib/utils'

export type FocusOnMount = (element: HTMLElement | null) => void

const exportFiles = '.csv,.json,.txt,text/csv,application/json,text/plain'

export function DropZone({
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
        'hover:bg-muted/50 has-focus-visible:border-ring has-focus-visible:ring-ring has-focus-visible:ring-offset-background mx-auto flex min-h-72 w-full max-w-2xl cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors has-focus-visible:border-solid has-focus-visible:ring-2 has-focus-visible:ring-offset-2',
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
      return <CheckedIcon className="mt-0.5" />
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

function FoundFacts({ facts, delimiter }: { facts: FileFacts; delimiter: CsvDelimiter }) {
  const t = useTranslations('DocumentStructureForm.reading.facts')

  const lines =
    facts.format === 'json'
      ? [t('fields', { count: facts.fieldCount })]
      : [
          t('columns', { count: facts.columnCount, delimiter: delimiterKeys[delimiter] }),
          t('rows', { count: facts.rowCount }),
        ]

  return (
    <ul className="text-muted-foreground flex flex-col gap-0.5">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

function NamedFacts({ inferred }: { inferred: InferredDocumentStructure }) {
  const t = useTranslations('DocumentStructureForm.reading.facts')

  return (
    <p className="text-muted-foreground">
      {t('labels', { count: unsureLabelCount(inferred.children) })}
    </p>
  )
}

export function Reading({
  fileName,
  kind,
  progress,
  facts,
  delimiter,
  inferred,
  focusOnMount,
}: {
  fileName: string
  kind: DocumentStructureOriginKind | null
  progress: ReadProgress
  facts: FileFacts | null
  delimiter: CsvDelimiter
  inferred: InferredDocumentStructure | null
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
              {state === 'done' && key === 'finding' && facts && (
                <FoundFacts delimiter={delimiter} facts={facts} />
              )}
              {state === 'done' && key === 'naming' && inferred && (
                <NamedFacts inferred={inferred} />
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function ReadFailed({
  fileName,
  problem,
  error,
  csv,
  focus,
  csvSettingsShown,
  focusOnMount,
  onRetry,
  onAnotherFile,
  onCsvSettings,
}: {
  fileName: string
  problem: FileProblem | null
  error: Error | null
  csv: boolean
  focus: boolean
  csvSettingsShown: boolean
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
      ref={problem ? focusOnMount : undefined}
      tabIndex={-1}
      aria-labelledby={id}
      className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-2xl border p-6 outline-hidden">
      <h2 id={id} className="font-medium break-all">
        {t('failed.title', { fileName })}
      </h2>
      {problem ? (
        <p role="alert" className="text-sm text-red-800 dark:text-red-300">
          {t(`errors.${problem}`)}
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
        {refused && csv && !csvSettingsShown && (
          <Button size="sm" type="button" variant="outline" onClick={onCsvSettings}>
            {t('failed.csvSettings')}
          </Button>
        )}
      </div>
    </section>
  )
}
