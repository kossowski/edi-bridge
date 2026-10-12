'use client'

import { ArrowRight01Icon, HelpCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { type Ref, useId, useState } from 'react'

import { Loading } from '@/components/detail-parts'
import { RefusalAlert } from '@/components/document-structures/document-structure-problem'
import { type Mappings, UsedByMappings } from '@/components/document-structures/mapping-list'
import { TextField } from '@/components/form-field'
import { updateDocumentStructure } from '@/lib/api/client'
import { storeSavedDocumentStructure } from '@/lib/api/queries'
import {
  type DocumentStructure,
  type DocumentStructureNode,
  documentStructureNodes,
  maxFieldLabelLength,
  nodeContent,
} from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'

export type FieldEntry = { node: DocumentStructureNode; depth: number }

export function fieldEntries(children: ReadonlyArray<DocumentStructureNode>): FieldEntry[] {
  return [...documentStructureNodes(children)].map(({ node, ancestors }) => ({
    node,
    depth: ancestors.length,
  }))
}

export function UnsureBadge() {
  const t = useTranslations('DocumentStructure.fieldList')

  return (
    <Badge variant="outline" className="border-ai-proposed text-ai-proposed">
      <HugeiconsIcon icon={HelpCircleIcon} strokeWidth={2} aria-hidden />
      {t('unsure')}
    </Badge>
  )
}

function Holds({ node }: { node: DocumentStructureNode }) {
  const t = useTranslations('DocumentStructure.fieldList')
  const tTree = useTranslations('DocumentStructureTree')
  const format = useFormatter()
  const content = nodeContent(node)

  const parts = [
    content.kind === 'field'
      ? tTree(`types.${content.type}`)
      : t('group', { count: content.children.length }),
    node.required ? t('required') : t('optional'),
    ...(node.kind === 'array' ? [t('repeats')] : []),
  ]

  return format.list(parts, { type: 'unit' })
}

function RenameForm({
  structure,
  node,
}: {
  structure: DocumentStructure
  node: DocumentStructureNode
}) {
  const t = useTranslations('DocumentStructure.fieldList.rename')
  const id = useId()
  const queryClient = useQueryClient()
  const [label, setLabel] = useState(node.label)
  const [touched, setTouched] = useState(false)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const trimmed = label.trim()
  const missing = touched && trimmed === ''

  const rename = useMutation({
    mutationFn: (chosen: string) =>
      updateDocumentStructure(structure.id, {
        name: structure.name,
        adjustments: [{ path: node.path, label: chosen }],
      }),
    onSuccess: (updated, chosen) => {
      setConfirmed(
        chosen === node.label ? t('kept', { label: chosen }) : t('renamed', { label: chosen }),
      )
      storeSavedDocumentStructure(queryClient, updated)
      document.getElementById(id)?.focus()
    },
  })

  return (
    <form
      noValidate
      aria-busy={rename.isPending || undefined}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)

        if (trimmed === '') {
          document.getElementById(id)?.focus()

          return
        }

        setConfirmed(null)
        rename.mutate(trimmed)
      }}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <TextField
            id={id}
            error={missing ? t('required') : null}
            label={t('label')}
            maxLength={maxFieldLabelLength}
            value={label}
            onChange={(next) => {
              setLabel(next)
              setConfirmed(null)
              rename.reset()
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={rename.isPending || trimmed === node.label}
            size="sm"
            type="submit"
            variant="outline">
            {rename.isPending ? t('saving') : t('submit')}
          </Button>
          {node.labelUnsure && (
            <Button
              disabled={rename.isPending}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                setLabel(node.label)
                setConfirmed(null)
                rename.mutate(node.label)
              }}>
              {t('keep')}
            </Button>
          )}
        </div>
      </div>
      <p aria-live="polite" className="text-muted-foreground text-sm empty:hidden">
        {confirmed}
      </p>
      <RefusalAlert error={rename.error} failed={t('failed')} takeFocus />
    </form>
  )
}

