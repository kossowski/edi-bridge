'use client'

import { useTranslations } from 'next-intl'
import { useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { RefusalAlert } from '@/components/document-structures/document-structure-problem'
import {
  CheckedIcon,
  fieldEntries,
  scrollToField,
} from '@/components/document-structures/field-list'
import {
  isBlank,
  type LabelChoices,
  labelsToCheck,
  type SaveBlock,
  saveBlock,
} from '@/components/document-structures/new-document-structure'
import { type FocusOnMount } from '@/components/document-structures/new-document-structure-reading'
import { fieldControlId, ReviewFieldList } from '@/components/document-structures/review-field-list'
import { SampleFile, scrollToValue } from '@/components/document-structures/sample-file'
import { firstValues, sampleContent } from '@/components/document-structures/sample-segments'
import { leafCount } from '@/components/document-structures/structure-tree'
import { TextField } from '@/components/form-field'
import {
  type InferredDocumentStructure,
  maxDocumentStructureNameLength,
} from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'

function SaveLabel({ block, saving }: { block: SaveBlock | null; saving: boolean }) {
  const t = useTranslations('DocumentStructureForm.save')

  if (block?.reason === 'labels') {
    return t('checkLabels', { count: block.count })
  }

  if (block?.reason === 'name') {
    return t('nameFirst')
  }

  return saving ? t('saving') : t('submit')
}

export function Review({
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
  const toCheck = labelsToCheck(inferred.children, choices)
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
      document.getElementById(fieldControlId(id, next.path, 'confirm'))?.focus()
    } else {
      document.getElementById(isBlank(name) ? `${id}-name` : `${id}-save`)?.focus()
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
        document.getElementById(fieldControlId(id, path, 'confirm'))?.focus()
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
                <CheckedIcon />
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
