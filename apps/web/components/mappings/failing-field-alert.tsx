'use client'

import { Alert02Icon, ArrowLeft01Icon, Target02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useMemo } from 'react'

import {
  type FailingField,
  failingFieldName,
  findFailingField,
} from '@/components/mappings/failing-field'
import { useSide } from '@/components/mappings/mapping-side'
import { navigationItems } from '@/lib/navigation'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'

import type { MappingDraft } from '@edi-bridge/contracts'

export type FailingFieldLookup =
  | { status: 'loading' }
  | { status: 'found'; field: FailingField; structure: string }
  | { status: 'notFound'; path: string }

export function useFailingField(draft: MappingDraft, path: string): FailingFieldLookup {
  const source = useSide(draft.source)
  const target = useSide(draft.target)

  const field = useMemo(
    () =>
      source.items && target.items
        ? findFailingField(path, { source: source.items, target: target.items })
        : undefined,
    [path, source.items, target.items],
  )

  if (field === undefined) {
    return { status: 'loading' }
  }

  if (field === null) {
    return { status: 'notFound', path }
  }

  return {
    status: 'found',
    field,
    structure: field.row.side === 'source' ? source.title : target.title,
  }
}

function BackToDocuments() {
  const t = useTranslations('Mapping.failingField')

  return (
    <Link
      href={navigationItems.documents.href}
      className={buttonVariants({ size: 'sm', variant: 'outline' })}>
      <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} aria-hidden />
      {t('back')}
    </Link>
  )
}

export function FailingFieldAlert({
  lookup,
  canChange,
  onShow,
}: {
  lookup: Exclude<FailingFieldLookup, { status: 'loading' }>
  canChange: boolean
  // Left out where the canvas is not shown, e.g. on a small screen.
  onShow?: (() => void) | undefined
}) {
  const t = useTranslations('Mapping.failingField')

  if (lookup.status === 'notFound') {
    return (
      <Alert className="flex-none">
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden />
        <AlertTitle>{t('notFound.title')}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <p>
            {t.rich('notFound.description', {
              path: lookup.path,
              code: (chunks) => <code className="font-mono break-all">{chunks}</code>,
            })}
          </p>
          <BackToDocuments />
        </AlertDescription>
      </Alert>
    )
  }

  const { field, structure } = lookup

  return (
    <Alert variant="destructive" className="flex-none">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden />
      <AlertTitle>
        {t.rich('title', {
          field: failingFieldName(field),
          code: (chunks) => <code className="font-mono break-all">{chunks}</code>,
        })}
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <p>
          {t('where', { side: field.row.side, structure })}{' '}
          {onShow ? t('marked') : t('smallScreen')}
          {canChange && ` ${t('fix')}`}
        </p>
        <div className="flex flex-wrap gap-2">
          {onShow && (
            <Button size="sm" onClick={onShow}>
              <HugeiconsIcon icon={Target02Icon} strokeWidth={2} aria-hidden />
              {t('show')}
            </Button>
          )}
          <BackToDocuments />
        </div>
      </AlertDescription>
    </Alert>
  )
}