function FieldDetails({
  id,
  structure,
  node,
  example,
  mappings,
  canChange,
}: {
  id: string
  structure: DocumentStructure
  node: DocumentStructureNode
  example: string | undefined
  mappings: Mappings | undefined
  canChange: boolean
}) {
  const t = useTranslations('DocumentStructure.fieldList')
  const tFacts = useTranslations('DocumentStructure.facts')

  return (
    <div
      id={id}
      className="bg-muted/30 mx-1 flex flex-col gap-4 rounded-b-lg border border-t-0 px-3 py-3 text-sm">
      {node.labelUnsure && <p className="font-medium">{t('unsureNote')}</p>}
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">{t('technicalName')}</dt>
        <dd className="min-w-0">
          <code className="font-mono text-xs break-all">{node.name}</code>
        </dd>
        {node.path !== node.name && (
          <>
            <dt className="text-muted-foreground">{t('path')}</dt>
            <dd className="min-w-0">
              <code className="font-mono text-xs break-all">{node.path}</code>
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('holds')}</dt>
        <dd>
          <Holds node={node} />
        </dd>
        {example !== undefined && (
          <>
            <dt className="text-muted-foreground">{t('example')}</dt>
            <dd className="min-w-0">
              <code className="font-mono text-xs break-all">{example}</code>
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('reason')}</dt>
        <dd className="text-pretty">
          {node.labelReason === null ? t('namedByYou') : <span lang="en">{node.labelReason}</span>}
        </dd>
        <dt className="text-muted-foreground">{t('readBy')}</dt>
        <dd className="min-w-0">
          {mappings ? (
            <UsedByMappings mappings={mappings} />
          ) : (
            <Loading label={tFacts('mappingsLoading')} rowClassName="h-4 w-32" rows={1} />
          )}
        </dd>
      </dl>
      {canChange && <RenameForm node={node} structure={structure} />}
    </div>
  )
}

export function FieldList({
  structure,
  entries,
  examples,
  mappings,
  selected,
  canChange,
  onSelect,
  listRef,
}: {
  structure: DocumentStructure
  entries: ReadonlyArray<FieldEntry>
  examples: ReadonlyMap<string, string>
  mappings: Mappings | undefined
  selected: string | null
  canChange: boolean
  onSelect: (path: string | null) => void
  listRef?: Ref<HTMLUListElement>
}) {
  const id = useId()

  return (
    <ul ref={listRef} className="flex flex-col gap-1.5">
      {entries.map(({ node, depth }) => {
        const active = node.path === selected
        const detailsId = `${id}-${node.path}`
        const example = examples.get(node.path)

        return (
          <li
            key={node.path}
            className="min-w-0 scroll-mt-18 scroll-mb-4"
            style={{ marginInlineStart: `${Math.min(depth, 4) * 0.75}rem` }}>
            <button
              type="button"
              aria-controls={active ? detailsId : undefined}
              aria-expanded={active}
              className="group hover:bg-muted/50 focus-visible:ring-ring/50 aria-expanded:border-primary flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm outline-none focus-visible:ring-3 aria-expanded:rounded-b-none aria-expanded:border-2"
              data-path={node.path}
              onClick={() => onSelect(active ? null : node.path)}>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                aria-hidden
                className="mt-0.5 size-4 shrink-0 transition-transform group-aria-expanded:rotate-90"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium break-words">{node.label}</span>
                  {node.labelUnsure && <UnsureBadge />}
                </span>
                <code className="text-muted-foreground font-mono text-xs break-all">
                  {node.path}
                </code>
              </span>
              {example !== undefined && (
                <span className="text-muted-foreground hidden max-w-40 truncate font-mono text-xs sm:block">
                  {example}
                </span>
              )}
            </button>
            {active && (
              <FieldDetails
                id={detailsId}
                canChange={canChange}
                example={example}
                mappings={mappings}
                node={node}
                structure={structure}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
