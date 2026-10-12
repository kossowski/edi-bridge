'use client'

import { CheckmarkCircle02Icon, HelpCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import { type Ref, useState } from 'react'

import { type FieldEntry, UnsureBadge } from '@/components/document-structures/field-list'
import { type LabelChoices } from '@/components/document-structures/new-document-structure'
import { TextField } from '@/components/form-field'
import { type DocumentStructureNode, maxFieldLabelLength } from '@edi-bridge/contracts'
import { Button } from '@edi-bridge/ui/components/button'

export function confirmButtonId(listId: string, path: string) {
  return `${listId}-${path}-confirm`
}

function NameCheck({
  listId,
  node,
  onChoose,
}: {
  listId: string
  node: DocumentStructureNode
  onChoose: (label: string) => void
}) {
  const t = useTranslations('DocumentStructureForm.field')
  const inputId = `${listId}-${node.path}-rename`
  const [label, setLabel] = useState('')
  const [missing, setMissing] = useState(false)

  return (
    <div className="flex flex-col gap-3 px-3 pb-3 text-sm">
      <p className="text-muted-foreground flex gap-1.5 text-pretty">
        <HugeiconsIcon
          icon={HelpCircleIcon}
          strokeWidth={2}
          aria-hidden
          className="mt-0.5 size-4 shrink-0"
        />
        <span>
          {node.labelReason === null ? t('noReason') : <span lang="en">{node.labelReason}</span>}
        </span>
      </p>
      <Button
        id={confirmButtonId(listId, node.path)}
        size="sm"
        type="button"
        className="self-start"
        onClick={() => onChoose(node.label)}>
        {t('confirm', { label: node.label })}
      </Button>
      <form
        noValidate
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()

          if (label.trim() === '') {
            setMissing(true)
            document.getElementById(inputId)?.focus()

            return
          }

          onChoose(label.trim())
        }}>
        <div className="min-w-0 flex-1 basis-48">
          <TextField
            id={inputId}
            error={missing ? t('rename.required') : null}
            label={t('rename.label', { name: node.name })}
            maxLength={maxFieldLabelLength}
            value={label}
            onChange={(next) => {
              setLabel(next)
              setMissing(false)
            }}
          />
        </div>
        <Button size="sm" type="submit" variant="outline">
          {t('rename.submit')}
        </Button>
      </form>
    </div>
  )
}

function Checked({
  node,
  choice,
  onUndo,
}: {
  node: DocumentStructureNode
  choice: string
  onUndo: () => void
}) {
  const t = useTranslations('DocumentStructureForm.field')

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 text-sm">
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        strokeWidth={2}
        aria-hidden
        className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400"
      />
      <span>{choice === node.label ? t('confirmed') : t('renamed')}</span>
      <Button
        size="sm"
        type="button"
        variant="link"
        aria-label={t('changeLabel', { label: choice })}
        className="h-auto px-1"
        onClick={onUndo}>
        {t('change')}
      </Button>
    </p>
  )
}

export function ReviewFieldList({
  listId,
  entries,
  examples,
  choices,
  selected,
  onSelect,
  onChoose,
  onUndo,
  listRef,
}: {
  listId: string
  entries: ReadonlyArray<FieldEntry>
  examples: ReadonlyMap<string, string>
  choices: LabelChoices
  selected: string | null
  onSelect: (path: string) => void
  onChoose: (path: string, label: string) => void
  onUndo: (path: string) => void
  listRef?: Ref<HTMLUListElement>
}) {
  const t = useTranslations('DocumentStructureForm.field')

  return (
    <ul ref={listRef} className="flex flex-col gap-1.5">
      {entries.map(({ node, depth }) => {
        const choice = choices.get(node.path)
        const toCheck = node.labelUnsure && choice === undefined
        const example = examples.get(node.path)

        return (
          <li
            key={node.path}
            className="data-[check=true]:border-l-ai-attention has-[[aria-pressed=true]]:border-primary has-[[aria-pressed=true]]:ring-primary min-w-0 scroll-mt-18 scroll-mb-4 rounded-lg border has-[[aria-pressed=true]]:ring-1 data-[check=true]:border-l-4"
            style={{ marginInlineStart: `${Math.min(depth, 4) * 0.75}rem` }}
            data-check={toCheck}>
            <button
              type="button"
              aria-pressed={node.path === selected}
              className="hover:bg-muted/50 focus-visible:outline-ring flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
              data-path={node.path}
              onClick={() => onSelect(node.path)}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium break-words">{choice ?? node.label}</span>
                  {toCheck && <UnsureBadge />}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t.rich('from', {
                    name: node.name,
                    code: (chunks) => <code className="font-mono break-all">{chunks}</code>,
                  })}
                </span>
              </span>
              {example !== undefined && (
                <span className="text-muted-foreground hidden max-w-40 truncate font-mono text-xs sm:block">
                  {example}
                </span>
              )}
            </button>
            {toCheck && (
              <NameCheck
                listId={listId}
                node={node}
                onChoose={(label) => onChoose(node.path, label)}
              />
            )}
            {node.labelUnsure && choice !== undefined && (
              <Checked choice={choice} node={node} onUndo={() => onUndo(node.path)} />
            )}
          </li>
        )
      })}
    </ul>
  )
}
