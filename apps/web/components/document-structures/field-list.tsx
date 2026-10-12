'use client'

import { ArrowRight01Icon, HelpCircleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { type Ref, useId, useState } from 'react'
import { toast } from 'sonner'

import { Loading } from '@/components/detail-parts'
import { RefusalAlert } from '@/components/document-structures/document-structure-problem'
import { UsedByMappings } from '@/components/document-structures/mapping-list'
import { TextField } from '@/components/form-field'
import { updateDocumentStructure } from '@/lib/api/client'
import { storeSavedDocumentStructure } from '@/lib/api/queries'
import {
  type DocumentStructure,
  type DocumentStructureNode,
  documentStructureNodes,
  type DocumentStructureSummary,
  maxFieldLabelLength,
  nodeContent,
} from '@edi-bridge/contracts'
import { Badge } from '@edi-bridge/ui/components/badge'
import { Button } from '@edi-bridge/ui/components/button'

type Mappings = DocumentStructureSummary['mappings'] | undefined

type FieldEntry = { node: DocumentStructureNode; depth: number }

export function fieldEntries(structure: DocumentStructure): FieldEntry[] {
  return [...documentStructureNodes(structure.children)].map(({ node, ancestors }) => ({
    node,
    depth: ancestors.length,
  }))
}

function UnsureBadge() {
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
  const trimmed = label.trim()
  const missing = touched && trimmed === ''

  const rename = useMutation({
    mutationFn: (chosen: string) =>
      updateDocumentStructure(structure.id, {
        name: structure.name,
        adjustments: [{ path: node.path, label: chosen }],
      }),
    onSuccess: (updated, chosen) => {
      storeSavedDocumentStructure(queryClient, updated)
      toast.success(
        chosen === node.label ? t('kept', { label: chosen }) : t('renamed', { label: chosen }),
      )
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
                rename.mutate(node.label)
              }}>
              {t('keep')}
            </Button>
          )}
        </div>
      </div>
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
  mappings: Mappings
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
      {canChange && <RenameForm key={node.label} node={node} structure={structure} />}
    </div>
  )
}

export function FieldList({
  structure,
  examples,
  mappings,
  selected,
  canChange,
  onSelect,
  listRef,
}: {
  structure: DocumentStructure
  examples: ReadonlyMap<string, string>
  mappings: Mappings
  selected: string | null
  canChange: boolean
  onSelect: (path: string | null) => void
  listRef?: Ref<HTMLUListElement>
}) {
  const id = useId()

  return (
    <ul ref={listRef} className="flex flex-col gap-1.5">
      {fieldEntries(structure).map(({ node, depth }) => {
        const active = node.path === selected
        const detailsId = `${id}-${node.path}`
        const example = examples.get(node.path)

        return (
          <li
            key={node.path}
            className="min-w-0"
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
