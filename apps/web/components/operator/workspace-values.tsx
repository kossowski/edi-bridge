'use client'

import { useFormatter, useTranslations } from 'next-intl'

import type { WorkspaceSummary } from '@edi-bridge/contracts'

export function WorkspaceGln({ gln }: { gln: WorkspaceSummary['gln'] }) {
  const t = useTranslations('Operator.values')

  return gln ? (
    <span className="font-mono tabular-nums">{gln}</span>
  ) : (
    <span className="text-muted-foreground">{t('noGln')}</span>
  )
}

export function WorkspaceSeeded({ seeded }: { seeded: boolean }) {
  const t = useTranslations('Operator.values')

  return seeded ? t('seeded.yes') : t('seeded.no')
}

export function WorkspaceCreatedAt({ createdAt }: { createdAt: string }) {
  const format = useFormatter()

  return (
    <span className="tabular-nums">
      {format.dateTime(new Date(createdAt), { dateStyle: 'medium' })}
    </span>
  )
}

export function WorkspaceLastReset({ lastResetAt }: { lastResetAt: string | null }) {
  const t = useTranslations('Operator.values')
  const format = useFormatter()

  return lastResetAt ? (
    <time dateTime={lastResetAt} className="tabular-nums">
      {format.dateTime(new Date(lastResetAt), { dateStyle: 'medium', timeStyle: 'short' })}
    </time>
  ) : (
    <span className="text-muted-foreground">{t('neverReset')}</span>
  )
}

export function WorkspaceLastActivity({ lastActivityAt }: { lastActivityAt: string | null }) {
  const t = useTranslations('Operator.values')
  const format = useFormatter()

  return lastActivityAt ? (
    <time dateTime={lastActivityAt} className="tabular-nums">
      {format.dateTime(new Date(lastActivityAt), { dateStyle: 'medium', timeStyle: 'short' })}
    </time>
  ) : (
    <span className="text-muted-foreground">{t('noActivity')}</span>
  )
}
