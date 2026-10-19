'use client'

import { Alert02Icon, ArrowLeft01Icon, Target02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { type ReactNode, useMemo } from 'react'

import {
  type FailingField,
  failingFieldName,
  findFailingField,
} from '@/components/mappings/failing-field'
import { navigationItems } from '@/lib/navigation'
import { Alert, AlertDescription, AlertTitle } from '@edi-bridge/ui/components/alert'
import { Button, buttonVariants } from '@edi-bridge/ui/components/button'

import type { SideQuery } from '@/components/mappings/mapping-side'

export type FailingFieldLookup =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'found'; field: FailingField; structure: string }
  | { status: 'notFound'; path: string }

export function useFailingField(
  path: string | undefined,
  source: SideQuery,
  target: SideQuery,
): FailingFieldLookup {
  const field = useMemo(
    () =>
      path !== undefined && source.items && target.items
        ? findFailingField(path, { source: source.items, target: target.items })
        : undefined,
    [path, source.items, target.items],
  )

  if (path === undefined) {
    return { status: 'none' }
  }

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

const code = (chunks: ReactNode) => <code className="font-mono wrap-anywhere">{chunks}</code>

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
  marked,
  onShow,
}: {
  lookup: Extract<FailingFieldLookup, { status: 'found' | 'notFound' }>
  canChange: boolean
  marked: boolean
  // Left out on a small screen, where the editor is not shown.
  onShow?: (() => void) | undefined
}) {
  const t = useTranslations('Mapping.failingField')

  if (lookup.status === 'notFound') {
    return (
      <Alert className="flex-none">
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden />
        <AlertTitle>{t('notFound.title')}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <p>{t.rich('notFound.description', { path: lookup.path, code })}</p>
          <BackToDocuments />
        </AlertDescription>
      </Alert>
    )
  }

  const { field, structure } = lookup

  return (
    <Alert variant="destructive" className="flex-none">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} aria-hidden />
      <AlertTitle>{t.rich('title', { field: failingFieldName(field), code })}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <p>
          {t('where', { side: field.row.side, structure })}
          {marked && ` ${t('marked')}`}
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
